import type { Metadata } from "next";
import { GenerateForm } from "@/components/generate-form";
import { PageHeader } from "@/components/page-header";

// The layout's title template only applies to nested routes, so the home page spells its title out.
export const metadata: Metadata = { title: { absolute: "Generate · LinkedIn AI Engine" } };

export default function GeneratePage() {
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Generate"
        description="Write a LinkedIn post draft from your topic and experience. Nothing is posted for you."
      />
      <GenerateForm />
    </div>
  );
}
