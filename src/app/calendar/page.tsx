import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { CalendarView } from "@/components/posts-library";

export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { post } = await searchParams;
  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Create"
        title="Publishing calendar"
        description="What goes out when, and what already went out. Open a post to edit it or change its time."
      />
      <CalendarView initialPost={typeof post === "string" ? post : null} />
    </div>
  );
}
