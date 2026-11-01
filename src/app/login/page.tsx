import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  // Only go back to a page of this app after signing in, never to another site.
  const target = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  // Set when a plain form post (no script) came back with a problem.
  const message = typeof error === "string" ? error.slice(0, 200) : "";
  return <LoginForm next={target} initialError={message} />;
}
