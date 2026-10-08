import { importExport, saveProfile } from "@/lib/profile.ts";

export const runtime = "nodejs";

const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

// Takes the LinkedIn export (.zip or .csv files) as multipart form data. Files are read in memory, never saved.
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Send the files as multipart form data." }, { status: 400 });
  }

  const files = form.getAll("files").filter((value): value is File => value instanceof File);
  if (files.length === 0) return Response.json({ error: "Choose at least one .zip or .csv file." }, { status: 400 });
  if (files.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_BYTES) {
    return Response.json({ error: "The files are larger than 100 MB in total." }, { status: 400 });
  }
  const unsupported = files.find((file) => !/\.(zip|csv)$/i.test(file.name));
  if (unsupported) return Response.json({ error: `"${unsupported.name}" isn't a .zip or .csv file.` }, { status: 400 });

  try {
    const uploads = await Promise.all(
      files.map(async (file) => ({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) })),
    );
    const { profile, summary } = await importExport(uploads);
    if (summary.files.length === 0) {
      return Response.json(
        { error: "No Profile, Positions, Skills, Education or Shares CSV was found in the upload." },
        { status: 400 },
      );
    }
    await saveProfile(profile);
    return Response.json({ profile, summary });
  } catch (error) {
    console.error("Profile import failed:", (error as Error).message);
    return Response.json({ error: `Couldn't read the files: ${(error as Error).message}` }, { status: 400 });
  }
}
