import { cleanPhone, formatCents, isValidPhone } from "@/lib/masks";
import {
  EXTERNAL_ORDER_STATUS,
  type ExternalOrderStatus,
  type ExternalOrderType,
} from "@/lib/external-order-status";

// Aviso ao cliente do delivery pelo WhatsApp: monta o link wa.me com a mensagem
// pronta e abre fora do Mesari. O WhatsApp só é ABERTO; quem envia é a pessoa.

export type WhatsappNotice = "confirmado" | "saiu" | "pronto";

export type WhatsappOrder = {
  id: string;
  number: number;
  type: ExternalOrderType;
  status: ExternalOrderStatus;
  customerName: string;
  phone: string;
  total: number;
  payment: {
    forma: "dinheiro" | "pix" | "credito" | "debito" | null;
    pago: boolean;
    trocoPara: number | null;
  };
};

export const WHATSAPP_NOTICE_BUTTON: Record<WhatsappNotice, string> = {
  confirmado: "Avisar: pedido confirmado",
  saiu: "Avisar cliente no WhatsApp",
  pronto: "Avisar que está pronto",
};

/** Qual aviso cabe nesta etapa (null = nenhum). "Saiu" só existe para entrega. */
export function noticeForStatus(
  status: ExternalOrderStatus,
  type: ExternalOrderType,
): WhatsappNotice | null {
  if (status === EXTERNAL_ORDER_STATUS.preparo) return "confirmado";
  if (status === EXTERNAL_ORDER_STATUS.saiu && type === "entrega") return "saiu";
  if (status === EXTERNAL_ORDER_STATUS.pronto && type === "retirada") return "pronto";
  return null;
}

/** "R$ 1.234,56" com espaço comum (o WhatsApp mostra melhor que o espaço fixo). */
const money = (value: number) => `R$ ${formatCents(Math.round(value * 100))}`;

/** Forma de pagamento como na comanda, escrita para o cliente. */
export function paymentSentence(payment: WhatsappOrder["payment"]) {
  if (payment.pago) return "Já pago";
  if (payment.forma === "pix") return "Pix";
  if (payment.forma === "credito" || payment.forma === "debito") return "Cartão na entrega";
  if (payment.forma === "dinheiro") {
    return payment.trocoPara !== null
      ? `Dinheiro — levar troco para ${money(payment.trocoPara)}`
      : "Dinheiro";
  }
  return "A combinar";
}

export function whatsappMessage(
  notice: WhatsappNotice,
  order: WhatsappOrder,
  restaurantName: string,
) {
  const name = order.customerName.trim();
  const hello = name ? `Olá, ${name}!` : "Olá!";
  const restaurant = restaurantName.trim() || "nosso restaurante";
  switch (notice) {
    case "confirmado":
      return `${hello} Recebemos seu pedido #${order.number} no ${restaurant}. Já está em preparo. 😊`;
    case "saiu":
      return `${hello} Seu pedido #${order.number} do ${restaurant} saiu para entrega. Total: ${money(order.total)}. Pagamento: ${paymentSentence(order.payment)}.`;
    case "pronto":
      return `${hello} Seu pedido #${order.number} já está pronto para retirada no ${restaurant}.`;
  }
}

/** https://wa.me/55<DDD+número>?text=... — null se o telefone não for válido. */
export function whatsappLink(phone: string, text: string) {
  const digits = cleanPhone(phone);
  if (!isValidPhone(digits)) return null;
  return `https://wa.me/55${digits}?text=${encodeURIComponent(text)}`;
}

/**
 * Abre o link fora do Mesari: no app desktop pelo navegador/WhatsApp do sistema
 * (nunca dentro da janela do app); no navegador, em nova aba.
 */
export async function openExternalLink(url: string) {
  const desktop = typeof window !== "undefined" ? window.mesariDesktop : undefined;
  if (desktop?.openExternal) {
    const result = await desktop.openExternal(url);
    if (!result.ok) throw new Error(result.error ?? "Não foi possível abrir o WhatsApp.");
    return;
  }
  // Desktop antigo, sem openExternal: o app já manda window.open para o navegador do sistema.
  window.open(url, "_blank", "noopener,noreferrer");
}

/* ------------------------------------------------- "Cliente avisado" (local) */

const NOTIFIED_KEY = "mesari-delivery-avisados";
/** Cópia em memória, para o check valer mesmo sem localStorage (aba anônima, bloqueio). */
const notifiedInMemory = new Set<string>();

function readNotified(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(NOTIFIED_KEY) ?? "{}");
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, number>)
      : {};
  } catch {
    return {};
  }
}

const notifiedKey = (orderId: string, notice: WhatsappNotice) => `${orderId}:${notice}`;

/** O WhatsApp já foi aberto para este aviso deste pedido? (Não garante que a mensagem foi enviada.) */
export function wasNotified(orderId: string, notice: WhatsappNotice) {
  const key = notifiedKey(orderId, notice);
  return notifiedInMemory.has(key) || Boolean(readNotified()[key]);
}

/** Só para testes. */
export function resetNotifiedForTests() {
  notifiedInMemory.clear();
}

export function markNotified(orderId: string, notice: WhatsappNotice, at = Date.now()) {
  notifiedInMemory.add(notifiedKey(orderId, notice));
  const current = readNotified();
  current[notifiedKey(orderId, notice)] = at;
  // Guarda só os avisos dos últimos 3 dias.
  const limit = at - 3 * 24 * 60 * 60 * 1000;
  const kept = Object.fromEntries(Object.entries(current).filter(([, time]) => time >= limit));
  try {
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(kept));
  } catch {
    // Sem localStorage: o check vale só até recarregar a página.
  }
}
