import { describe, expect, it } from "vitest";
import { defaultConfig, type PrinterConfig } from "@/lib/printing/config";
import {
  calibrationEscPos,
  calibrationHtml,
  comandaDoc,
  receiptDoc,
  renderEscPos,
  renderHtml,
  sampleTicket,
  testPageDoc,
  type PrintDoc,
} from "@/lib/printing/documents";
import { codepageCharacters, printableText, type Codepage } from "@/lib/printing/escpos";
import type { PrintReceipt } from "@/lib/printing/types";

const PROFILES = [
  { paperWidth: 58, printableMm: 48, columns: 32 },
  { paperWidth: 80, printableMm: 64, columns: 42 },
  { paperWidth: 80, printableMm: 72, columns: 48 },
  { paperWidth: 80, printableMm: 76, columns: 48 },
] as const;

function configFor(profile: (typeof PROFILES)[number]): PrinterConfig {
  return { ...defaultConfig(), ...profile };
}

type PrintedLine = { text: string; double: boolean };

/** Interpreta os comandos que o Mesari emite e devolve as linhas de texto como sairiam. */
function printedLines(bytes: Uint8Array, codepage: Codepage = "CP850") {
  const upper = Array.from(codepageCharacters(codepage));
  const lines: PrintedLine[] = [];
  const header: number[][] = [];
  let current = "";
  let double = false;
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i]!;
    if (b === 0x1b) {
      const cmd = bytes[i + 1];
      const size = { 0x40: 2, 0x74: 3, 0x4d: 3, 0x61: 3, 0x45: 3, 0x64: 3, 0x70: 5 }[cmd!];
      if (!size) throw new Error(`ESC ${cmd} desconhecido`);
      header.push(Array.from(bytes.slice(i, i + size)));
      i += size;
    } else if (b === 0x1d) {
      const cmd = bytes[i + 1];
      if (cmd === 0x21) double = bytes[i + 2] === 0x11;
      if (cmd === 0x76) {
        const x = bytes[i + 4]! | (bytes[i + 5]! << 8);
        const y = bytes[i + 6]! | (bytes[i + 7]! << 8);
        i += 8 + x * y;
        continue;
      }
      const size = { 0x21: 3, 0x4c: 4, 0x57: 4, 0x56: 4 }[cmd!];
      if (!size) throw new Error(`GS ${cmd} desconhecido`);
      header.push(Array.from(bytes.slice(i, i + size)));
      i += size;
    } else if (b === 0x0a) {
      lines.push({ text: current, double });
      current = "";
      i += 1;
    } else {
      current += b < 0x80 ? String.fromCharCode(b) : upper[b - 0x80];
      i += 1;
    }
  }
  if (current) lines.push({ text: current, double });
  return { lines, header };
}

/** Todas as palavras do documento, como a impressora as recebe (após a codepage). */
function docWords(doc: PrintDoc, config: PrinterConfig) {
  const words: string[] = [];
  const add = (value: string) =>
    words.push(
      ...printableText(value, config.codepage)
        .split(/\s+/)
        .filter((word) => word && !/^-+$/.test(word)),
    );
  for (const line of doc.lines) {
    if (line.kind === "text" || line.kind === "raw") add(line.text);
    else if (line.kind === "pair") {
      add(line.left);
      add(line.right);
    }
  }
  return words;
}

function receipt(): PrintReceipt {
  return {
    id: "r1",
    at: Date.now(),
    table: 12,
    saleNumber: 77,
    lines: [
      {
        id: "1",
        name: "Risoto de camarão com aspargos frescos e raspas de limão siciliano",
        qty: 2,
        price: 89.9,
        note: "",
        waiter: "Conceição",
      },
      { id: "2", name: "Água", qty: 1, price: 6, note: "", waiter: "Conceição" },
    ],
    subtotal: 185.8,
    serviceCharge: 18.58,
    total: 1204.38,
    discount: 1000,
    payments: [{ forma: "dinheiro", valor: 1204.38, recebido: 1300, troco: 95.62 }],
  };
}

describe.each(PROFILES)("perfil $paperWidth mm / $printableMm mm / $columns colunas", (profile) => {
  const config = configFor(profile);
  const docs: [string, PrintDoc][] = [
    ["comanda de delivery", comandaDoc(sampleTicket("entrega"), config)],
    ["comanda de mesa", comandaDoc(sampleTicket("mesa"), config)],
    [
      "nota",
      receiptDoc(
        receipt(),
        { name: "Cantina", address: "Rua A", phone: "", cnpj: "", instagram: "" },
        config,
      ),
    ],
  ];

  it.each(docs)("ESC/POS da %s: nada cortado, valores à direita, tracejado exato", (_, doc) => {
    const { lines, header } = printedLines(renderEscPos(doc, config));
    // Margem esquerda 0 e área de impressão = área útil x 8 pontos.
    const dots = profile.printableMm * 8;
    expect(header).toContainEqual([0x1d, 0x4c, 0, 0]);
    expect(header).toContainEqual([0x1d, 0x57, dots & 0xff, dots >> 8]);
    for (const line of lines) {
      const width = line.double ? Math.floor(profile.columns / 2) : profile.columns;
      expect(line.text.length, line.text).toBeLessThanOrEqual(width);
    }
    const rules = lines.filter((line) => /^-+$/.test(line.text));
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.every((line) => line.text.length === profile.columns)).toBe(true);
    // Nenhuma palavra some e a ordem é mantida.
    const printed = lines
      .flatMap((line) => line.text.split(/\s+/))
      .filter((word) => word && !/^-+$/.test(word));
    expect(printed).toEqual(docWords(doc, config));
    // Linhas rótulo/valor: o valor termina exatamente na última coluna.
    for (const docLine of doc.lines) {
      if (docLine.kind !== "pair" || !docLine.right) continue;
      const value = printableText(docLine.right, config.codepage);
      const width = docLine.double ? Math.floor(profile.columns / 2) : profile.columns;
      const hit = lines.find((line) => line.text.endsWith(value) && line.text.length === width);
      expect(hit, `${docLine.left} | ${docLine.right}`).toBeTruthy();
    }
  });

  it("HTML usa a área útil, o papel e a fonte que cabem nas colunas", () => {
    const html = renderHtml(comandaDoc(sampleTicket("entrega"), config), config);
    expect(html).toContain(`@page{size:${profile.paperWidth}mm auto;margin:0}`);
    expect(html).toContain(`.ticket{width:${profile.printableMm}mm;`);
    const font = Number(/\.ticket\{[^}]*font-size:([\d.]+)mm/.exec(html)?.[1]);
    // Colunas x largura do caractere (0,6 em) cabem na área útil menos 2 mm de margem.
    expect(profile.columns * font * 0.6).toBeLessThanOrEqual(profile.printableMm - 2 + 0.05);
  });

  it("página de teste e calibração respeitam o perfil", () => {
    const test = printedLines(renderEscPos(testPageDoc(config, "Cantina", "Rede"), config));
    expect(
      test.lines.some((line) => line.text === "1234567890".repeat(10).slice(0, profile.columns)),
    ).toBe(true);
    const calibration = printedLines(calibrationEscPos(config));
    // A calibração imprime no papel inteiro e depois volta para a área útil.
    expect(calibration.header).toContainEqual([
      0x1d,
      0x57,
      (profile.paperWidth * 8) & 0xff,
      (profile.paperWidth * 8) >> 8,
    ]);
    expect(calibration.lines.map((line) => line.text)).toContain(
      "123456789012345678901234567890123456789012345678901234567890123",
    );
    const arrows = calibration.lines.find((line) => line.text.startsWith("|<-- ESQUERDA"));
    expect(arrows?.text.endsWith("DIREITA -->|")).toBe(true);
    expect(arrows?.text).toHaveLength(profile.columns);
    expect(calibrationHtml(config)).toContain(`width:${profile.paperWidth}mm;height:10mm`);
  });
});
