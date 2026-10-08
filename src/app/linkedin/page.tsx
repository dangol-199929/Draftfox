import { CheckCircle2, CircleAlert } from "lucide-react";
import { LinkedInPanel } from "@/components/linkedin-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getStatus } from "@/lib/linkedin.ts";

const ERRORS: Record<string, string> = {
  not_configured: "LinkedIn isn't set up yet. Add your app's Client ID and secret first (see below).",
  state_mismatch:
    "The sign-in couldn't be verified. It may have expired or been started in another tab. Please try again.",
  token_exchange_failed:
    "LinkedIn sign-in didn't finish. Check the Client ID, secret and redirect URL of your LinkedIn app, then try again.",
  user_cancelled_login: "You cancelled the LinkedIn sign-in. Nothing was connected.",
  user_cancelled_authorize: "You declined the permissions on LinkedIn. Nothing was connected.",
  unauthorized_scope_error:
    'LinkedIn refused the requested permissions. Make sure "Sign In with LinkedIn using OpenID Connect" is added to your app.',
};

export default async function LinkedInPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const status = await getStatus();

  const errorCode = typeof params.error === "string" ? params.error : null;
  const error = errorCode && (ERRORS[errorCode] ?? `LinkedIn sign-in failed (${errorCode}). Please try again.`);
  const justConnected = params.connected === "1" && status.connected && !errorCode;

  const formatDate = (iso: string) => new Date(iso).toLocaleDateString("en", { dateStyle: "medium" });
  const daysLeft = status.expiresAt
    ? Math.max(0, Math.ceil((Date.parse(status.expiresAt) - Date.now()) / 86_400_000))
    : 0;

  return (
    <div className="grid gap-4">
      {justConnected && (
        <Alert>
          <CheckCircle2 />
          <AlertTitle>LinkedIn connected</AlertTitle>
          <AlertDescription>Your name, email and photo were read. Nothing is ever posted.</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Couldn&apos;t connect LinkedIn</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <LinkedInPanel
        configured={status.configured}
        connected={status.connected}
        expired={status.expired}
        profile={status.profile}
        connectedOn={status.connectedAt ? formatDate(status.connectedAt) : null}
        daysLeft={daysLeft}
      />
    </div>
  );
}
