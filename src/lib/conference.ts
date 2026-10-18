import { useSyncExternalStore } from "react";
import { count, total, type OrderLine, type State } from "@/lib/store";
import {
  getPrintSettings,
  printConference,
  type PrintReceipt,
  type PrintResult,
} from "@/lib/printing";

// ---- Conferência de consumo ---------------------------------------------
// Guarda em memória (por mesa) o que estava na conta quando a conferência foi
// impressa, para avisar o caixa se itens entrarem ou saírem depois disso.

export type ConferenceSnapshot = { totalCents: number; itemCount: number; signature: string };

type Restaurant = Pick<State["restaurant"], "serviceChargeEnabled" | "serviceChargePercent">;

const printed = new Map<string, ConferenceSnapshot>();
const listeners = new Set<() => void>();
let version = 0;

function notify() {
  version += 1;
  listeners.forEach((listener) => listener());
}

export function billAmounts(lines: OrderLine[], restaurant: Restaurant) {
  const subtotalCents = Math.round(total(lines) * 100);
  const serviceChargeCents = restaurant.serviceChargeEnabled
    ? Math.round((subtotalCents * restaurant.serviceChargePercent) / 100)
    : 0;
  return { subtotalCents, serviceChargeCents, totalCents: subtotalCents + serviceChargeCents };
}

export function conferenceSnapshot(lines: OrderLine[], restaurant: Restaurant): ConferenceSnapshot {
  return {
    totalCents: billAmounts(lines, restaurant).totalCents,
    itemCount: count(lines),
    // Pega trocas de item que mantêm total e quantidade (ex.: tira um, põe outro de mesmo preço).
    signature: lines
      .map((line) => `${line.id}:${line.qty}:${line.price}`)
      .sort()
      .join("|"),
  };
}

const sameSnapshot = (a: ConferenceSnapshot, b: ConferenceSnapshot) =>
  a.totalCents === b.totalCents && a.itemCount === b.itemCount && a.signature === b.signature;

export function getPrintedConference(tableId: string) {
  return printed.get(tableId);
}

export function markConferencePrinted(tableId: string, snapshot: ConferenceSnapshot) {
  printed.set(tableId, snapshot);
  notify();
}

export function clearConference(tableId: string) {
  if (printed.delete(tableId)) notify();
}

/** A conferência impressa ainda corresponde aos itens atuais da mesa. */
export function isConferenceCurrent(tableId: string, lines: OrderLine[], restaurant: Restaurant) {
  const snapshot = printed.get(tableId);
  return Boolean(snapshot && sameSnapshot(snapshot, conferenceSnapshot(lines, restaurant)));
}

/** Já imprimiu a conferência e os itens mudaram depois disso. */
export function isConferenceOutdated(tableId: string, lines: OrderLine[], restaurant: Restaurant) {
  return printed.has(tableId) && !isConferenceCurrent(tableId, lines, restaurant);
}

export function useConferenceVersion() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
    () => version,
  );
}

export function buildConference(
  table: { id: string; number: number },
  lines: OrderLine[],
  restaurant: Restaurant,
  splitCount = 1,
): PrintReceipt {
  const { subtotalCents, serviceChargeCents, totalCents } = billAmounts(lines, restaurant);
  return {
    id: `conferencia-${table.id}-${Date.now()}`,
    at: Date.now(),
    table: table.number,
    saleNumber: 0,
    lines: lines.map(({ id, name, qty, price, note, waiter }) => ({
      id,
      name,
      qty,
      price,
      note,
      waiter,
    })),
    subtotal: subtotalCents / 100,
    serviceCharge: serviceChargeCents / 100,
    total: totalCents / 100,
    kind: "conferencia",
    splitCount,
    origin: "mesa",
  };
}

/**
 * Imprime a conferência da mesa e guarda o retrato da conta. Se a impressão
 * falhar, volta ao retrato anterior (ou a nenhum).
 */
export async function printTableConference(
  table: { id: string; number: number },
  lines: OrderLine[],
  restaurant: State["restaurant"],
  splitCount = 1,
): Promise<PrintResult> {
  const previous = printed.get(table.id);
  markConferencePrinted(table.id, conferenceSnapshot(lines, restaurant));
  try {
    return await printConference(
      buildConference(table, lines, restaurant, splitCount),
      restaurant,
      getPrintSettings(),
    );
  } catch (error) {
    if (previous) markConferencePrinted(table.id, previous);
    else clearConference(table.id);
    throw error;
  }
}

export function resetConferencesForTests() {
  printed.clear();
  notify();
}
