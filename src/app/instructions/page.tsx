import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { BookOpenText, Check, Minus, PenLine, UserRound } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PromptEditor } from "@/components/prompt-editor";
import { readProfile } from "@/lib/profile.ts";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "AI instructions" };

// The writing instructions the model follows, and what else it's given with every post.
export default async function InstructionsPage() {
  await connection();
  const profile = await readProfile();
  const facts = Boolean(
    profile?.useFacts && (profile.headline || profile.facts.trim() || profile.skills.length || profile.positions.length),
  );
  const examples = profile?.useStyle ? Math.min(3, profile.posts.length) : 0;

  const inputs = [
    {
      icon: BookOpenText,
      title: "These instructions",
      text: "How to write: voice, words to avoid, format. Sent before every post.",
      on: true,
    },
    {
      icon: UserRound,
      title: "Facts from your profile",
      text: facts ? "Your headline, current role, skills and facts." : profile?.useFacts === false ? "Switched off on your profile." : "Nothing saved yet.",
      on: facts,
      href: "/profile",
    },
    {
      icon: PenLine,
      title: "Your past posts, for style",
      text: examples ? `${examples} recent post${examples === 1 ? "" : "s"} as examples of how you write.` : "None yet. Import your LinkedIn export on your profile.",
      on: examples > 0,
      href: "/profile?tab=import",
    },
  ];

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="AI"
        title="AI instructions"
        description="Tell the model how you like to write. These instructions, plus what you put in each post's topic and experience, are all it works from."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <PromptEditor />
        <aside className="grid gap-4 lg:sticky lg:top-6">
          <section className="overflow-hidden rounded-xl border bg-card shadow-card">
            <h2 className="border-b px-4 py-3 text-sm font-semibold tracking-tight">What the model sees</h2>
            <ul className="grid divide-y">
              {inputs.map((input) => {
                const body = (
                  <>
                    <span
                      className={cn(
                        "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full",
                        input.on ? "bg-success-soft text-success" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {input.on ? <Check className="size-3" /> : <Minus className="size-3" />}
                    </span>
                    <span className="grid gap-0.5">
                      <span className="text-sm font-medium">{input.title}</span>
                      <span className="text-xs text-muted-foreground">{input.text}</span>
                    </span>
                  </>
                );
                return (
                  <li key={input.title}>
                    {input.href ? (
                      <Link href={input.href} className="flex gap-3 px-4 py-3 transition-colors hover:bg-muted/60">
                        {body}
                      </Link>
                    ) : (
                      <div className="flex gap-3 px-4 py-3">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="grid gap-2 rounded-xl border border-dashed bg-surface/50 p-4 text-xs leading-relaxed text-muted-foreground">
            <p className="text-sm font-medium text-foreground">Tips</p>
            <p>Write the rules as plain sentences, like you&apos;d brief a colleague.</p>
            <p>
              Keep the &quot;NEED MORE CONTEXT:&quot; line if you want the model to ask questions when a topic is too
              vague, instead of guessing.
            </p>
            <p>Everything runs on your own computer through Ollama. Nothing is sent to a cloud AI.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
