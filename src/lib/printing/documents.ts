/**
 * Conteúdo dos impressos (comanda, nota, página de teste) num formato neutro. O mesmo documento
 * vira bytes ESC/POS (renderEscPos) ou HTML de bobina (renderHtml), ambos no perfil de largura
 * do aparelho (papel, área útil, colunas e ajuste fino).
 */
import { DOTS_PER_MM, EscPosBuilder, type Align } from "./escpos";
import type { PrinterConfig } from "./config";
import type { KitchenTicket, PrintReceipt, PrintRestaurant } from "./types";

export type DocLine =
  | { kind: "text"; text: string; align?: Align; bold?: boolean; double?: boolean }
  | { kind: "pair"; left: string; right: string; bold?: boolean; double?: boolean }
  | { kind: "raw"; text: string }
  | { kind: "rule" }
  | { kind: "blank" };

export type PrintDoc = { title: string; lines: DocLine[] };

type FormatOptions = Pick<PrinterConfig, "paperWidth" | "codepage" | "showKitchenPrices">;

export function money(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\s/g, " ");
}

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

const text = (
  value: string,
  options: { align?: Align; bold?: boolean; double?: boolean } = {},
): DocLine => ({ kind: "text", text: value, ...options });
const pair = (left: string, right: string, bold = false): DocLine => ({
  kind: "pair",
  left,
  right,
  bold,
});
const rule: DocLine = { kind: "rule" };

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  telefone: "Telefone",
  papel: "Balcão",
  balcao: "Balcão",
};

const PAYMENT_LABEL: Record<string, string> = {
  dinheiro: "Dinheiro",
  pix: "Pix",
  credito: "Cartão de crédito",
  debito: "Cartão de débito",
  nao_informado: "Não informado",
};

export function ticketOrigin(ticket: KitchenTicket) {
  if (ticket.external) return CHANNEL_LABEL[ticket.external.channel] ?? "Balcão";
  return ticket.table === null ? "Balcão" : "Mesa";
}

/** Comanda única com o pedido inteiro (comida e bebida). */
export function comandaDoc(ticket: KitchenTicket, options: FormatOptions): PrintDoc {
  const external = ticket.external;
  const lines: DocLine[] = [];
  const number = external?.dayNumber ?? ticket.number;
  lines.push(text(`PEDIDO #${number}`, { align: "center", bold: true, double: true }));
  if (external) {
    lines.push(
      text(external.origin === "entrega" ? "ENTREGA" : "RETIRADA", {
        align: "center",
        bold: true,
        double: true,
      }),
    );
  } else if (ticket.table !== null) {
    lines.push(
      text(`MESA ${String(ticket.table).padStart(2, "0")}`, {
        align: "center",
        bold: true,
        double: true,
      }),
    );
  }
  if (!external && ticket.sector === "bar")
    lines.push(text("BAR", { align: "center", bold: true }));
  if (ticket.additional) lines.push(text("** ADICIONAL **", { align: "center", bold: true }));
  lines.push(rule);
  lines.push(text(`Data/hora: ${dateTime(ticket.createdAt)}`));
  lines.push(text(`Origem: ${ticketOrigin(ticket)}`));
  if (ticket.waiter) lines.push(text(`Garçom: ${ticket.waiter}`));
  lines.push(rule);

  const pricesKnown = ticket.items.every(
    (item) => typeof item.unitPrice === "number" && Number.isFinite(item.unitPrice),
  );
  const showPrices = (options.showKitchenPrices || Boolean(external)) && pricesKnown;
  for (const item of ticket.items) {
    const total = item.quantity * (item.unitPrice ?? 0);
    lines.push(pair(`${item.quantity}x ${item.product}`, showPrices ? money(total) : "", true));
    if (item.note.trim()) lines.push(text(`   obs: ${item.note.trim()}`));
  }

  if (showPrices) {
    const itemsTotal = ticket.items.reduce(
      (sum, item) => sum + item.quantity * (item.unitPrice ?? 0),
      0,
    );
    const subtotal = external?.subtotal ?? itemsTotal;
    const fee = external?.deliveryFee ?? 0;
    const discount = external?.discount ?? 0;
    const total = external?.total ?? subtotal + fee - discount;
    lines.push(rule);
    lines.push(pair("Subtotal", money(subtotal)));
    if (external?.origin === "entrega" || fee > 0) lines.push(pair("Taxa de entrega", money(fee)));
    if (discount > 0) lines.push(pair("Desconto", `-${money(discount)}`));
    lines.push(pair("TOTAL", money(total), true));
  }

  if (external) {
    lines.push(rule);
    lines.push(text(`Cliente: ${external.customerName || "—"}`, { bold: true }));
    if (external.phone) lines.push(text(`Telefone: ${external.phone}`));
    if (external.origin === "entrega" && external.address) {
      lines.push(text(`Endereço: ${external.address}`, { bold: true }));
    }
    const payment = external.payment;
    const method = payment.forma
      ? (PAYMENT_LABEL[payment.forma] ?? payment.forma)
      : "Não informado";
    lines.push(text(`Pagamento: ${payment.pago ? `${method} (JÁ PAGO)` : method}`, { bold: true }));
    if (!payment.pago && payment.forma === "dinheiro" && payment.trocoPara !== null) {
      lines.push(pair("Troco para", money(payment.trocoPara)));
      const change = Math.round((payment.trocoPara - external.total) * 100) / 100;
      if (change > 0) lines.push(pair("Levar de troco", money(change), true));
    }
    if (external.observation) {
      lines.push(rule);
      lines.push(text(`OBSERVAÇÃO: ${external.observation}`, { bold: true }));
    }
  }
  lines.push(rule);
  if (external) lines.push(text("Não é documento fiscal", { align: "center" }));
  return { title: `Pedido #${number}`, lines };
}

/** Comanda fictícia para a tela "Impressão". */
export function sampleTicket(kind: "entrega" | "mesa" = "entrega"): KitchenTicket {
  const items = [
    {
      product: "X-Burguer da Casa com cheddar cremoso, bacon crocante e cebola caramelizada",
      quantity: 2,
      note: "sem cebola, ponto da carne bem passado e molho especial separado em pote pequeno",
      unitPrice: 28.9,
    },
    {
      product: "Batata frita com cheddar e bacon (porção grande)",
      quantity: 1,
      note: "",
      unitPrice: 32,
    },
    { product: "Suco de laranja 500 ml", quantity: 2, note: "pouco gelo", unitPrice: 9.5 },
  ];
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const base: KitchenTicket = {
    id: `exemplo-${Date.now()}`,
    number: 128,
    table: kind === "mesa" ? 7 : null,
    sector: "cozinha",
    waiter: kind === "mesa" ? "Conceição" : "",
    additional: false,
    createdAt: Date.now(),
    items,
  };
  if (kind === "mesa") return base;
  return {
    ...base,
    external: {
      origin: "entrega",
      dayNumber: 128,
      channel: "whatsapp",
      customerName: "João da Silva",
      phone: "(11) 98765-4321",
      address: "Rua das Acácias, 123, apto 45 – Jardim São Paulo, ao lado da padaria",
      observation: "Interfone com defeito, ligar ao chegar.",
      subtotal,
      deliveryFee: 7,
      discount: 5,
      total: subtotal + 7 - 5,
      payment: { forma: "dinheiro", pago: false, trocoPara: 150 },
    },
  };
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
      text(restaurantName || "Mesari", { align: "center", bold: true, double: true }),
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
      text("TAMANHO DUPLO", { double: true }),
      pair("Item com preço à direita", money(1234.5)),
      rule,
      text("Se esta página saiu inteira e com acentos, a impressora está pronta.", {
        align: "center",
      }),
    ],
  };
}

/** Nota de consumo em texto, para impressoras ESC/POS (o navegador usa o layout com logo). */
export function receiptDoc(
  receipt: PrintReceipt,
  restaurant: PrintRestaurant,
  options: FormatOptions,
): PrintDoc {
  const lines: DocLine[] = [];
  const isDelivery = receipt.origin === "entrega" || receipt.origin === "retirada";
  if (receipt.reprint)
    lines.push(text(`2ª VIA · ORIGINAL ${dateTime(receipt.at)}`, { align: "center" }));
  lines.push(text(restaurant.name || "Mesari", { align: "center", bold: true, double: true }));
  if (restaurant.address) lines.push(text(restaurant.address, { align: "center" }));
  if (restaurant.phone) lines.push(text(restaurant.phone, { align: "center" }));
  if (restaurant.cnpj) lines.push(text(`CNPJ: ${restaurant.cnpj}`, { align: "center" }));
  lines.push(rule);
  lines.push(
    text(receipt.partial ? "CONTA PARCIAL" : "CONTA DE CONSUMO", { align: "center", bold: true }),
  );
  lines.push(text("Não é documento fiscal", { align: "center" }));
  lines.push(rule);
  const place = isDelivery
    ? `${receipt.origin === "retirada" ? "RETIRADA" : "ENTREGA"}${receipt.customerName ? ` - ${receipt.customerName}` : ""}`
    : `MESA ${String(receipt.table).padStart(2, "0")}`;
  lines.push(text(place, { bold: true, double: !isDelivery }));
  lines.push(text(`Data/hora: ${dateTime(receipt.at)}`));
  if (isDelivery && receipt.customerPhone) lines.push(text(`Telefone: ${receipt.customerPhone}`));
  if (isDelivery && receipt.customerAddress)
    lines.push(text(`Endereço: ${receipt.customerAddress}`));
  const waiters = [...new Set(receipt.lines.map((line) => line.waiter).filter(Boolean))].join(", ");
  if (waiters) lines.push(text(`Atendido por: ${waiters}`));
  if (!receipt.preBill && receipt.saleNumber) {
    lines.push(text(`Nº da venda: ${String(receipt.saleNumber).padStart(4, "0")}`));
  }
  lines.push(rule);
  for (const line of receipt.lines) {
    lines.push(pair(`${line.qty}x ${line.name}`, money(line.qty * line.price)));
    if (line.qty > 1) lines.push(text(`   ${money(line.price)} un.`));
  }
  lines.push(rule);
  lines.push(pair("Subtotal", money(receipt.subtotal)));
  if (receipt.serviceCharge > 0) lines.push(pair("Taxa de serviço", money(receipt.serviceCharge)));
  if (receipt.origin === "entrega" && (receipt.deliveryFee ?? 0) > 0) {
    lines.push(pair("Taxa de entrega", money(receipt.deliveryFee ?? 0)));
  }
  if ((receipt.discount ?? 0) > 0) lines.push(pair("Desconto", `-${money(receipt.discount ?? 0)}`));
  lines.push({
    kind: "pair",
    left: "TOTAL",
    right: money(receipt.total),
    bold: true,
    double: true,
  });
  if (!receipt.preBill) {
    for (const payment of receipt.payments ?? []) {
      lines.push(pair(PAYMENT_LABEL[payment.forma] ?? payment.forma, money(payment.valor)));
      if (payment.forma === "dinheiro" && payment.recebido !== undefined) {
        lines.push(pair("   Recebido", money(payment.recebido)));
        if ((payment.troco ?? 0) > 0) lines.push(pair("   Troco", money(payment.troco ?? 0)));
      }
    }
  }
  lines.push(rule);
  lines.push(text("Obrigado pela preferência!", { align: "center", bold: true }));
  lines.push(text("Volte sempre", { align: "center" }));
  if (restaurant.instagram) lines.push(text(restaurant.instagram, { align: "center" }));
  return { title: "Nota", lines };
}

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

export function renderEscPos(doc: PrintDoc, options: RenderOptions) {
  const out = builderFor(options);
  for (const line of doc.lines) {
    if (line.kind === "text") out.line(line.text, line);
    else if (line.kind === "pair") out.pair(line.left, line.right, line);
    else if (line.kind === "raw") out.align("left").raw(line.text).newline();
    else if (line.kind === "rule") out.dashed();
    else out.newline();
  }
  return finish(out, options);
}

/** Bytes que só abrem a gaveta. */
export function drawerBytes(options: Pick<PrinterConfig, "codepage" | "columns" | "printableMm">) {
  return new EscPosBuilder(options.codepage, options).init().openDrawer().build();
}

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

/** Tamanho da fonte (mm) para caber `columns` caracteres na área útil, com o ajuste do usuário. */
export function htmlFontMm(layout: HtmlLayout) {
  const text = layout.printableMm - SIDE_PADDING_MM * 2;
  return (text / layout.columns / CHAR_RATIO) * FONT_FACTOR[layout.fontSize];
}

const mm = (value: number) => `${Number(value.toFixed(3))}mm`;

/**
 * CSS da bobina: @page do tamanho do papel, contêiner com a largura da área útil centralizado
 * e com o ajuste fino (translateX). Nada de nowrap nem overflow escondido no texto: o que não
 * cabe quebra de linha. Só o valor das linhas rótulo/valor não quebra.
 */
function sheetCss(layout: HtmlLayout) {
  const font = htmlFontMm(layout);
  return `@page{size:${layout.paperWidth}mm auto;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:#000}
body{width:${layout.paperWidth}mm;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.ticket{width:${mm(layout.printableMm)};max-width:100%;margin:0 auto;padding:2mm ${SIDE_PADDING_MM}mm 6mm;transform:translateX(${mm(layout.offsetMm)});font-family:Consolas,"Courier New","Liberation Mono",monospace;font-size:${mm(font)};line-height:1.3;color:#000;overflow-wrap:anywhere}
.t{padding-left:calc(var(--i,0) * 1ch + 2ch);text-indent:-2ch}
.center,.right{padding-left:0;text-indent:0}
.center{text-align:center}.right{text-align:right}
.b{font-weight:700}
.d{font-size:${mm(font * 2)};line-height:1.15}
.row{display:flex;align-items:flex-end;justify-content:space-between;gap:1ch}
.row .lbl{flex:1 1 auto;min-width:0;padding-left:2ch;text-indent:-2ch}
.row .val{flex:0 0 auto;white-space:nowrap}
.row.stack{display:block}
.row.stack .lbl,.row.stack .val{display:block}
.row.stack .val{text-align:right}
.rule{border-top:0.3mm dashed #000;margin:1.2mm 0}
.raw{word-break:break-all}
.blank{height:1em}`;
}

/** Colunas que cabem por linha no HTML, já com o ajuste de tamanho da fonte. */
function htmlColumns(layout: HtmlLayout, double?: boolean) {
  const columns = Math.floor(layout.columns / FONT_FACTOR[layout.fontSize]);
  return double ? Math.floor(columns / 2) : columns;
}

function htmlLine(line: DocLine, layout: HtmlLayout) {
  const classes = [
    ...("bold" in line && line.bold ? ["b"] : []),
    ...("double" in line && line.double ? ["d"] : []),
  ];
  if (line.kind === "text") {
    const indent = (line.text.match(/^ */)?.[0] ?? "").length;
    const align = line.align && line.align !== "left" ? [line.align] : [];
    const style = indent ? ` style="--i:${indent}"` : "";
    return `<div class="${["t", ...align, ...classes].join(" ")}"${style}>${escapeHtml(line.text.trim()) || "&nbsp;"}</div>`;
  }
  if (line.kind === "pair") {
    // Mesma regra do ESC/POS: se nem a maior palavra do rótulo cabe ao lado do valor, o valor
    // desce para a linha de baixo, alinhado à direita.
    const room = htmlColumns(layout, line.double) - line.right.length - 1;
    const longest = Math.max(0, ...line.left.split(/\s+/).map((word) => word.length));
    const stack = line.right && (room < 4 || longest + 2 > room) ? ["stack"] : [];
    return `<div class="${["row", ...stack, ...classes].join(" ")}"><span class="lbl">${escapeHtml(line.left.trim())}</span><span class="val">${escapeHtml(line.right)}</span></div>`;
  }
  if (line.kind === "raw") return `<div class="raw">${escapeHtml(line.text)}</div>`;
  if (line.kind === "rule") return `<div class="rule"></div>`;
  return `<div class="blank"></div>`;
}

/** HTML de bobina só com o impresso, para imprimir num iframe oculto. */
export function renderHtml(doc: PrintDoc, layout: HtmlLayout) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title><style>${sheetCss(layout)}</style></head><body><main class="ticket">${doc.lines.map((line) => htmlLine(line, layout)).join("")}</main></body></html>`;
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
