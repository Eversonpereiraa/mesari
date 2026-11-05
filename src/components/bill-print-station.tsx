import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { actions, errorMessage, useStore } from "@/lib/store";
import { printPreBill, reprintBill } from "@/lib/bill-print";

const tableLabel = (n: number) => String(n).padStart(2, "0");

/**
 * Roda no aparelho do caixa (em todas as telas). Quando uma mesa entra em "conta solicitada"
 * — pelo caixa ou pelo app do garçom — reserva a nota no banco e imprime. Também imprime de
 * novo quando pedem "Reimprimir nota" ou quando a conta é pedida outra vez depois de itens
 * novos. Se o caixa estava fechado, imprime as pendentes ao abrir.
 */
export function BillPrintStation() {
  const role = useStore((s) => s.user?.role);
  const available = useStore((s) => s.billPrintAvailable);
  const tables = useStore((s) => s.tables);
  const orders = useStore((s) => s.orders);
  const restaurant = useStore((s) => s.restaurant);
  const busy = useRef(new Set<string>());

  useEffect(() => {
    if (role !== "caixa" || !available) return;
    for (const table of tables) {
      if (table.status !== "conta" || busy.current.has(table.id)) continue;
      const lines = orders[table.id] ?? [];
      if (!lines.length) continue;
      const latest = Math.max(...lines.map((line) => line.at));
      if (table.billPrintedAt != null && latest <= table.billPrintedAt) continue;
      busy.current.add(table.id);
      void (async () => {
        try {
          if (!(await actions.reserveBillPrint(table.id))) return;
          await printPreBill(table, lines, restaurant);
        } catch (cause) {
          toast.error(`Nota da mesa ${tableLabel(table.number)} não impressa: ${errorMessage(cause)}`, {
            id: `nota-${table.id}`,
            duration: 10000,
            action: {
              label: "Reimprimir nota",
              onClick: () =>
                void reprintBill(table, lines, restaurant, true).catch((error: unknown) =>
                  toast.error(errorMessage(error)),
                ),
            },
          });
        } finally {
          busy.current.delete(table.id);
        }
      })();
    }
  }, [role, available, tables, orders, restaurant]);

  return null;
}
