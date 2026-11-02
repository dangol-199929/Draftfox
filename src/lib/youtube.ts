// Server-only: Google OAuth for YouTube, asking only for permission to upload videos.
// Nothing is uploaded unless the user confirms it in the app.
// Tokens stay in data/youtube.json on this machine and are never sent to the browser or logged.
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
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

// --- Uploading ---

const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
export const PRIVACY_STATUSES = ["private", "unlisted", "public"] as const;
export type PrivacyStatus = (typeof PRIVACY_STATUSES)[number];

export type UploadDetails = {
  title: string;
  description: string;
  tags: string[];
  privacy: PrivacyStatus;
  // Declared to YouTube as altered or synthetic media. Generated videos are; your own uploads only if you say so.
  madeWithAi: boolean;
};

export type UploadedVideo = { id: string; url: string };

// Each request sends this much of the file, read from disk as it goes, so a 2 GB video never sits in memory.
// YouTube wants every chunk but the last to be a multiple of 256 KiB.
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

// Uploads an MP4 from disk with YouTube's resumable protocol, chunk by chunk. Pass the session URL of an attempt
// that broke off to continue it; onSession is called with a new session URL as soon as YouTube hands one out, so
// it can be saved. YouTube answers 308 with the bytes it has after each chunk but the last.
export async function uploadVideo(
  path: string,
  details: UploadDetails,
  session: string | null,
  onSession: (url: string | null) => void,
): Promise<UploadedVideo> {
  const file = await open(path, "r");
  try {
    const size = (await file.stat()).size;
    let offset = 0;
    if (session) {
      const status = await queryUpload(session, size);
      if (status.done) return status.done;
      if (status.offset === null) session = null;
      else offset = status.offset;
    }
    if (!session) {
      session = await startUpload(size, details);
      onSession(session);
    }

    const buffer = Buffer.alloc(Math.min(UPLOAD_CHUNK_BYTES, size));
    // Failures in a row; a chunk that gets through resets it. A dropped connection is resumed from where YouTube
    // says the upload got to.
    let failures = 0;
    for (;;) {
      const end = Math.min(offset + UPLOAD_CHUNK_BYTES, size);
      const { bytesRead } = await file.read(buffer, 0, end - offset, offset);
      if (bytesRead !== end - offset) throw new YouTubeError(500, "The video file changed while it was uploading.");
      const token = await getAccessToken();
      let response: Response;
      try {
        response = await fetch(session, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "video/mp4",
            "Content-Range": `bytes ${offset}-${end - 1}/${size}`,
          },
          body: new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead),
        });
      } catch {
        if (++failures >= 3) throw new YouTubeError(502, "The upload kept breaking off. Check your internet connection and try again.");
        const status = await queryUpload(session, size);
        if (status.done) return status.done;
        if (status.offset === null) throw new YouTubeError(502, "YouTube forgot the interrupted upload. Try again.");
        offset = status.offset;
        continue;
      }
      if (response.ok) return uploadedVideo(response);
      if (response.status === 308) {
        const range = response.headers.get("range")?.match(/bytes=0-(\d+)/);
        offset = range ? Number(range[1]) + 1 : 0;
        failures = 0;
        await response.arrayBuffer().catch(() => {});
        continue;
      }
      if (response.status >= 500 && ++failures < 3) {
        const status = await queryUpload(session, size);
        if (status.done) return status.done;
        if (status.offset !== null) {
          offset = status.offset;
          continue;
        }
      }
      if (response.status === 404 || response.status === 410) onSession(null);
      throw await uploadError(response);
    }
  } finally {
    await file.close();
  }
}

// Sends the title, description and settings; YouTube answers with the URL to send the video to.
async function startUpload(size: number, details: UploadDetails): Promise<string> {
  const token = await getAccessToken();
  let response: Response;
  try {
    response = await fetch(UPLOAD_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(size),
        "X-Upload-Content-Type": "video/mp4",
      },
      body: JSON.stringify({
        snippet: {
          title: details.title,
          description: details.description,
          tags: details.tags,
          categoryId: "22",
        },
        status: {
          privacyStatus: details.privacy,
          selfDeclaredMadeForKids: false,
          containsSyntheticMedia: details.madeWithAi,
        },
      }),
    });
  } catch {
    throw new YouTubeError(502, "Couldn't reach YouTube. Check your internet connection and try again.");
  }
  if (!response.ok) throw await uploadError(response);
  const location = response.headers.get("location");
  if (!location) throw new YouTubeError(502, "YouTube didn't return an upload address.");
  return location;
}

// Asks how much of an upload YouTube has. offset null means the session is gone and the upload must start over.
async function queryUpload(session: string, size: number): Promise<{ done?: UploadedVideo; offset: number | null }> {
  const token = await getAccessToken();
  let response: Response;
  try {
    response = await fetch(session, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Range": `bytes */${size}` },
    });
  } catch {
    throw new YouTubeError(502, "Couldn't reach YouTube. Check your internet connection and try again.");
  }
  if (response.ok) return { done: await uploadedVideo(response), offset: size };
  if (response.status === 308) {
    const range = response.headers.get("range")?.match(/bytes=0-(\d+)/);
    return { offset: range ? Number(range[1]) + 1 : 0 };
  }
  return { offset: null };
}

async function uploadedVideo(response: Response): Promise<UploadedVideo> {
  const video = (await response.json().catch(() => ({}))) as { id?: string };
  if (!video.id) throw new YouTubeError(502, "YouTube accepted the upload but didn't return the video's ID.");
  return { id: video.id, url: `https://youtube.com/shorts/${video.id}` };
}

async function uploadError(response: Response): Promise<YouTubeError> {
  const text = await response.text().catch(() => "");
  let reason = "";
  let message = text.slice(0, 300);
  try {
    const body = JSON.parse(text) as { error?: { message?: string; errors?: { reason?: string }[] } };
    reason = body.error?.errors?.[0]?.reason ?? "";
    message = body.error?.message ?? message;
  } catch {
    // Not JSON; keep the raw text.
  }
  if (response.status === 401) {
    return new YouTubeError(401, "YouTube refused the sign-in. Go to Settings and click Reconnect YouTube.");
  }
  if (reason === "quotaExceeded" || reason === "uploadLimitExceeded") {
    return new YouTubeError(429, "YouTube's daily upload limit is used up. Try again tomorrow.");
  }
  if (reason === "youtubeSignupRequired") {
    return new YouTubeError(403, "This Google account has no YouTube channel yet. Create one at youtube.com, then try again.");
  }
  return new YouTubeError(
    response.status >= 500 ? 502 : response.status,
    `YouTube rejected the upload (${response.status}${reason ? `, ${reason}` : ""})${message ? `: ${message}` : "."}`,
  );
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
