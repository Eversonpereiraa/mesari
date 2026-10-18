import { describe, expect, it } from "vitest";
import { encodeText } from "@/lib/escpos-codepages";
import { decodeEscPos, previewToText, type LinhaPreview } from "@/lib/escpos-preview";
import { escPosKitchenTicket, getDefaultPrintSettings, type KitchenTicket } from "@/lib/printing";

const ESC = 0x1b;
const GS = 0x1d;
const texto = (value: string) => [...encodeText(value, "CP860"), 0x0a];
const linhasDeTexto = (linhas: LinhaPreview[]) =>
  linhas.filter(
    (linha): linha is Extract<LinhaPreview, { tipo: "texto" }> => linha.tipo === "texto",
  );

describe("decodificador ESC/POS", () => {
  it("reconhece negrito, alinhamento e tamanho duplo", () => {
    const bytes = [
      ESC,
      0x40,
      ESC,
      0x74,
      3,
      ESC,
      0x61,
      1,
      ESC,
      0x45,
      1,
      GS,
      0x21,
      0x11,
      ...texto("MESA 07"),
      ESC,
      0x61,
      2,
      ESC,
      0x45,
      0,
      GS,
      0x21,
      0,
      ...texto("direita"),
      ESC,
      0x61,
      0,
      ...texto("esquerda"),
    ];
    const [mesa, direita, esquerda] = linhasDeTexto(decodeEscPos(bytes, { columns: 32 }).linhas);
    expect(mesa).toMatchObject({
      texto: "MESA 07",
      alinhamento: "centro",
      negrito: true,
      tamanhoDuplo: true,
      colunas: 14,
    });
    expect(direita).toMatchObject({
      texto: "direita",
      alinhamento: "direita",
      negrito: false,
      tamanhoDuplo: false,
    });
    expect(esquerda).toMatchObject({ alinhamento: "esquerda" });
  });

  it("ESC @ volta tudo ao padrão", () => {
    const bytes = [ESC, 0x45, 1, GS, 0x21, 0x11, ESC, 0x61, 1, ESC, 0x40, ...texto("normal")];
    expect(linhasDeTexto(decodeEscPos(bytes, { columns: 32 }).linhas)[0]).toMatchObject({
      negrito: false,
      tamanhoDuplo: false,
      alinhamento: "esquerda",
    });
  });

  it("mostra avanço de papel e o corte", () => {
    const bytes = [...texto("fim"), ESC, 0x64, 3, GS, 0x56, 66, 3];
    const { linhas } = decodeEscPos(bytes, { columns: 32 });
    expect(linhas.map((linha) => (linha.tipo === "texto" ? linha.texto : linha.tipo))).toEqual([
      "fim",
      "",
      "",
      "",
      "corte",
    ]);
    expect(linhas.at(-1)).toEqual({ tipo: "corte", parcial: true });
    expect(decodeEscPos([GS, 0x56, 0], { columns: 32 }).linhas).toEqual([
      { tipo: "corte", parcial: false },
    ]);
  });

  it("decodifica acentos em CP860 de volta para o texto original", () => {
    const original = "AÇÚCAR, ÓLEO, PÃO, FEIJÃO À MODA, coração";
    const bytes = [ESC, 0x74, 3, ...texto(original)];
    const preview = decodeEscPos(bytes, { columns: 64 });
    expect(preview.tabela).toBe("CP860");
    expect(linhasDeTexto(preview.linhas)[0]?.texto).toBe(original);
  });

  it("mostra '?' quando o caractere não existe na tabela", () => {
    const bytes = [ESC, 0x74, 3, ...texto("Café ☕")];
    expect(linhasDeTexto(decodeEscPos(bytes, { columns: 32 }).linhas)[0]?.texto).toBe("Café ?");
  });

  it("marca linha que estoura as colunas (normal e tamanho duplo)", () => {
    const longa = "x".repeat(33);
    const dupla = [GS, 0x21, 0x11, ...texto("y".repeat(17))];
    const linhas = linhasDeTexto(decodeEscPos([...texto(longa), ...dupla], { columns: 32 }).linhas);
    expect(linhas[0]).toMatchObject({ colunas: 33, estoura: true });
    expect(linhas[1]).toMatchObject({ colunas: 34, estoura: true });
    expect(
      linhasDeTexto(decodeEscPos(texto("x".repeat(32)), { columns: 32 }).linhas)[0]?.estoura,
    ).toBe(false);
  });

  it.each([
    [58, 32],
    [80, 48],
  ] as const)(
    "comanda real quebra as linhas certinho em %smm (%s colunas)",
    (paperWidth, columns) => {
      const ticket: KitchenTicket = {
        id: "t1",
        number: 41,
        table: 7,
        sector: "cozinha",
        waiter: "Ana",
        additional: false,
        createdAt: new Date("2026-10-18T20:00:00").getTime(),
        items: [
          {
            product: "Parmegiana de frango com arroz, feijão tropeiro e batata frita",
            quantity: 2,
            note: "sem cebola, molho à parte e queijo bem derretido por cima",
            unitPrice: 54.9,
          },
        ],
      };
      const settings = { ...getDefaultPrintSettings(), paperWidth, columns };
      const preview = decodeEscPos(escPosKitchenTicket(ticket, settings), { columns });
      const linhas = linhasDeTexto(preview.linhas);
      expect(linhas.filter((linha) => linha.estoura)).toEqual([]);
      expect(Math.max(...linhas.map((linha) => linha.colunas))).toBeLessThanOrEqual(columns);
      expect(linhas.some((linha) => linha.texto === "-".repeat(columns))).toBe(true);
      expect(preview.linhas.at(-1)).toEqual({ tipo: "corte", parcial: true });
      const txt = previewToText(preview, columns);
      expect(txt).toContain("feijão");
      expect(txt).toContain("MESA 07");
      expect(preview.desconhecidos).toEqual([]);
    },
  );
});
