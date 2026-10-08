// Server-only: Sign In with LinkedIn (OpenID Connect). Reads your name, email and photo; never posts.
// The access token stays in data/linkedin.json on this machine and is never sent to the browser or logged.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const SCOPE = "openid profile email";
export const STATE_COOKIE = "linkedin_oauth_state";

const AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const REVOKE_URL = "https://www.linkedin.com/oauth/v2/revoke";
const USERINFO_URL = "https://api.linkedin.com/v2/userinfo";

const DATA_DIR = join(process.cwd(), "data");
const CONNECTION_FILE = join(DATA_DIR, "linkedin.json");

export type LinkedInConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type LinkedInProfile = {
  sub: string;
  name: string;
  email?: string;
  picture?: string;
};

type Connection = {
  accessToken: string;
  expiresAt: string;
  scope: string;
  connectedAt: string;
  profile: LinkedInProfile;
};

export type LinkedInStatus = {
  configured: boolean;
  connected: boolean;
  expired: boolean;
  expiresAt: string | null;
  connectedAt: string | null;
  profile: LinkedInProfile | null;
};

export function getConfig(): LinkedInConfig | null {
  const clientId = process.env.LINKEDIN_CLIENT_ID?.trim();
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const redirectUri =
    process.env.LINKEDIN_REDIRECT_URI?.trim() || "http://localhost:3000/api/linkedin/callback";
  return { clientId, clientSecret, redirectUri };
}

export function authorizeUrl(config: LinkedInConfig, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
    scope: SCOPE,
  });
  return `${AUTHORIZE_URL}?${params}`;
}

// Swaps the one-time code from the callback for an access token, then reads the profile and saves both.
export async function connect(config: LinkedInConfig, code: string): Promise<void> {
  const tokenResponse = await fetch(TOKEN_URL, {
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
  if (!tokenResponse.ok) {
    throw new Error(`Token exchange failed with ${tokenResponse.status}: ${await tokenResponse.text()}`);
  }
  const token = (await tokenResponse.json()) as { access_token?: string; expires_in?: number; scope?: string };
  if (!token.access_token || !token.expires_in) {
    throw new Error("Token response is missing access_token or expires_in.");
  }

  const userResponse = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!userResponse.ok) {
    throw new Error(`Userinfo request failed with ${userResponse.status}: ${await userResponse.text()}`);
  }
  const user = (await userResponse.json()) as Partial<LinkedInProfile>;
  if (!user.sub || !user.name) throw new Error("Userinfo response is missing sub or name.");

  const now = Date.now();
  await saveConnection({
    accessToken: token.access_token,
    expiresAt: new Date(now + token.expires_in * 1000).toISOString(),
    scope: token.scope ?? SCOPE,
    connectedAt: new Date(now).toISOString(),
    profile: { sub: user.sub, name: user.name, email: user.email, picture: user.picture },
  });
}

export async function getStatus(): Promise<LinkedInStatus> {
  const connection = await readConnection();
  return {
    configured: getConfig() !== null,
    connected: connection !== null,
    expired: connection !== null && Date.parse(connection.expiresAt) <= Date.now(),
    expiresAt: connection?.expiresAt ?? null,
    connectedAt: connection?.connectedAt ?? null,
    profile: connection?.profile ?? null,
  };
}

// Best effort: revoke the token at LinkedIn (ignoring failures), then forget it locally.
export async function disconnect(): Promise<void> {
  const connection = await readConnection();
  const config = getConfig();
  if (connection && config) {
    try {
      await fetch(REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          token: connection.accessToken,
        }),
      });
    } catch {
      // Revoking is optional; the local token is deleted either way.
    }
  }
  await rm(CONNECTION_FILE, { force: true });
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
    if (!connection.accessToken || !connection.expiresAt || !connection.profile?.name) {
      throw new Error("missing fields");
    }
    return connection as Connection;
  } catch (error) {
    console.warn(`${CONNECTION_FILE} is not valid, treating LinkedIn as not connected:`, (error as Error).message);
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
