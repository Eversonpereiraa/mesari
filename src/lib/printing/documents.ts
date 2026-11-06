/**
 * Renderizadores dos impressos. O documento (lista de linhas com estilo, ver layout.ts) é
 * montado uma vez em linhas de `colunas` caracteres e desenhado em ESC/POS (bytes) ou em HTML de
 * bobina (navegador). Os dois usam as mesmas linhas, então saem iguais.
 */
import { DOTS_PER_MM, EscPosBuilder } from "./escpos";
import type { PrinterConfig } from "./config";
import { money } from "./format";
import { layoutDoc, type DocLine, type PhysicalLine, type PrintDoc } from "./layout";
import { logoDot, type PrintLogo } from "./logo";

export type { DocLine, PrintDoc } from "./layout";
export { money } from "./format";

const text = (value: string, style: { align?: "center"; bold?: boolean; size?: "big" } = {}) =>
  ({ kind: "text", text: value, ...style }) as DocLine;
const rule: DocLine = { kind: "rule", char: "-" };

function dateTime(at: number) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(at));
}

export function testPageDoc(
  options: Pick<PrinterConfig, "paperWidth" | "printableMm" | "columns" | "codepage">,
  restaurantName: string,
  connectionLabel: string,
): PrintDoc {
  const columns = options.columns;
  const ruler = Array.from({ length: columns }, (_, index) => String((index + 1) % 10)).join("");
  return {
    title: "Página de teste",
    lines: [
      text(restaurantName || "Mesari", { align: "center", bold: true }),
      text("PÁGINA DE TESTE", { align: "center", bold: true }),
      rule,
      text(`Conexão: ${connectionLabel}`),
      text(
        `Papel: ${options.paperWidth} mm · área útil ${options.printableMm} mm · ${columns} colunas`,
      ),
      text(`Codepage atual: ${options.codepage}`),
      text(`Data/hora: ${dateTime(Date.now())}`),
      rule,
      text("Acentos:"),
      text("ação, pão, você, café, órgão, Conceição"),
      text("AÇÃO, PÃO, VOCÊ, CAFÉ, ÓRGÃO, CONCEIÇÃO"),
      rule,
      text(`Régua de ${columns} colunas:`),
      { kind: "raw", text: ruler },
      rule,
      text("Texto em negrito", { bold: true }),
      { kind: "text", text: "ALTURA DUPLA", bold: true, size: "tall" },
      text("TAMANHO DUPLO", { bold: true, size: "big" }),
      { kind: "entry", text: "Item com preço à direita", value: money(1234.5) },
      rule,
      text("Se esta página saiu inteira e com acentos, a impressora está pronta.", {
        align: "center",
      }),
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// ESC/POS

export type RenderOptions = Pick<
  PrinterConfig,
  "paperWidth" | "printableMm" | "columns" | "offsetMm" | "codepage" | "autoCut" | "feedBeforeCut"
> & {
  openDrawer?: boolean;
};

function builderFor(options: Omit<RenderOptions, "autoCut" | "feedBeforeCut">) {
  const out = new EscPosBuilder(options.codepage, {
    columns: options.columns,
    printableMm: options.printableMm,
  }).init();
  // Deslocamento positivo vira margem esquerda (GS L). A cabeça não imprime antes da borda,
  // então deslocamento negativo só tem efeito na impressão pelo navegador.
  if (options.offsetMm > 0) out.leftMargin(Math.round(options.offsetMm * DOTS_PER_MM));
  return out;
}

function finish(out: EscPosBuilder, options: RenderOptions) {
  if (options.autoCut) out.feed(options.feedBeforeCut).cut();
  else out.feed(options.feedBeforeCut + 2);
  if (options.openDrawer) out.openDrawer();
  return out.build();
}

/** Logo centralizada na área útil inteira (reduzida se for mais larga que a cabeça). */
function printLogo(out: EscPosBuilder, logo: PrintLogo, options: RenderOptions) {
  const printable = Math.round(options.printableMm * DOTS_PER_MM);
  const offset = Math.round(options.offsetMm * DOTS_PER_MM);
  const scale = Math.min(1, printable / logo.width);
  const width = Math.max(1, Math.floor(logo.width * scale));
  const height = Math.max(1, Math.floor(logo.height * scale));
  out.leftMargin(Math.max(0, offset)).areaWidth(printable).align("center");
  out.raster(width, height, (x, y) =>
    logoDot(
      logo,
      Math.min(logo.width - 1, Math.floor(x / scale)),
      Math.min(logo.height - 1, Math.floor(y / scale)),
    ),
  );
  out.align("left").textArea(offset);
}

function escPosOne(doc: PrintDoc, options: RenderOptions) {
  const out = new EscPosBuilder(options.codepage, {
    columns: options.columns,
    printableMm: options.printableMm,
  }).init();
  out.textArea(options.offsetMm * DOTS_PER_MM).align("left");
  let bold = false;
  let size: "normal" | "tall" | "big" = "normal";
  for (const line of layoutDoc(doc, options.columns)) {
    if (line.kind === "image") {
      printLogo(out, line.logo, options);
      continue;
    }
    if (line.bold !== bold) out.bold((bold = line.bold));
    if (line.size !== size) out.size((size = line.size));
    out.raw(line.text).newline();
  }
  if (bold) out.bold(false);
  if (size !== "normal") out.size("normal");
  return finish(out, { ...options, openDrawer: false });
}

/** Bytes ESC/POS de um ou mais documentos, cada um com seu avanço e corte. */
export function renderEscPos(docs: PrintDoc | PrintDoc[], options: RenderOptions) {
  const parts = (Array.isArray(docs) ? docs : [docs]).map((doc) => escPosOne(doc, options));
  if (options.openDrawer) {
    parts.push(new EscPosBuilder(options.codepage, options).init().openDrawer().build());
  }
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Bytes que só abrem a gaveta. */
export function drawerBytes(options: Pick<PrinterConfig, "codepage" | "columns" | "printableMm">) {
  return new EscPosBuilder(options.codepage, options).init().openDrawer().build();
}

// ---------------------------------------------------------------------------------------------
// HTML

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );
}

export type HtmlLayout = Pick<
  PrinterConfig,
  "paperWidth" | "printableMm" | "columns" | "offsetMm" | "fontSize"
>;

const FONT_FACTOR: Record<HtmlLayout["fontSize"], number> = {
  pequeno: 0.88,
  medio: 1,
  grande: 1.15,
};
/** Largura de um caractere monoespaçado em relação ao tamanho da fonte (Consolas/Courier). */
const CHAR_RATIO = 0.6;
const SIDE_PADDING_MM = 1;

/** Colunas do HTML: as do perfil, menos quando o usuário aumenta a fonte. */
export function htmlColumns(layout: HtmlLayout) {
  return Math.max(16, Math.floor(layout.columns / FONT_FACTOR[layout.fontSize]));
}

/** Tamanho da fonte (mm) para caber as colunas do HTML na área útil. */
export function htmlFontMm(layout: HtmlLayout) {
  const text = layout.printableMm - SIDE_PADDING_MM * 2;
  return text / htmlColumns(layout) / CHAR_RATIO;
}

const mm = (value: number) => `${Number(value.toFixed(3))}mm`;

/**
 * CSS da bobina: @page do tamanho do papel e contêiner com a largura da área útil. Cada linha
 * já vem quebrada e alinhada (white-space:pre). Altura dupla = scaleY(2); tamanho duplo = fonte
 * em dobro (largura e altura).
 */
function sheetCss(layout: HtmlLayout) {
  const font = htmlFontMm(layout);
  return `@page{size:${layout.paperWidth}mm auto;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:#000}
body{width:${layout.paperWidth}mm;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.ticket{width:${mm(layout.printableMm)};max-width:100%;margin:0 auto;padding:2mm ${SIDE_PADDING_MM}mm 6mm;transform:translateX(${mm(layout.offsetMm)});font-family:Consolas,"Courier New","Liberation Mono",monospace;font-size:${mm(font)};line-height:1.25;color:#000}
.ticket+.ticket{break-before:page}
.l{white-space:pre;height:1.25em}
.b{font-weight:700}
.tall{height:2.5em}
.tall>span{display:inline-block;transform:scaleY(2);transform-origin:0 0}
.big{font-size:2em}
.logo{display:block;margin:0 auto 1mm;max-width:48mm;height:auto;filter:grayscale(1) contrast(3);image-rendering:pixelated}
.t{padding-left:2ch;text-indent:-2ch;overflow-wrap:anywhere}
.row{display:flex;align-items:flex-end;justify-content:space-between;gap:1ch}
.row .lbl{flex:1 1 auto;min-width:0}
.row .val{flex:0 0 auto;white-space:nowrap}`;
}

function htmlLine(line: PhysicalLine) {
  if (line.kind === "image") {
    return `<img class="logo" alt="" src="${escapeHtml(line.logo.src)}">`;
  }
  const classes = [
    "l",
    ...(line.bold ? ["b"] : []),
    ...(line.size !== "normal" ? [line.size] : []),
  ];
  return `<div class="${classes.join(" ")}"><span>${escapeHtml(line.text.trimEnd())}</span></div>`;
}

/** HTML de bobina de um ou mais documentos (cada um em sua página), para um iframe oculto. */
export function renderHtml(docs: PrintDoc | PrintDoc[], layout: HtmlLayout) {
  const list = Array.isArray(docs) ? docs : [docs];
  const columns = htmlColumns(layout);
  const body = list
    .map((doc) => `<main class="ticket">${layoutDoc(doc, columns).map(htmlLine).join("")}</main>`)
    .join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(list[0]?.title ?? "Impressão")}</title><style>${sheetCss(layout)}</style></head><body>${body}</body></html>`;
}

// ---------------------------------------------------------------------------------------------
// Calibração

/** Régua de caracteres impressa na calibração (63 posições). */
export const CHAR_RULER = "123456789012345678901234567890123456789012345678901234567890123";
const CHAR_RULER_TENS = Array.from(CHAR_RULER, (_, index) =>
  (index + 1) % 10 === 0 ? String((index + 1) / 10) : " ",
).join("");
/** Números da régua em mm: de 40 até a largura do papel, de 4 em 4. */
export function calibrationMarks(paperWidth: number) {
  const marks: number[] = [];
  for (let value = 40; value <= paperWidth; value += 4) marks.push(value);
  return marks;
}

const DIGITS: Record<string, string[]> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
};
const DIGIT_SCALE = 2;
const DIGIT_W = 5 * DIGIT_SCALE;
const DIGIT_H = 7 * DIGIT_SCALE;
const DIGIT_GAP = 2;

/**
 * Régua em pontos (8 por mm) a partir da borda esquerda: traço a cada 2 mm, traço longo e
 * número a cada 4 mm (de 40 em diante). Cada número termina exatamente no seu traço, então
 * "número inteiro" = aquela largura saiu.
 */
export function rulerBitmap(paperWidth: number) {
  const width = paperWidth * DOTS_PER_MM;
  const height = 44;
  const black = new Set<number>();
  const set = (x: number, y: number) => {
    if (x >= 0 && x < width && y >= 0 && y < height) black.add(y * width + x);
  };
  for (let value = 0; value <= paperWidth; value += 2) {
    const x = Math.min(width - 2, value * DOTS_PER_MM);
    const top = value % 4 === 0 ? 18 : 30;
    for (let y = top; y < height - 2; y += 1) {
      set(x, y);
      set(x + 1, y);
    }
  }
  for (let x = 0; x < width; x += 1) {
    set(x, height - 2);
    set(x, height - 1);
  }
  for (const value of calibrationMarks(paperWidth)) {
    const label = String(value);
    const right = Math.min(width, value * DOTS_PER_MM) - 3;
    const left = right - label.length * (DIGIT_W + DIGIT_GAP) + DIGIT_GAP;
    Array.from(label).forEach((digit, index) => {
      const glyph = DIGITS[digit]!;
      const x0 = left + index * (DIGIT_W + DIGIT_GAP);
      glyph.forEach((row, gy) => {
        Array.from(row).forEach((bit, gx) => {
          if (bit !== "1") return;
          for (let dy = 0; dy < DIGIT_SCALE; dy += 1) {
            for (let dx = 0; dx < DIGIT_SCALE; dx += 1) {
              set(x0 + gx * DIGIT_SCALE + dx, 1 + gy * DIGIT_SCALE + dy);
            }
          }
        });
      });
    });
  }
  return { width, height, isBlack: (x: number, y: number) => black.has(y * width + x) };
}

/** Página de calibração em ESC/POS. */
export function calibrationEscPos(options: RenderOptions) {
  const out = new EscPosBuilder(options.codepage, {
    columns: options.columns,
    printableMm: options.printableMm,
  });
  // Área de impressão = papel inteiro: a própria impressora corta onde a cabeça termina.
  out.init(options.paperWidth).font("A");
  out.line("CALIBRAR IMPRESSORA", { align: "center", bold: true });
  out.align("left").raw("Regua em mm (borda esquerda):").newline();
  const ruler = rulerBitmap(options.paperWidth);
  out.raster(ruler.width, ruler.height, ruler.isBlack).newline();
  out.raw("Regua de caracteres:").newline();
  out.raw(CHAR_RULER_TENS.trimEnd()).newline();
  out.raw(CHAR_RULER).newline();
  // Volta para a área útil atual para conferir as bordas.
  const area = builderFor(options);
  const bytes = Array.from(out.build());
  area.pair("|<-- ESQUERDA", "DIREITA -->|", { bold: true });
  area.line(
    `Atual: papel ${options.paperWidth} mm, area util ${options.printableMm} mm, ${options.columns} colunas, ajuste ${options.offsetMm} mm`,
  );
  return new Uint8Array([...bytes, ...Array.from(finish(area, options))]);
}

/** Página de calibração pelo navegador, com a régua em mm desenhada em CSS. */
export function calibrationHtml(layout: HtmlLayout) {
  const ticks: string[] = [];
  for (let value = 0; value <= layout.paperWidth; value += 2) {
    const long = value % 4 === 0;
    ticks.push(
      `<i style="left:${Math.min(value, layout.paperWidth - 0.3)}mm;height:${long ? 5 : 3}mm"></i>`,
    );
  }
  const numbers = calibrationMarks(layout.paperWidth)
    .map((value) => `<b style="right:${layout.paperWidth - value + 0.4}mm">${value}</b>`)
    .join("");
  const css = `${sheetCss(layout)}
.ruler{position:relative;width:${layout.paperWidth}mm;height:10mm;border-bottom:0.3mm solid #000;margin-top:2mm}
.ruler i{position:absolute;bottom:0;width:0.3mm;background:#000}
.ruler b{position:absolute;top:0;font:700 3mm/1 Consolas,"Courier New",monospace}
.chars{font-family:Consolas,"Courier New",monospace;font-size:2.5mm;white-space:pre;line-height:1.2}
.cap{font:700 3mm/1.3 Consolas,"Courier New",monospace;padding:1mm 0}`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Calibrar impressora</title><style>${css}</style></head><body>
<div class="cap" style="text-align:center">CALIBRAR IMPRESSORA</div>
<div class="cap">Régua em mm (borda esquerda):</div>
<div class="ruler">${ticks.join("")}${numbers}</div>
<div class="cap">Régua de caracteres:</div>
<div class="chars">${escapeHtml(CHAR_RULER_TENS.trimEnd())}\n${CHAR_RULER}</div>
<main class="ticket">
<div class="row b"><span class="lbl" style="padding-left:0;text-indent:0">|&lt;-- ESQUERDA</span><span class="val">DIREITA --&gt;|</span></div>
<div class="t">Atual: papel ${layout.paperWidth} mm, área útil ${layout.printableMm} mm, ${layout.columns} colunas, ajuste ${layout.offsetMm} mm</div>
</main></body></html>`;
}
