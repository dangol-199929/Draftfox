import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PostsLibrary } from "@/components/posts-library";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Posts" };

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { post } = await searchParams;
  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Create"
        title="Posts"
        description="Every draft, scheduled and published post, in one place. Open one to edit, schedule or duplicate it."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/calendar">
                <CalendarDays />
                Calendar
              </Link>
            </Button>
            <Button asChild>
              <Link href="/write">
                <Sparkles />
                Write with AI
              </Link>
            </Button>
          </>
        }
      />
      <PostsLibrary initialPost={typeof post === "string" ? post : null} />
    </div>
  );
}
