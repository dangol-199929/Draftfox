import { IMAGE_TYPES, MAX_IMAGE_BYTES, saveImage, sniffImageType } from "@/lib/images.ts";

export const runtime = "nodejs";

// Takes one or more images as multipart form data ("files") and returns their ids.
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Send the images as multipart form data." }, { status: 400 });
  }
  const files = form.getAll("files").filter((value): value is File => value instanceof File);
  if (files.length === 0) return Response.json({ error: "Choose at least one image." }, { status: 400 });

  const images = [];
  for (const file of files) {
    if (file.size > MAX_IMAGE_BYTES) {
      return Response.json({ error: `"${file.name}" is larger than 10 MB.` }, { status: 400 });
    }
    const data = new Uint8Array(await file.arrayBuffer());
    const mime = sniffImageType(data);
    if (!mime || !IMAGE_TYPES[mime]) {
      return Response.json({ error: `"${file.name}" isn't a PNG, JPG or GIF image.` }, { status: 400 });
    }
    const record = await saveImage(data, mime, "upload");
    images.push({ id: record.id });
  }
  return Response.json({ images }, { status: 201 });
}
