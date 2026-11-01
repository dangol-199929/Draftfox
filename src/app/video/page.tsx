import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { VideoStudio } from "@/components/video-studio";

export const metadata: Metadata = { title: "Video Studio" };

export default function VideoPage() {
  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Create"
        title="Video Studio"
        description="Short vertical videos with a retro look, made on this PC: a script, scene images, a voice, captions and music. Review each one, change what you don't like, then download it."
      />
      <VideoStudio />
    </div>
  );
}
