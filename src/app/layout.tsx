import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { cn } from "@/lib/utils";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: { default: "LinkedIn AI Engine", template: "%s · LinkedIn AI Engine" },
  description: "Generate LinkedIn post drafts with a local LLM through Ollama",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)} suppressHydrationWarning>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <ThemeProvider attribute="class" defaultTheme="light" disableTransitionOnChange>
          <SiteHeader />
          <main className="mx-auto max-w-5xl px-4 py-8 sm:py-12">{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
