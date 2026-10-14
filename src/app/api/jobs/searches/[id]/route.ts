import { deleteSavedSearch } from "@/lib/job-search.ts";

export const runtime = "nodejs";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/jobs/searches/[id]">) {
  const { id } = await ctx.params;
  if (!deleteSavedSearch(id)) return Response.json({ error: "That saved search doesn't exist." }, { status: 404 });
  return Response.json({ deleted: true });
}
