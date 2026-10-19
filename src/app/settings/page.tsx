import type { Metadata } from "next";
import Link from "next/link";
import { WandSparkles } from "lucide-react";
import { AppearanceSettings } from "@/components/appearance-settings";
import { ImageSetup } from "@/components/image-setup";
import { JobSettingsCard } from "@/components/job-settings";
import { OllamaSettings } from "@/components/ollama-settings";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Settings" };

const SECTIONS = [
  { id: "local-ai", label: "Local AI" },
  { id: "images", label: "Images" },
  { id: "jobs", label: "Jobs" },
  { id: "appearance", label: "Appearance" },
];

export default function SettingsPage() {
  return (
    <div className="grid gap-8">
      <PageHeader
        eyebrow="AI"
        title="Settings"
        description="The local model and image engine this app uses, what the Jobs pages prepare for you, and how it looks."
      />
      <div className="grid gap-8 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="lg:sticky lg:top-6 lg:self-start">
          <ul className="flex gap-1 overflow-x-auto lg:grid">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="block rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {section.label}
                </a>
              </li>
            ))}
            <li className="lg:mt-3 lg:border-t lg:pt-3">
              <Link
                href="/instructions"
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <WandSparkles className="size-3.5" />
                AI instructions
              </Link>
            </li>
          </ul>
        </nav>
        <div className="grid gap-10">
          <Section id="local-ai" title="Local AI">
            <OllamaSettings />
          </Section>
          <Section id="images" title="Images">
            <ImageSetup />
          </Section>
          <Section id="jobs" title="Jobs">
            <JobSettingsCard />
          </Section>
          <Section id="appearance" title="Appearance">
            <AppearanceSettings />
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="grid scroll-mt-20 gap-3" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}
