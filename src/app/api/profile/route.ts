import { EMPTY_PROFILE, deleteProfile, readProfile, saveProfile, validateProfile } from "@/lib/profile.ts";

export const runtime = "nodejs";

export async function GET() {
  const profile = await readProfile();
  return Response.json({ profile: profile ?? EMPTY_PROFILE, exists: profile !== null });
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const profile = validateProfile(body);
  if (typeof profile === "string") return Response.json({ error: profile }, { status: 400 });

  try {
    await saveProfile(profile);
  } catch (error) {
    console.error("Could not save the profile:", error);
    return Response.json({ error: `Could not save the profile: ${(error as Error).message}` }, { status: 500 });
  }
  return Response.json({ profile, exists: true });
}

export async function DELETE() {
  await deleteProfile();
  return Response.json({ profile: EMPTY_PROFILE, exists: false });
}
