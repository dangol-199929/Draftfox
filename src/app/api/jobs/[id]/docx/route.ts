import { getJob } from "@/lib/db.ts";
import { textToDocx } from "@/lib/docx.ts";

export const runtime = "nodejs";

// ?doc=cv (the tailored CV) or ?doc=letter (the cover letter), as a Word file to download.
export async function GET(request: Request, ctx: RouteContext<"/api/jobs/[id]/docx">) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job) return Response.json({ error: "That job doesn't exist." }, { status: 404 });
  const doc = new URL(request.url).searchParams.get("doc");
  const text = doc === "cv" ? job.tailoredCv?.text : doc === "letter" ? job.letter?.text : undefined;
  if (!text) return Response.json({ error: "There's nothing to download yet." }, { status: 404 });

  const name = `${doc === "cv" ? "CV" : "Cover letter"} - ${job.company || job.title}`.replace(/[\/:*?"<>|]+/g, " ").trim();
  return new Response(Buffer.from(textToDocx(text, { title: doc === "cv" })), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "")}.docx"; filename*=UTF-8''${encodeURIComponent(name)}.docx`,
    },
  });
}
