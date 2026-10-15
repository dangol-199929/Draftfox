// Server-only: Sign In with LinkedIn (OpenID Connect) plus posting through the Posts API.
// Nothing is posted unless the user confirms a post in the app.
// The access token stays in data/linkedin.json on this machine and is never sent to the browser or logged.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const POSTING_SCOPE = "w_member_social";
// Sign-in asks only for the basic scopes. Posting is a separate opt-in, because LinkedIn refuses the
// whole sign-in if w_member_social is requested before "Share on LinkedIn" is added to the app.
export const BASIC_SCOPE = "openid profile email";
export type LoginMode = "basic" | "posting";

export function scopeFor(mode: LoginMode): string {
  return mode === "posting" ? `${BASIC_SCOPE} ${POSTING_SCOPE}` : BASIC_SCOPE;
}
export const STATE_COOKIE = "linkedin_oauth_state";

const AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const REVOKE_URL = "https://www.linkedin.com/oauth/v2/revoke";
const USERINFO_URL = "https://api.linkedin.com/v2/userinfo";

// LinkedIn retires API versions after about a year. 202609 was the newest active one in October 2026.
export const LINKEDIN_VERSION = "202609";
// Only overridden in tests, to point the Posts API at a local mock server.
const API_BASE = process.env.LINKEDIN_API_BASE?.replace(/\/$/, "") || "https://api.linkedin.com";

// LinkedIn's limit for the text of a post.
export const MAX_POST_LENGTH = 3000;

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
  canPost: boolean;
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

export function authorizeUrl(config: LinkedInConfig, state: string, mode: LoginMode): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
    scope: scopeFor(mode),
  });
  return `${AUTHORIZE_URL}?${params}`;
}

// Swaps the one-time code from the callback for an access token, then reads the profile and saves both.
export async function connect(config: LinkedInConfig, code: string, mode: LoginMode): Promise<void> {
  const requestedScope = scopeFor(mode);
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
    scope: token.scope ?? requestedScope,
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
    canPost: connection !== null && hasPostingScope(connection.scope),
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

// LinkedIn returns the granted scopes comma-separated ("email,openid,profile"); scopeFor uses spaces.
function hasPostingScope(scope: string): boolean {
  return scope.split(/[\s,]+/).includes(POSTING_SCOPE);
}

export type Visibility = "PUBLIC" | "CONNECTIONS";

// An Error with the HTTP status from LinkedIn, so routes can pass it on.
export class LinkedInError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Post text uses LinkedIn's "little text format", where these characters have a meaning.
// Unescaped, they can cut the post short or get it rejected.
export function escapeLittleText(text: string): string {
  return text.replace(/[\\|{}@[\]()<>#*_~]/g, "\\$&");
}

// LinkedIn allows up to 20 images in one post.
export const MAX_POST_IMAGES = 20;

export type PostImageUpload = { data: Uint8Array; mime: string; altText: string };

export async function createPost({
  text,
  visibility,
  images = [],
}: {
  text: string;
  visibility: Visibility;
  images?: PostImageUpload[];
}): Promise<string> {
  const connection = await requirePostingConnection();
  if (images.length > MAX_POST_IMAGES) throw new LinkedInError(400, `A post can have at most ${MAX_POST_IMAGES} images.`);
  // Images are uploaded first; each becomes an image URN the post refers to.
  const media: { id: string; altText?: string }[] = [];
  for (const image of images) {
    const id = await uploadImage(connection, image);
    media.push(image.altText.trim() ? { id, altText: image.altText.trim().slice(0, 4086) } : { id });
  }
  const content =
    media.length === 1 ? { media: media[0] } : media.length > 1 ? { multiImage: { images: media } } : undefined;

  const response = await postsRequest(connection, "/rest/posts", {
    method: "POST",
    body: JSON.stringify({
      author: `urn:li:person:${connection.profile.sub}`,
      commentary: escapeLittleText(text),
      visibility,
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      ...(content && { content }),
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
  });
  const urn = response.headers.get("x-restli-id");
  if (!urn) throw new LinkedInError(502, "LinkedIn accepted the post but didn't return its ID.");
  return urn;
}

// Registers an upload with LinkedIn's Images API, then sends the bytes to the upload URL it returns.
async function uploadImage(connection: Connection, image: PostImageUpload): Promise<string> {
  const init = await postsRequest(connection, "/rest/images?action=initializeUpload", {
    method: "POST",
    body: JSON.stringify({ initializeUploadRequest: { owner: `urn:li:person:${connection.profile.sub}` } }),
  });
  const { value } = (await init.json()) as { value?: { uploadUrl?: string; image?: string } };
  if (!value?.uploadUrl || !value.image) throw new LinkedInError(502, "LinkedIn didn't return an image upload URL.");

  let upload: Response;
  try {
    upload = await fetch(value.uploadUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${connection.accessToken}`, "Content-Type": image.mime },
      body: new Uint8Array(image.data),
    });
  } catch {
    throw new LinkedInError(502, "Couldn't upload the image to LinkedIn. Check your internet connection and try again.");
  }
  if (!upload.ok) {
    throw new LinkedInError(502, `LinkedIn rejected the image upload (${upload.status}).`);
  }
  return value.image;
}

export async function deletePost(urn: string): Promise<void> {
  const connection = await requirePostingConnection();
  await postsRequest(connection, `/rest/posts/${encodeURIComponent(urn)}`, { method: "DELETE" });
}

async function requirePostingConnection(): Promise<Connection> {
  const connection = await readConnection();
  if (!connection) throw new LinkedInError(401, "LinkedIn isn't connected. Connect it on the Profile page.");
  if (Date.parse(connection.expiresAt) <= Date.now()) {
    throw new LinkedInError(401, "Your LinkedIn access has expired. Reconnect on the Profile page.");
  }
  if (!hasPostingScope(connection.scope)) {
    throw new LinkedInError(
      403,
      'Posting isn\'t enabled. Add "Share on LinkedIn" to your LinkedIn app, then click Enable posting on the Profile page.',
    );
  }
  return connection;
}

async function postsRequest(connection: Connection, path: string, init: RequestInit): Promise<Response> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      "LinkedIn-Version": LINKEDIN_VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
      "Content-Type": "application/json",
    },
  });
  if (response.ok) return response;

  const detail = await linkedInMessage(response);
  switch (response.status) {
    case 401:
      throw new LinkedInError(401, "Your LinkedIn access has expired or was revoked. Reconnect on the Profile page.");
    case 403:
      throw new LinkedInError(
        403,
        'LinkedIn refused: posting permission is missing. Add "Share on LinkedIn" to your LinkedIn app, then click Enable posting on the Profile page.',
      );
    case 426:
      throw new LinkedInError(
        502,
        `LinkedIn API version ${LINKEDIN_VERSION} is no longer active. Update LINKEDIN_VERSION in src/lib/linkedin.ts.`,
      );
    case 429:
      throw new LinkedInError(429, "LinkedIn says too many requests. Wait a while and try again.");
    default:
      throw new LinkedInError(
        response.status >= 500 ? 502 : response.status,
        `LinkedIn rejected the request (${response.status})${detail ? `: ${detail}` : "."}`,
      );
  }
}

async function linkedInMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const { message } = JSON.parse(text) as { message?: string };
    return message ?? "";
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
