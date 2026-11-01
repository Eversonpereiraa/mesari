import { cleanPhone, formatCents, isValidPhone } from "@/lib/masks";
import {
  EXTERNAL_ORDER_STATUS,
  type ExternalOrderStatus,
  type ExternalOrderType,
} from "@/lib/external-order-status";

// Aviso ao cliente do delivery pelo WhatsApp: monta o link com a mensagem pronta
// e abre fora do Mesari (app instalado ou WhatsApp Web). O WhatsApp só é ABERTO;
// quem envia é a pessoa.

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

/* ------------------------------------------- Como abrir o WhatsApp (local) */

/** "app" = WhatsApp instalado no PC; "web" = WhatsApp Web no navegador. */
export type WhatsappOpenMode = "app" | "web";

const OPEN_MODE_KEY = "mesari-whatsapp-modo";
/** Aba/janela nomeada: cada aviso reaproveita a mesma, em vez de abrir outra. */
export const WHATSAPP_WINDOW_NAME = "mesari-whatsapp";
export const WHATSAPP_NOT_FOUND_MESSAGE =
  "WhatsApp não encontrado neste PC. Abrindo pelo navegador.";

/** No app desktop, o WhatsApp instalado; no navegador, o WhatsApp Web. */
export function defaultWhatsappOpenMode(): WhatsappOpenMode {
  return typeof window !== "undefined" && window.mesariDesktop ? "app" : "web";
}

/** Escolha guardada neste computador (ou o padrão do ambiente). */
export function getWhatsappOpenMode(): WhatsappOpenMode {
  try {
    const stored = localStorage.getItem(OPEN_MODE_KEY);
    if (stored === "app" || stored === "web") return stored;
  } catch {
    // Sem localStorage: usa o padrão.
  }
  return defaultWhatsappOpenMode();
}

export function setWhatsappOpenMode(mode: WhatsappOpenMode) {
  try {
    localStorage.setItem(OPEN_MODE_KEY, mode);
  } catch {
    // Sem localStorage: a escolha vale só até recarregar a página.
  }
}

/** 55 + DDD + número, só dígitos — null se o telefone não for válido. */
function whatsappPhone(phone: string) {
  const digits = cleanPhone(phone);
  return isValidPhone(digits) ? `55${digits}` : null;
}

/** whatsapp://send?phone=55...&text=... — abre o app instalado. */
export function whatsappAppLink(phone: string, text: string) {
  const full = whatsappPhone(phone);
  return full ? `whatsapp://send?phone=${full}&text=${encodeURIComponent(text)}` : null;
}

/** https://web.whatsapp.com/send?phone=55...&text=... — WhatsApp Web. */
export function whatsappWebLink(phone: string, text: string) {
  const full = whatsappPhone(phone);
  return full
    ? `https://web.whatsapp.com/send?phone=${full}&text=${encodeURIComponent(text)}`
    : null;
}

/** Sempre na mesma aba nomeada. No app desktop, o link vai para o navegador do sistema. */
function openWhatsappWeb(url: string) {
  window.open(url, WHATSAPP_WINDOW_NAME);
}

/**
 * Abre a conversa com a mensagem pronta, do jeito escolhido neste computador.
 * `fellBack` = o app não foi encontrado e a conversa abriu pelo navegador.
 */
export async function openWhatsapp(
  phone: string,
  text: string,
  mode: WhatsappOpenMode = getWhatsappOpenMode(),
): Promise<{ fellBack: boolean }> {
  const appLink = whatsappAppLink(phone, text);
  const webLink = whatsappWebLink(phone, text);
  if (!appLink || !webLink) {
    throw new Error("O telefone deste cliente não é válido para o WhatsApp.");
  }
  if (mode === "web") {
    openWhatsappWeb(webLink);
    return { fellBack: false };
  }
  const desktop = window.mesariDesktop;
  if (!desktop) {
    // Navegador: o próprio navegador entrega o whatsapp:// ao app instalado.
    window.location.assign(appLink);
    return { fellBack: false };
  }
  if (!desktop.openWhatsApp) {
    // Desktop antigo, sem suporte ao app: segue pelo WhatsApp Web.
    openWhatsappWeb(webLink);
    return { fellBack: false };
  }
  const result = await desktop
    .openWhatsApp(cleanPhone(phone), text)
    .catch((cause: unknown) => ({ ok: false, error: String(cause) }));
  if (result.ok) return { fellBack: false };
  openWhatsappWeb(webLink);
  return { fellBack: true };
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
