import { readCvFile } from "@/lib/profile.ts";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_CV_LENGTH = 30_000;

// Takes one CV file (.docx or .txt) as multipart form data and returns its text. The file is read in memory and
// not saved; the Profile page puts the text in the CV box, and it's saved with the profile.
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Send the file as multipart form data." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Choose a .docx or .txt file." }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "The file is larger than 10 MB." }, { status: 400 });
  try {
    const text = readCvFile(file.name, new Uint8Array(await file.arrayBuffer()));
    if (!text) return Response.json({ error: "No text was found in that file." }, { status: 400 });
    return Response.json({ text: text.slice(0, MAX_CV_LENGTH), truncated: text.length > MAX_CV_LENGTH });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
