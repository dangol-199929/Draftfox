// Server-only: a minimal Word .docx from plain text, zipped with fflate (already a dependency), so a tailored CV
// or cover letter can be opened and finished in Word, Pages or Google Docs.
// Lines starting with "# " become headings, "- " bullets; with `title`, the first line is a large name line.
import { strToU8, zipSync } from "fflate";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function paragraph(text: string, { size = 22, bold = false, before = 0, after = 80, indent = false } = {}): string {
  const spacing = `<w:spacing w:before="${before}" w:after="${after}"/>`;
  const ind = indent ? `<w:ind w:left="360" w:hanging="240"/>` : "";
  const run = text
    ? `<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>${bold ? "<w:b/>" : ""}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${escape(text)}</w:t></w:r>`
    : "";
  return `<w:p><w:pPr>${spacing}${ind}</w:pPr>${run}</w:p>`;
}

export function textToDocx(text: string, { title = false } = {}): Uint8Array {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const body = lines
    .map((line, i) => {
      const trimmed = line.trim();
      if (title && i === 0) return paragraph(trimmed, { size: 36, bold: true, after: 40 });
      if (trimmed.startsWith("# ")) return paragraph(trimmed.slice(2), { size: 26, bold: true, before: 240, after: 80 });
      if (/^[-•*] /.test(trimmed)) return paragraph(`• ${trimmed.slice(2)}`, { indent: true, after: 40 });
      return paragraph(trimmed);
    })
    .join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  return zipSync({
    "[Content_Types].xml": strToU8(CONTENT_TYPES),
    "_rels/.rels": strToU8(RELS),
    "word/document.xml": strToU8(document),
  });
}
