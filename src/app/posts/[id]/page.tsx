import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PostEditor } from "@/components/post-editor";

export const metadata: Metadata = { title: "Edit post" };

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <Link
          href="/"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> All posts
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Edit post</h1>
      </div>
      <PostEditor id={id} />
    </div>
  );
}
