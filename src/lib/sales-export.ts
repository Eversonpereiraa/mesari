/**
 * Exportação das vendas do período em CSV para Excel (pt-BR): separador ";", vírgula decimal e
 * BOM UTF-8 para os acentos abrirem certos. O projeto não tem biblioteca de .xlsx; o CSV abre
 * direto no Excel, LibreOffice e Google Planilhas.
 */
import { amount } from "@/lib/printing/format";
import { actions, paymentMethodLabel, type Closing, type PaymentMethod } from "@/lib/store";

const HEADER = [
  "Data",
  "Hora",
  "Venda",
  "Mesa/Entrega",
  "Cliente",
  "Itens",
  "Forma de pagamento",
  "Subtotal",
  "Taxa de serviço",
  "Taxa de entrega",
  "Desconto",
  "Total",
];

const SAO_PAULO = "America/Sao_Paulo";

/** Célula CSV: aspas quando tem ";", aspas ou quebra de linha. */
function cell(value: string | number) {
  const text = String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function place(sale: Closing) {
  if (sale.origin === "entrega") return "Entrega";
  if (sale.origin === "retirada") return "Retirada";
  if (sale.origin === "balcao") return "Balcão";
  return `Mesa ${sale.table}`;
}

function payments(sale: Closing) {
  if (!sale.payments.length) return paymentMethodLabel.nao_informado;
  if (sale.payments.length === 1) return paymentMethodLabel[sale.payments[0]!.forma];
  return sale.payments
    .map((payment) => `${paymentMethodLabel[payment.forma]} ${amount(payment.valor)}`)
    .join(" + ");
}

export function salesCsv(sales: Closing[]) {
  const dateText = new Intl.DateTimeFormat("pt-BR", { timeZone: SAO_PAULO, dateStyle: "short" });
  const timeText = new Intl.DateTimeFormat("pt-BR", {
    timeZone: SAO_PAULO,
    hour: "2-digit",
    minute: "2-digit",
  });
  const rows = sales.map((sale) =>
    [
      dateText.format(sale.at),
      timeText.format(sale.at),
      sale.saleNumber || "",
      place(sale),
      sale.customerName ?? "",
      sale.lines.map((line) => `${line.qty}x ${line.name}`).join(", "),
      payments(sale),
      amount(sale.subtotal),
      amount(sale.serviceCharge),
      amount(sale.deliveryFee ?? 0),
      amount(sale.discount ?? 0),
      amount(sale.total),
    ]
      .map(cell)
      .join(";"),
  );
  return `﻿${[HEADER.join(";"), ...rows].join("\r\n")}\r\n`;
}

/** Até 20 mil vendas por arquivo (páginas de 500). */
const PAGE = 500;
const MAX_SALES = 20_000;

/** Busca todas as vendas do período/forma filtrados (a lista da tela vem só 50 por vez). */
export async function fetchAllSales(start: string, end: string, form: PaymentMethod | "todas") {
  const all: Closing[] = [];
  for (let offset = 0; offset < MAX_SALES; offset += PAGE) {
    const page = await actions.listSales(start, end, form, offset, PAGE);
    all.push(...page.sales);
    if (!page.hasMore) break;
  }
  // A tela lista da mais nova para a mais antiga; a planilha vai em ordem de data.
  return all.reverse();
}

/** Baixa o arquivo (navegador e app desktop). */
export function downloadCsv(fileName: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
