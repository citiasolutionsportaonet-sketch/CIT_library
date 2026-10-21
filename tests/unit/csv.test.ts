import { describe, expect, it } from "vitest";
import { csvCell } from "@/modules/catalog/export";

describe("CSV seguro", () => {
  it.each([
    ["=HYPERLINK(\"http://x\")", "\"'=HYPERLINK(\"\"http://x\"\")\""],
    ["+5511", "'+5511"],
    ["-2+3", "'-2+3"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\tx", "'\tx"],
  ])("neutraliza %s", (v, out) => expect(csvCell(v)).toBe(out));
  it("preserva códigos e texto comum", () => {
    expect(csvCell("0004001")).toBe("0004001");
    expect(csvCell("Câmera; dome")).toBe("\"Câmera; dome\"");
    expect(csvCell(null)).toBe("");
  });
});
