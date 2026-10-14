import { badRequest, readJsonObject } from "@/lib/api.ts";
import { addSavedSearch, listSavedSearches } from "@/lib/job-search.ts";
import { parseSearchInput } from "@/lib/job-links.ts";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ searches: listSavedSearches().map(({ seen, ...search }) => ({ ...search, seenCount: seen.length })) });
}

// Body: { name?, queries, country, place?, skills? }. Saves the search so you can run it again later.
export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body) return badRequest("Request body must be a JSON object.");
  const input = parseSearchInput(body);
  if (typeof input === "string") return badRequest(input);
  const search = addSavedSearch({ ...input, name: typeof body.name === "string" ? body.name : "" });
  if (typeof search === "string") return badRequest(search);
  return Response.json({ search }, { status: 201 });
}
