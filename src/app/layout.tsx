import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { cn } from "@/lib/utils";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: { default: "Draftfox", template: "%s · Draftfox" },
  description: "Local AI for LinkedIn posts: drafts, designed images and scheduling. Free, private, open source.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)} suppressHydrationWarning>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <ThemeProvider attribute="class" defaultTheme="light" disableTransitionOnChange>
          <SiteHeader />
          <div className="md:pl-56">
            <main className="mx-auto max-w-6xl px-4 pt-6 pb-24 sm:px-6 md:px-8 md:py-10">{children}</main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
