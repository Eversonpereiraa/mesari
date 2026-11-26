/**
 * Os três impressos do Mesari como listas de linhas com estilo:
 * - comandaCozinha: sai ao lançar o pedido; sem preços e sem logo.
 * - comandaDelivery: vai com o entregador.
 * - contaMesa: conta de consumo entregue antes de pagar (e a nota de vendas já fechadas).
 */
import { amount, date, money, percent, phone, splitAddress, time } from "./format";
import type { DocLine, PrintDoc } from "./layout";
import { cpfCnpjLabel, displayCpfCnpj, formatInstagram } from "../masks";
import type { PrintLogo } from "./logo";
import type { KitchenTicket, PrintReceipt, PrintRestaurant } from "./types";

export const DEFAULT_FOOTER = "Obrigado pela preferência!\nVolte sempre";

/** Versão do app impressa na última linha ("Sistema Mesari · v1.2.7"); vazia no navegador. */
let appVersion = "";
export function setPrintAppVersion(version: string | null | undefined) {
  appVersion = (version ?? "").trim();
}
/** Última linha da conta e da comanda do entregador: a marca do sistema. */
export function mesariSignature(): DocLine {
  return {
    kind: "banner",
    text: appVersion ? `Sistema Mesari · v${appVersion}` : "Sistema Mesari",
    fill: "*",
  };
}

const EQ: DocLine = { kind: "rule", char: "=" };
const DASH: DocLine = { kind: "rule", char: "-" };
const BLANK: DocLine = { kind: "blank" };
const text = (
  value: string,
  style: Omit<Extract<DocLine, { kind: "text" }>, "kind" | "text"> = {},
) => ({ kind: "text", text: value, ...style }) as DocLine;
const center = (value: string, style: { bold?: boolean; size?: "tall" | "big" } = {}) =>
  text(value, { align: "center", ...style });
const pair = (left: string, right: string, style: { bold?: boolean; size?: "tall" } = {}) =>
  ({ kind: "entry", text: left, value: right, ...style }) as DocLine;
const item = (
  quantity: number,
  name: string,
  value?: string,
  style: { bold?: boolean; size?: "tall" } = {},
) =>
  ({
    kind: "entry",
    prefix: `${quantity}x `,
    text: name,
    ...(value ? { value } : {}),
    ...style,
  }) as DocLine;
const indented = (prefix: string, value: string) =>
  ({ kind: "entry", prefix, text: value }) as DocLine;

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  telefone: "Telefone",
  papel: "Balcão",
  balcao: "Balcão",
  ifood: "iFood",
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

const tableLabel = (table: number) => `MESA ${String(table).padStart(2, "0")}`;
const upper = (value: string) => value.toLocaleUpperCase("pt-BR");

/** Cabeçalho com logo (opcional) e nome do restaurante. */
function brand(
  restaurant: PrintRestaurant,
  logo: PrintLogo | null | undefined,
  nameSize: "normal" | "tall",
) {
  const lines: DocLine[] = [];
  if (logo) lines.push({ kind: "image", logo });
  lines.push(
    center(upper(restaurant.name || "Mesari"), {
      bold: true,
      ...(nameSize === "tall" ? { size: "tall" as const } : {}),
    }),
  );
  return lines;
}

export type ComandaOptions = {
  /** Horário de impressão (padrão: agora). */
  now?: number;
};

// ---------------------------------------------------------------------------------------------
// Modelo 1: comanda de cozinha

export function comandaCozinha(ticket: KitchenTicket, options: ComandaOptions = {}): PrintDoc {
  const external = ticket.external;
  const number = external?.dayNumber ?? ticket.number;
  const lines: DocLine[] = [];
  const title = ticket.sector === "bar" && !external ? "COMANDA DE BAR" : "COMANDA DE COZINHA";
  // Adicional: destaque no topo; a comanda traz só os itens novos daquele envio.
  if (ticket.additional) lines.push(center("*** ADICIONAL ***", { bold: true, size: "tall" }));
  lines.push(center(title, { bold: true }));
  lines.push(EQ);
  const place = external
    ? `${external.origin === "entrega" ? "ENTREGA" : "RETIRADA"} #${number}`
    : ticket.table === null
      ? "BALCÃO"
      : tableLabel(ticket.table);
  lines.push(text(place, { bold: true, size: "big" }));
  lines.push(
    pair(
      `Pedido #${String(number).padStart(4, "0")}`,
      `${date(ticket.createdAt)} ${time(ticket.createdAt)}`,
    ),
  );
  if (external) lines.push(text(`Origem: ${ticketOrigin(ticket)}`));
  else if (ticket.waiter.trim()) lines.push(text(`Garçom: ${ticket.waiter.trim()}`));
  lines.push(DASH);
  ticket.items.forEach((entry, index) => {
    if (index > 0) lines.push(BLANK);
    lines.push(item(entry.quantity, entry.product, undefined, { bold: true, size: "tall" }));
    if (entry.note.trim()) lines.push(indented("   obs: ", entry.note.trim()));
  });
  lines.push(DASH);
  const count = ticket.items.reduce((sum, entry) => sum + entry.quantity, 0);
  lines.push(pair(`Itens: ${count}`, `Impresso ${time(options.now ?? Date.now())}`));
  lines.push(EQ);
  return { title: `Comanda #${number}`, lines };
}

// ---------------------------------------------------------------------------------------------
// Modelo 2: comanda de delivery

function itemLines(
  entries: {
    quantity: number;
    name: string;
    unitPrice?: number | undefined;
    note?: string | undefined;
  }[],
) {
  const lines: DocLine[] = [];
  for (const entry of entries) {
    const known = typeof entry.unitPrice === "number" && Number.isFinite(entry.unitPrice);
    // Uma linha por item: quantidade | descrição | valor (o nome longo continua embaixo).
    lines.push({
      kind: "entry",
      prefix: `${entry.quantity}`.padEnd(3),
      text: entry.name,
      ...(known ? { value: amount(entry.quantity * entry.unitPrice!) } : {}),
    });
    if (entry.note?.trim()) lines.push(indented("   obs: ", entry.note.trim()));
  }
  return lines;
}

const ITEMS_HEADER: DocLine[] = [DASH, pair("QTD DESCRIÇÃO", "VALOR", { bold: true }), DASH];

/** Linha de total alinhada à direita, como na nota de consumo ("Subtotal R$ 116,00"). */
const total = (label: string, value: number, style: { bold?: boolean; size?: "tall" } = {}) =>
  text(`${label} ${money(value)}`, { align: "right", ...style });

function paymentLabel(forma: string | null, pago: boolean) {
  const method = forma ? (PAYMENT_LABEL[forma] ?? forma) : "Não informado";
  if (!forma || forma === "nao_informado" || forma === "dinheiro" || pago) return method;
  return `A receber - ${method}`;
}

export function comandaDelivery(
  ticket: KitchenTicket,
  restaurant: PrintRestaurant,
  options: { logo?: PrintLogo | null } = {},
): PrintDoc {
  const external = ticket.external;
  if (!external) throw new Error("A comanda de delivery precisa de um pedido de entrega/retirada.");
  const number = external.dayNumber ?? ticket.number;
  const delivery = external.origin === "entrega";
  const lines: DocLine[] = [...brand(restaurant, options.logo, "normal")];
  if (restaurant.phone.trim()) lines.push(center(phone(restaurant.phone)));
  lines.push(EQ);
  lines.push(text(`${delivery ? "ENTREGA" : "RETIRADA"} #${number}`, { bold: true, size: "big" }));
  lines.push(pair(ticketOrigin(ticket), `${date(ticket.createdAt)} ${time(ticket.createdAt)}`));
  lines.push(DASH);

  lines.push(indented("Cliente: ", external.customerName.trim() || "—"));
  if (external.phone.trim()) lines.push(text(`Fone: ${phone(external.phone)}`));
  if (delivery) {
    const parsed = splitAddress(external.address);
    const addressLines = external.addressLines?.filter((line) => line.trim()) ?? parsed.lines;
    const reference = (external.reference ?? parsed.reference).trim();
    const address = addressLines.map((line) => line.trim()).join(" - ");
    if (address) lines.push(indented("End.: ", address));
    if (reference) lines.push(indented("Ref.: ", reference));
  }

  lines.push(...ITEMS_HEADER);
  lines.push(
    ...itemLines(
      ticket.items.map((entry) => ({
        quantity: entry.quantity,
        name: entry.product,
        unitPrice: entry.unitPrice,
        note: entry.note,
      })),
    ),
  );
  lines.push(DASH);
  const discount = external.discount ?? 0;
  if (external.deliveryFee > 0 || discount > 0) lines.push(total("Subtotal", external.subtotal));
  if (external.deliveryFee > 0) lines.push(total("Entrega", external.deliveryFee));
  if (discount > 0) lines.push(total("Desconto", -discount));
  lines.push(total("TOTAL", external.total, { bold: true, size: "tall" }));
  lines.push(DASH);

  const payment = external.payment;
  lines.push(indented("Pagamento: ", paymentLabel(payment.forma, payment.pago)));
  if (payment.forma === "dinheiro" && !payment.pago && payment.trocoPara !== null) {
    const change = Math.round((payment.trocoPara - external.total) * 100) / 100;
    if (payment.trocoPara > 0) lines.push(pair("Troco para", money(payment.trocoPara)));
    if (change > 0) lines.push(pair("LEVAR DE TROCO", money(change), { bold: true }));
  }
  if (external.observation.trim()) lines.push(indented("Obs.: ", external.observation.trim()));
  lines.push(EQ);
  lines.push(center("Não é documento fiscal"));
  lines.push(mesariSignature());
  return { title: `Pedido #${number}`, lines };
}

// ---------------------------------------------------------------------------------------------
// Modelo 3: conta da mesa

export function contaMesa(
  receipt: PrintReceipt,
  restaurant: PrintRestaurant,
  options: { logo?: PrintLogo | null } = {},
): PrintDoc {
  const lines: DocLine[] = [...brand(restaurant, options.logo, "tall")];
  for (const line of splitAddress(restaurant.address).lines) lines.push(center(line));
  if (restaurant.phone.trim()) lines.push(center(phone(restaurant.phone)));
  if (restaurant.cnpj.trim()) {
    lines.push(center(`${cpfCnpjLabel(restaurant.cnpj)}: ${displayCpfCnpj(restaurant.cnpj)}`));
  }
  lines.push(EQ);
  if (receipt.partial) lines.push(center("CONTA PARCIAL", { bold: true }));
  if (receipt.reprint) lines.push(center("2ª VIA", { bold: true }));

  const delivery = receipt.origin === "entrega" || receipt.origin === "retirada";
  const place = delivery
    ? receipt.origin === "entrega"
      ? "ENTREGA"
      : "RETIRADA"
    : tableLabel(receipt.table);
  lines.push(pair(place, `${date(receipt.at)} ${time(receipt.at)}`, { bold: true }));
  const waiters = [...new Set(receipt.lines.map((line) => line.waiter.trim()).filter(Boolean))];
  const sale =
    !receipt.preBill && receipt.saleNumber
      ? `Venda ${String(receipt.saleNumber).padStart(4, "0")}`
      : "";
  if (waiters.length) {
    lines.push(
      sale ? pair(`Garçom: ${waiters.join(", ")}`, sale) : indented("Garçom: ", waiters.join(", ")),
    );
  } else if (sale) lines.push(text(sale));
  if (delivery) {
    if (receipt.customerName?.trim())
      lines.push(indented("Cliente: ", receipt.customerName.trim()));
    if (receipt.customerPhone?.trim()) lines.push(text(`Fone: ${phone(receipt.customerPhone)}`));
    if (receipt.customerAddress?.trim()) {
      const address = splitAddress(receipt.customerAddress);
      lines.push(indented("End.: ", address.lines.join(" - ")));
      if (address.reference) lines.push(indented("Ref.: ", address.reference));
    }
  }

  lines.push(...ITEMS_HEADER);
  lines.push(
    ...itemLines(
      receipt.lines.map((line) => ({ quantity: line.qty, name: line.name, unitPrice: line.price })),
    ),
  );
  lines.push(DASH);
  const deliveryFee = receipt.origin === "entrega" ? (receipt.deliveryFee ?? 0) : 0;
  const discount = receipt.discount ?? 0;
  if (receipt.serviceCharge > 0 || deliveryFee > 0 || discount > 0) {
    lines.push(total("Subtotal", receipt.subtotal));
  }
  if (receipt.serviceCharge > 0) {
    const rate =
      receipt.serviceChargePercent ??
      restaurant.serviceChargePercent ??
      (receipt.subtotal > 0 ? (receipt.serviceCharge / receipt.subtotal) * 100 : 0);
    lines.push(total(`Serviço ${percent(rate)}`, receipt.serviceCharge));
  }
  if (deliveryFee > 0) lines.push(total("Entrega", deliveryFee));
  if (discount > 0) lines.push(total("Desconto", -discount));
  lines.push(total("TOTAL", receipt.total, { bold: true, size: "tall" }));

  const payments = receipt.preBill ? [] : (receipt.payments ?? []);
  if (payments.length) {
    lines.push(DASH);
    for (const payment of payments) {
      lines.push(pair(PAYMENT_LABEL[payment.forma] ?? payment.forma, money(payment.valor)));
      if (payment.forma === "dinheiro" && payment.recebido !== undefined) {
        lines.push(pair("   Recebido", money(payment.recebido)));
        if ((payment.troco ?? 0) > 0) lines.push(pair("   Troco", money(payment.troco ?? 0)));
      }
    }
  }
  lines.push(EQ);
  lines.push(center("Não é documento fiscal"));
  const footer = (restaurant.receiptFooter ?? DEFAULT_FOOTER).trim() || DEFAULT_FOOTER;
  for (const line of footer.split("\n")) {
    if (line.trim()) lines.push(center(line.trim()));
  }
  if (restaurant.instagram.trim()) lines.push(center(formatInstagram(restaurant.instagram)));
  lines.push(mesariSignature());
  return { title: receipt.preBill ? "Conta" : "Nota", lines };
}

// ---------------------------------------------------------------------------------------------
// Dados dos modelos (botões de exemplo na tela "Impressão" e testes)

const at = (hour: number, minute: number) => new Date(2026, 10, 5, hour, minute).getTime();

export const SAMPLE_RESTAURANT: PrintRestaurant = {
  name: "Restaurante Sabor do Agreste",
  address: "Rua Coronel Pedro Pinto, 215, Centro - Surubim - PE, 55750-000",
  phone: "81996341234",
  cnpj: "",
  instagram: "",
  receiptFooter: DEFAULT_FOOTER,
  serviceChargePercent: 10,
};

export const SAMPLE_PRINTED_AT = at(16, 35);

export function sampleKitchenTicket(): KitchenTicket {
  return {
    id: "exemplo-cozinha",
    number: 142,
    table: 5,
    sector: "cozinha",
    waiter: "Severino Lima",
    additional: false,
    createdAt: at(16, 35),
    items: [
      { product: "Escondidinho de charque", quantity: 2, note: "um sem queijo", unitPrice: 36 },
      {
        product: "Batata frita com cheddar e bacon (porção grande)",
        quantity: 1,
        note: "",
        unitPrice: 32,
      },
      { product: "Refrigerante lata", quantity: 2, note: "Coca-Cola gelada", unitPrice: 6 },
      {
        product: "Suco de laranja 500 ml",
        quantity: 1,
        note: "pouco gelo, sem açúcar",
        unitPrice: 19,
      },
    ],
  };
}

export function sampleDeliveryTicket(): KitchenTicket {
  return {
    id: "exemplo-delivery",
    number: 128,
    table: null,
    sector: "cozinha",
    waiter: "",
    additional: false,
    createdAt: at(15, 14),
    items: [
      { product: "X-Burguer da Casa", quantity: 2, note: "sem cebola", unitPrice: 28.9 },
      {
        product: "Batata frita com cheddar e bacon (porção grande)",
        quantity: 1,
        note: "",
        unitPrice: 32,
      },
      { product: "Suco de laranja 500 ml", quantity: 1, note: "pouco gelo", unitPrice: 19 },
    ],
    external: {
      origin: "entrega",
      dayNumber: 128,
      channel: "whatsapp",
      customerName: "João da Silva",
      phone: "81987654321",
      address:
        "Rua das Acácias, 123, apto 45 - Jardim São Paulo - Surubim/PE. Ref.: ao lado da padaria",
      observation: "Interfone com defeito, ligar ao chegar.",
      subtotal: 108.8,
      deliveryFee: 7,
      discount: 5,
      total: 110.8,
      payment: { forma: "dinheiro", pago: false, trocoPara: 150 },
    },
  };
}

export function sampleReceipt(): PrintReceipt {
  const waiter = "Severino Lima";
  return {
    id: "exemplo-conta",
    at: at(16, 35),
    table: 5,
    saleNumber: 0,
    lines: [
      { id: "1", name: "Escondidinho de charque", qty: 2, price: 36, note: "", waiter },
      { id: "2", name: "Refrigerante lata", qty: 2, price: 6, note: "", waiter },
      {
        id: "3",
        name: "Batata frita com cheddar e bacon (porção grande)",
        qty: 1,
        price: 32,
        note: "",
        waiter,
      },
    ],
    subtotal: 116,
    serviceCharge: 11.6,
    serviceChargePercent: 10,
    total: 127.6,
    origin: "mesa",
    preBill: true,
  };
}
