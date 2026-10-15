import type { Metadata } from "next";
import { ImageSetup } from "@/components/image-setup";
import { PageHeader } from "@/components/page-header";
import { PromptEditor } from "@/components/prompt-editor";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="grid gap-8">
      <PageHeader title="Settings" description="How posts are written and how images are made." />
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
    </div>
  );
}
