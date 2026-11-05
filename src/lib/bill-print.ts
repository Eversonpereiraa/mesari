import { useSyncExternalStore } from "react";
import { actions, billTotals, type OrderLine, type State, type Table } from "@/lib/store";
import { printReceipt, type PrintReceipt } from "@/lib/printing";

/**
 * Nota de consumo (pré-conta). A impressão acontece no aparelho do caixa: a estação de
 * impressão (BillPrintStation) imprime quando a mesa entra em "conta solicitada", inclusive
 * quando quem pediu foi o garçom. Notas que falharam ficam marcadas neste aparelho.
 */

const FAILED_KEY = "mesari-notas-nao-impressas";
const subs = new Set<() => void>();
const noFailures: ReadonlySet<string> = new Set();
let failed: ReadonlySet<string> = readFailed();

function readFailed(): ReadonlySet<string> {
  try {
    const raw = globalThis.localStorage?.getItem(FAILED_KEY);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function writeFailed(next: ReadonlySet<string>) {
  failed = next;
  try {
    globalThis.localStorage?.setItem(FAILED_KEY, JSON.stringify([...next]));
  } catch {
    // Sem armazenamento local: o aviso vale só enquanto a página estiver aberta.
  }
  subs.forEach((notify) => notify());
}

export function markBillFailed(tableId: string) {
  if (!failed.has(tableId)) writeFailed(new Set([...failed, tableId]));
}

export function clearBillFailed(tableId: string) {
  if (failed.has(tableId)) writeFailed(new Set([...failed].filter((id) => id !== tableId)));
}

/** Mesas cuja nota não saiu na impressora deste aparelho. */
export function useBillPrintFailures() {
  return useSyncExternalStore(
    (notify) => {
      subs.add(notify);
      return () => subs.delete(notify);
    },
    () => failed,
    () => noFailures,
  );
}

export function preBillReceipt(
  table: Pick<Table, "id" | "number">,
  lines: OrderLine[],
  restaurant: State["restaurant"],
): PrintReceipt {
  const totals = billTotals(lines, restaurant);
  const now = Date.now();
  return {
    id: `nota-${table.id}-${now}`,
    at: now,
    table: table.number,
    saleNumber: 0,
    lines: lines.map((line) => ({
      id: line.id,
      name: line.name,
      qty: line.qty,
      price: line.price,
      note: line.note,
      waiter: line.waiter,
    })),
    subtotal: totals.subtotalCents / 100,
    serviceCharge: totals.serviceChargeCents / 100,
    total: totals.totalCents / 100,
    origin: "mesa",
    preBill: true,
  };
}

/** Imprime a nota agora, neste aparelho. Falha fica marcada para o aviso "Nota não impressa". */
export async function printPreBill(
  table: Pick<Table, "id" | "number">,
  lines: OrderLine[],
  restaurant: State["restaurant"],
) {
  try {
    const result = await printReceipt(preBillReceipt(table, lines, restaurant), restaurant);
    clearBillFailed(table.id);
    return result;
  } catch (cause) {
    markBillFailed(table.id);
    throw cause;
  }
}

/**
 * "Reimprimir nota". Com a migration da nota aplicada, pede ao caixa (estação de impressão)
 * uma nova impressão; antes dela, imprime direto neste aparelho.
 */
export async function reprintBill(
  table: Pick<Table, "id" | "number">,
  lines: OrderLine[],
  restaurant: State["restaurant"],
  stationAvailable: boolean,
) {
  if (stationAvailable) {
    clearBillFailed(table.id);
    await actions.requestBillReprint(table.id);
    return;
  }
  await printPreBill(table, lines, restaurant);
}
