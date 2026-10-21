import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readXlsx } from "@/modules/imports/xlsx";

function book(sheetXml: string, extra: Record<string, string> = {}) {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    "xl/workbook.xml": strToU8('<workbook xmlns:r="r"><sheets><sheet name="Planilha1" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/sharedStrings.xml": strToU8("<sst><si><t>Código</t></si><si><t>Câmera &amp; Kit</t></si><si><r><t>Rich </t></r><r><t>Text</t></r></si></sst>"),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData>${sheetXml}</sheetData></worksheet>`),
  };
  for (const [k, v] of Object.entries(extra)) files[k] = strToU8(v);
  return zipSync(files);
}

describe("leitor XLSX", () => {
  it("lê strings compartilhadas, rich text, números exatos e zeros à esquerda", () => {
    const { sheet } = readXlsx(book('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>000123</t></is></c><c r="C2"><v>121.09</v></c></row>'));
    expect(sheet.rows[0].cells.map((c) => c?.value)).toEqual(["Código", "Câmera & Kit", "Rich Text"]);
    expect(sheet.rows[1].cells[0]?.value).toBe("000123");
    expect(sheet.rows[1].cells[1]).toBeUndefined();
    expect(sheet.rows[1].cells[2]?.value).toBe("121.09");
  });
  it("aceita XML com prefixo de namespace (<x:row>)", () => {
    const files = {
      "[Content_Types].xml": strToU8("<Types/>"),
      "xl/workbook.xml": strToU8('<x:workbook xmlns:x="m" xmlns:r="r"><x:sheets><x:sheet name="Catalogo" sheetId="1" r:id="rId9"/></x:sheets></x:workbook>'),
      "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId9" Target="/xl/worksheets/sheet1.xml"/></Relationships>'),
      "xl/worksheets/sheet1.xml": strToU8('<x:worksheet xmlns:x="m"><x:sheetData><x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>4000034</x:t></x:is></x:c><x:c r="B1"><x:v>121.09</x:v></x:c></x:row></x:sheetData></x:worksheet>'),
    };
    const { sheet, sheetNames } = readXlsx(zipSync(files));
    expect(sheetNames).toEqual(["Catalogo"]);
    expect(sheet.rows[0].cells.map((c) => c?.value)).toEqual(["4000034", "121.09"]);
  });
  it("marca células com fórmula", () => {
    const { sheet } = readXlsx(book('<row r="1"><c r="A1"><f>B1*2</f><v>4</v></c></row>'));
    expect(sheet.rows[0].cells[0]).toEqual({ value: "4", formula: true });
  });
  it("recusa XLSM, XLS antigo e não-zip", () => {
    expect(() => readXlsx(book("", { "xl/vbaProject.bin": "x" }))).toThrow(/macros/);
    expect(() => readXlsx(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toThrow(/XLS antigo/);
    expect(() => readXlsx(strToU8("a,b,c"))).toThrow(/não é um arquivo XLSX/i);
  });
  it("recusa colunas além do limite", () => {
    expect(() => readXlsx(book('<row r="1"><c r="DA1"><v>1</v></c></row>'))).toThrow(/colunas/);
  });
});
