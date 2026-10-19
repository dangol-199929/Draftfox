import type { Metadata } from "next";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ProfileEditor, type ProfileTab } from "@/components/profile-editor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getStatus } from "@/lib/linkedin.ts";

export const metadata: Metadata = { title: "Profile & connection" };

const ERRORS: Record<string, string> = {
  not_configured: "LinkedIn isn't set up yet. Add your app's Client ID and secret first (see How to set it up).",
  state_mismatch:
    "The sign-in couldn't be verified. It may have expired or been started in another tab. Please try again.",
  token_exchange_failed:
    "LinkedIn sign-in didn't finish. Check the Client ID, secret and redirect URL of your LinkedIn app, then try again.",
  user_cancelled_login: "You cancelled the LinkedIn sign-in. Nothing was connected.",
  user_cancelled_authorize: "You declined the permissions on LinkedIn. Nothing was connected.",
  unauthorized_scope_error:
    'LinkedIn refused the requested permissions. Make sure "Sign In with LinkedIn using OpenID Connect" is added to your app.',
  posting_not_enabled:
    "LinkedIn refused posting permission. Add the 'Share on LinkedIn' product to your developer app (Products tab), then click Enable posting again.",
};

const TABS: ProfileTab[] = ["about", "cv", "import"];

// Who you are (for posts and applications), your CV, the LinkedIn import and the LinkedIn connection, on one page.
export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const status = await getStatus();

  const errorCode = typeof params.error === "string" ? params.error : null;
  const error = errorCode && (ERRORS[errorCode] ?? `LinkedIn sign-in failed (${errorCode}). Please try again.`);
  const detail = typeof params.detail === "string" ? params.detail.slice(0, 300) : "";
  const justConnected = params.connected === "1" && status.connected && !errorCode;
  const tab = TABS.find((value) => value === params.tab);

  const daysLeft = status.expiresAt
    ? Math.max(0, Math.ceil((Date.parse(status.expiresAt) - Date.now()) / 86_400_000))
    : 0;

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="LinkedIn"
        title="Profile & connection"
        description="Your LinkedIn connection, the facts about you, your CV and examples of your writing, so posts and applications sound like you without inventing anything. Everything stays on this computer."
      />
      {justConnected && (
        <Alert variant="success">
          <CheckCircle2 />
          <AlertTitle>LinkedIn connected</AlertTitle>
          <AlertDescription>
            Your name, email and photo were read. Nothing is posted unless you click Post and confirm.
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>
            {errorCode === "posting_not_enabled" ? "Couldn't enable posting" : "Couldn't connect LinkedIn"}
          </AlertTitle>
          <AlertDescription>
            <p>{error}</p>
            {detail && <p className="pt-1 text-xs text-muted-foreground">LinkedIn said: {detail}</p>}
          </AlertDescription>
        </Alert>
      )}
      <ProfileEditor
        initialTab={tab}
        linkedInProfile={status.connected ? status.profile : null}
        linkedIn={{
          configured: status.configured,
          connected: status.connected && status.profile !== null,
          expired: status.expired,
          canPost: status.canPost,
          connectedOn: status.connectedAt
            ? new Date(status.connectedAt).toLocaleDateString("en", { dateStyle: "medium" })
            : null,
          daysLeft,
        }}
      />
    </div>
  );
}
