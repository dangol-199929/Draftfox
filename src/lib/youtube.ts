// Server-only: Google OAuth for YouTube, asking only for permission to upload videos.
// Nothing is uploaded unless the user confirms it in the app.
// Tokens stay in data/youtube.json on this machine and are never sent to the browser or logged.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
export const STATE_COOKIE = "youtube_oauth_state";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

const DATA_DIR = join(process.cwd(), "data");
const CONNECTION_FILE = join(DATA_DIR, "youtube.json");

export type YouTubeConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

type Connection = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scope: string;
  connectedAt: string;
  // Set when Google refuses the refresh token. Apps in Testing mode get refresh tokens that expire after 7 days.
  needsReconnect?: boolean;
};

export type YouTubeStatus = {
  configured: boolean;
  connected: boolean;
  needsReconnect: boolean;
  connectedAt: string | null;
};

export class YouTubeError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function getConfig(): YouTubeConfig | null {
  const clientId = process.env.YOUTUBE_CLIENT_ID?.trim();
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const redirectUri =
    process.env.YOUTUBE_REDIRECT_URI?.trim() || "http://localhost:3000/api/youtube/callback";
  return { clientId, clientSecret, redirectUri };
}

// access_type=offline with prompt=consent makes Google return a refresh token every time, even on a reconnect.
export function authorizeUrl(config: YouTubeConfig, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: UPLOAD_SCOPE,
    state,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  return `${AUTHORIZE_URL}?${params}`;
}

// Swaps the one-time code from the callback for tokens and saves them.
export async function connect(config: YouTubeConfig, code: string): Promise<void> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });
  if (!response.ok) {
    throw new Error(`Token exchange failed with ${response.status}: ${await googleError(response)}`);
  }
  const token = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!token.access_token || !token.refresh_token || !token.expires_in) {
    throw new Error("Token response is missing access_token, refresh_token or expires_in.");
  }
  if (!(token.scope ?? "").split(" ").includes(UPLOAD_SCOPE)) {
    throw new Error("The upload permission was not granted.");
  }
  const now = Date.now();
  await saveConnection({
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: new Date(now + token.expires_in * 1000).toISOString(),
    scope: token.scope ?? UPLOAD_SCOPE,
    connectedAt: new Date(now).toISOString(),
  });
}

// Checking the status refreshes an expired access token, so a dead refresh token shows up as
// "Reconnect YouTube" in Settings instead of only failing at upload time.
export async function getStatus(): Promise<YouTubeStatus> {
  let connection = await readConnection();
  if (connection && !connection.needsReconnect && isExpired(connection)) {
    try {
      await getAccessToken();
    } catch {
      // getAccessToken marks the connection when the refresh token is refused; network errors are ignored here.
    }
    connection = await readConnection();
  }
  return {
    configured: getConfig() !== null,
    connected: connection !== null,
    needsReconnect: connection?.needsReconnect ?? false,
    connectedAt: connection?.connectedAt ?? null,
  };
}

// Returns a valid access token, refreshing it when it is about to expire.
export async function getAccessToken(): Promise<string> {
  const connection = await readConnection();
  if (!connection) throw new YouTubeError(401, "YouTube isn't connected. Connect it in Settings.");
  if (connection.needsReconnect) {
    throw new YouTubeError(401, "YouTube access has expired. Click Reconnect YouTube in Settings.");
  }
  if (!isExpired(connection)) return connection.accessToken;

  const config = getConfig();
  if (!config) throw new YouTubeError(500, "YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET are not set in .env.");
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: connection.refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    });
  } catch {
    throw new YouTubeError(502, "Couldn't reach Google. Check your internet connection and try again.");
  }
  if (!response.ok) {
    const detail = await googleError(response);
    // invalid_grant means the refresh token is expired or revoked; only a new sign-in fixes that.
    if (response.status === 400 || response.status === 401) {
      await saveConnection({ ...connection, needsReconnect: true });
      throw new YouTubeError(401, "YouTube access has expired. Click Reconnect YouTube in Settings.");
    }
    throw new YouTubeError(502, `Google refused to refresh the YouTube token (${response.status}): ${detail}`);
  }
  const token = (await response.json()) as { access_token?: string; expires_in?: number; refresh_token?: string };
  if (!token.access_token || !token.expires_in) {
    throw new YouTubeError(502, "Google's refresh response is missing access_token or expires_in.");
  }
  await saveConnection({
    ...connection,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? connection.refreshToken,
    expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
  });
  return token.access_token;
}

// Best effort: revoke the token at Google (ignoring failures), then forget it locally.
export async function disconnect(): Promise<void> {
  const connection = await readConnection();
  if (connection) {
    try {
      await fetch(REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: connection.refreshToken }),
      });
    } catch {
      // Revoking is optional; the local tokens are deleted either way.
    }
  }
  await rm(CONNECTION_FILE, { force: true });
}

// Refresh a minute early so a token can't expire mid-request.
function isExpired(connection: Connection): boolean {
  return Date.parse(connection.expiresAt) - 60_000 <= Date.now();
}

async function googleError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { error?: string | { message?: string }; error_description?: string };
    if (typeof body.error === "string") return [body.error, body.error_description].filter(Boolean).join(": ");
    return body.error?.message ?? text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

async function readConnection(): Promise<Connection | null> {
  let text: string;
  try {
    text = await readFile(CONNECTION_FILE, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Could not read ${CONNECTION_FILE}:`, (error as Error).message);
    }
    return null;
  }
  try {
    const connection = JSON.parse(text) as Partial<Connection>;
    if (!connection.accessToken || !connection.refreshToken || !connection.expiresAt) {
      throw new Error("missing fields");
    }
    return connection as Connection;
  } catch (error) {
    console.warn(`${CONNECTION_FILE} is not valid, treating YouTube as not connected:`, (error as Error).message);
    return null;
  }
}

// Write to a temp file first so a crash mid-write can't leave a half-written file.
async function saveConnection(connection: Connection): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const temp = `${CONNECTION_FILE}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(connection, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, CONNECTION_FILE);
}
