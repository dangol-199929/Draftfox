"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

// A terminal command with a copy button.
export function CommandLine({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mt-2 flex items-center gap-1 rounded-md border bg-surface pl-3 text-foreground">
      <code className="min-w-0 flex-1 overflow-x-auto py-1.5 font-mono text-xs whitespace-nowrap">{command}</code>
      <Button variant="ghost" size="icon-sm" aria-label={`Copy "${command}"`} onClick={copy}>
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}
