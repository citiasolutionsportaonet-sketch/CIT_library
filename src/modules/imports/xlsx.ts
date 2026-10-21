// Leitor XLSX mínimo e defensivo (fflate + fast-xml-parser).
// - Não executa fórmulas nem macros e não segue links externos: só lê XML.
// - Limita tamanho descompactado, número de abas, linhas e colunas.
// - Rejeita XLS/XLSM, arquivos criptografados e zip malformado.
// - Informa, por célula, se havia fórmula (o valor lido é o último salvo).
import { strFromU8, unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";

export const XLSX_LIMITS = {
  maxFileBytes: 20 * 1024 * 1024,
  maxUncompressedBytes: 150 * 1024 * 1024,
  maxSheets: 20,
  maxRows: 20_000,
  maxCols: 100,
};

export class XlsxError extends Error {}

export type Cell = { value: string; formula: boolean };
export type Sheet = { name: string; rows: { rowNumber: number; cells: (Cell | null)[] }[] };

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  parseTagValue: false, // nunca converter números: preserva zeros e texto exato
  parseAttributeValue: false,
  trimValues: false,
  processEntities: true,
  removeNSPrefix: true, // planilhas geradas por alguns sistemas usam <x:row>, <x:c>…
  htmlEntities: false,
  isArray: (name) => ["sheet", "row", "c", "si", "r", "Relationship"].includes(name),
});

const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function text(node: unknown): string {
  if (node === undefined || node === null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  const o = node as Record<string, unknown>;
  if ("#text" in o) return String(o["#text"]);
  // rich text <r><t>..</t></r> e <t>
  if ("t" in o || "r" in o) return [text(o.t), ...arr(o.r as unknown[]).map((r) => text((r as Record<string, unknown>).t))].join("");
  return "";
}

function colIndex(ref: string): number {
  const m = /^([A-Z]{1,3})\d+$/.exec(ref);
  if (!m) throw new XlsxError(`Referência de célula inválida: ${ref}`);
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function readXlsx(buf: Uint8Array, opts: { sheetName?: string } = {}): { sheetNames: string[]; sheet: Sheet } {
  if (buf.byteLength > XLSX_LIMITS.maxFileBytes) throw new XlsxError("Arquivo acima de 20 MB.");
  // Assinaturas: OLE2 (XLS antigo ou XLSX criptografado) e ZIP.
  if (buf[0] === 0xd0 && buf[1] === 0xcf) throw new XlsxError("Arquivo XLS antigo ou criptografado. Salve como .xlsx sem senha.");
  if (!(buf[0] === 0x50 && buf[1] === 0x4b)) throw new XlsxError("Não é um arquivo XLSX válido.");

  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buf, {
      filter: (f) => {
        total += f.originalSize;
        if (total > XLSX_LIMITS.maxUncompressedBytes) throw new XlsxError("Conteúdo descompactado grande demais.");
        return /^(\[Content_Types\]\.xml|xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/sharedStrings\.xml|xl\/worksheets\/sheet\d+\.xml|xl\/vbaProject\.bin)$/.test(f.name);
      },
    });
  } catch (e) {
    if (e instanceof XlsxError) throw e;
    throw new XlsxError("Arquivo compactado corrompido.");
  }
  if (files["xl/vbaProject.bin"]) throw new XlsxError("Planilhas com macros (XLSM) não são aceitas.");
  const ct = files["[Content_Types].xml"] ? strFromU8(files["[Content_Types].xml"]) : "";
  if (/macroEnabled/i.test(ct)) throw new XlsxError("Planilhas com macros (XLSM) não são aceitas.");
  if (!files["xl/workbook.xml"]) throw new XlsxError("Estrutura XLSX incompleta.");

  const shared: string[] = files["xl/sharedStrings.xml"]
    ? arr(parser.parse(strFromU8(files["xl/sharedStrings.xml"])).sst?.si).map(text)
    : [];

  const wb = parser.parse(strFromU8(files["xl/workbook.xml"]));
  const sheets = arr(wb.workbook?.sheets?.sheet) as Record<string, string>[];
  if (sheets.length === 0) throw new XlsxError("Planilha sem abas.");
  if (sheets.length > XLSX_LIMITS.maxSheets) throw new XlsxError(`Mais de ${XLSX_LIMITS.maxSheets} abas.`);
  const rels = arr(parser.parse(strFromU8(files["xl/_rels/workbook.xml.rels"] ?? new Uint8Array())).Relationships?.Relationship) as Record<string, string>[];
  const sheetNames = sheets.map((s) => String(s["@name"]));
  const chosen = opts.sheetName ? sheets.find((s) => s["@name"] === opts.sheetName) : sheets[0];
  if (!chosen) throw new XlsxError(`Aba "${opts.sheetName}" não encontrada.`);
  const target = rels.find((r) => r["@Id"] === (chosen["@id"] ?? chosen["@r:id"]))?.["@Target"] ?? "";
  const path = target.replace(/^\//, "").replace(/^(?!xl\/)/, "xl/");
  if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(path) || !files[path]) throw new XlsxError("Aba com destino inválido.");

  const ws = parser.parse(strFromU8(files[path]));
  const rowsXml = arr(ws.worksheet?.sheetData?.row) as Record<string, unknown>[];
  if (rowsXml.length > XLSX_LIMITS.maxRows + 1) throw new XlsxError(`Mais de ${XLSX_LIMITS.maxRows} linhas.`);
  const rows: Sheet["rows"] = [];
  for (const r of rowsXml) {
    const cells: (Cell | null)[] = [];
    for (const c of arr(r.c) as Record<string, unknown>[]) {
      const idx = colIndex(String(c["@r"]));
      if (idx >= XLSX_LIMITS.maxCols) throw new XlsxError(`Mais de ${XLSX_LIMITS.maxCols} colunas.`);
      const t = c["@t"];
      let value = "";
      if (t === "s") value = shared[Number(text(c.v))] ?? "";
      else if (t === "inlineStr") value = text(c.is);
      else value = text(c.v);
      cells[idx] = { value, formula: c.f !== undefined };
    }
    rows.push({ rowNumber: Number(r["@r"]), cells });
  }
  return { sheetNames, sheet: { name: String(chosen["@name"]), rows } };
}
