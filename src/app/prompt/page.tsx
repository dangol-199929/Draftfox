import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { PromptEditor } from "@/components/prompt-editor";

export const metadata: Metadata = { title: "Prompt" };

export default function PromptPage() {
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Prompt"
        description="The standing rules the model follows for every post. Changes apply to the next post you generate."
      />
      <PromptEditor />
    </div>
  );
}
