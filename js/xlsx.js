/* Minimal, dependency-free .xlsx writer (OOXML, store-only ZIP). Enough to emit a multi-sheet
 * workbook with number / text / formula cells (formulas carry a cached value so the file is valid
 * and shows numbers even before a recalc). Opens in Excel, Google Sheets, LibreOffice, Numbers.
 * The byte builder (WENXLSX.build) is environment-agnostic so it can be unit-tested in Node. */
(function (root) {
  "use strict";
  const enc = new TextEncoder();

  // ---- CRC32 (for ZIP entries) ----
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  // ---- store-only ZIP ----
  function zip(files) {
    const parts = [], central = []; let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = f.data, crc = crc32(data), sz = data.length;
      const lh = new Uint8Array(30 + name.length), dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true); /* UTF-8 */
      dv.setUint16(8, 0, true); dv.setUint16(10, 0, true); dv.setUint16(12, 0x21, true); /* dummy time/date */
      dv.setUint32(14, crc, true); dv.setUint32(18, sz, true); dv.setUint32(22, sz, true);
      dv.setUint16(26, name.length, true); dv.setUint16(28, 0, true); lh.set(name, 30);
      parts.push(lh, data);
      const cd = new Uint8Array(46 + name.length), cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, sz, true); cv.setUint32(24, sz, true);
      cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); cd.set(name, 46);
      central.push(cd); offset += lh.length + data.length;
    }
    let cdSize = 0; for (const c of central) cdSize += c.length;
    const eocd = new Uint8Array(22), ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
    const all = [...parts, ...central, eocd]; let total = 0; for (const a of all) total += a.length;
    const out = new Uint8Array(total); let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  function colName(i) { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26 | 0; } return s; }

  // a cell is a primitive (number/string) or { f:"FORMULA", v:cachedValue } or { t:"title", b:true }
  function cellXml(ref, cell) {
    if (cell == null || cell === "") return "";
    if (typeof cell === "number") return `<c r="${ref}"><v>${cell}</v></c>`;
    if (typeof cell === "object" && cell.f != null) {
      const v = cell.v != null ? `<v>${typeof cell.v === "number" ? cell.v : esc(cell.v)}</v>` : "";
      const s = cell.s ? ` s="${cell.s}"` : "";
      return `<c r="${ref}"${s}><f>${esc(cell.f)}</f>${v}</c>`;
    }
    const text = typeof cell === "object" ? cell.t : cell;
    const s = (typeof cell === "object" && cell.b) ? ` s="1"` : "";
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
  }

  function sheetXml(rows) {
    let body = "";
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r] || []; let cells = "";
      for (let c = 0; c < row.length; c++) cells += cellXml(colName(c) + (r + 1), row[c]);
      body += `<row r="${r + 1}">${cells}</row>`;
    }
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
  }

  // sheets: [{ name, rows:[[cell,...],...] }]
  function build(sheets) {
    const files = [];
    files.push({ name: "[Content_Types].xml", data: enc.encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
      `</Types>`) });
    files.push({ name: "_rels/.rels", data: enc.encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`) });
    files.push({ name: "xl/workbook.xml", data: enc.encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
      sheets.map((s, i) => `<sheet name="${esc(s.name).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
      `</sheets></workbook>`) });
    files.push({ name: "xl/_rels/workbook.xml.rels", data: enc.encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`) });
    // minimal styles: s="1" = bold (for headers)
    files.push({ name: "xl/styles.xml", data: enc.encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
      `<fills count="1"><fill><patternFill patternType="none"/></fill></fills>` +
      `<borders count="1"><border/></borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
      `</styleSheet>`) });
    sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(sheetXml(s.rows)) }));
    return zip(files);
  }

  function download(filename, bytes) {
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  }

  const api = { build, download, colName, crc32 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.WENXLSX = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
