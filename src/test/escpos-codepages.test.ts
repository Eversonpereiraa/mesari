import { describe, expect, it } from "vitest";
import { CODE_PAGE_TABLES, decodeByte, encodeText } from "@/lib/escpos-codepages";

describe("tabelas de página de código", () => {
  it("cada tabela cobre exatamente os 128 bytes de 0x80 a 0xFF", () => {
    expect(CODE_PAGE_TABLES.CP860).toHaveLength(128);
    expect(CODE_PAGE_TABLES.CP850).toHaveLength(128);
    expect(CODE_PAGE_TABLES.WPC1252).toHaveLength(128);
  });

  it("CP860 usa os bytes oficiais para as maiúsculas acentuadas", () => {
    // Antes da correção, Ó, Ú e Ò caíam em posições da CP850 (saíam como α, Θ, Γ).
    expect(encodeText("ÓÚÒ", "CP860")).toEqual([0x9f, 0x96, 0xa9]);
    expect(encodeText("ÁÉÍÃÕÇÂÊÔÀ", "CP860")).toEqual([
      0x86, 0x90, 0x8b, 0x8e, 0x99, 0x80, 0x8f, 0x89, 0x8c, 0x91,
    ]);
    expect(encodeText("áéíóúãõçâêôà", "CP860")).toEqual([
      0xa0, 0x82, 0xa1, 0xa2, 0xa3, 0x84, 0x94, 0x87, 0x83, 0x88, 0x93, 0x85,
    ]);
  });

  it("ida e volta preserva o português nas três tabelas", () => {
    const text = "Ação Pão Ó Ú Ò Ç º ª ñ";
    for (const table of ["CP860", "CP850", "WPC1252"] as const) {
      const back = encodeText(text, table)
        .map((byte) => decodeByte(byte, table))
        .join("");
      expect(back).toBe(text);
    }
  });

  it("caractere sem equivalente perde o acento ou vira '?'", () => {
    expect(encodeText("ŝ", "CP860")).toEqual([0x73]);
    expect(encodeText("😀", "CP860")).toEqual([63]);
  });
});
