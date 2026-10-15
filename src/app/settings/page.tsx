import type { Metadata } from "next";
import { ImageSetup } from "@/components/image-setup";
import { JobSettingsCard } from "@/components/job-settings";
import { PageHeader } from "@/components/page-header";
import { PromptEditor } from "@/components/prompt-editor";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="grid gap-8">
      <PageHeader title="Settings" description="How posts are written, how images are made, and what the Jobs page prepares for you." />
      <section className="grid gap-3" aria-labelledby="writing-heading">
        <h2 id="writing-heading" className="text-sm font-medium text-muted-foreground">
          Writing
        </h2>
        <PromptEditor />
      </section>
      <section className="grid gap-3" aria-labelledby="images-heading">
        <h2 id="images-heading" className="text-sm font-medium text-muted-foreground">
          Images
        </h2>
        <ImageSetup />
      </section>
      <section className="grid gap-3" aria-labelledby="jobs-heading">
        <h2 id="jobs-heading" className="text-sm font-medium text-muted-foreground">
          Jobs
        </h2>
        <JobSettingsCard />
      </section>
    </div>
  );
}
