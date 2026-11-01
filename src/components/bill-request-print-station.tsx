import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { getPrintSettings } from "@/lib/printing";
import { errorMessage, useStore, type Status } from "@/lib/store";
import { clearConference, isConferenceCurrent, printTableConference } from "@/lib/conference";

/**
 * Na estação do caixa: quando o garçom pede a conta (mesa passa para "conta"
 * pelo realtime), imprime a conferência de consumo sozinha. Não reimprime se a
 * conferência atual da mesa já corresponde aos itens.
 */
export function BillRequestPrintStation() {
  const loading = useStore((snapshot) => snapshot.loading);
  const tables = useStore((snapshot) => snapshot.tables);
  const orders = useStore((snapshot) => snapshot.orders);
  const restaurant = useStore((snapshot) => snapshot.restaurant);
  const previous = useRef<Map<string, Status | undefined> | null>(null);

  useEffect(() => {
    if (loading) return;
    const before = previous.current;
    previous.current = new Map(tables.map((table) => [table.id, table.status]));
    for (const table of tables) if (table.status === "livre") clearConference(table.id);
    // Primeira carga: mesas que já estavam em "conta" não são impressas de novo.
    if (!before) return;
    let enabled: boolean;
    try {
      enabled = getPrintSettings().autoPrintConferenceOnRequest;
    } catch (error) {
      toast.error(errorMessage(error));
      return;
    }
    if (!enabled) return;
    for (const table of tables) {
      if (table.status !== "conta" || before.get(table.id) === "conta") continue;
      const lines = orders[table.id] ?? [];
      if (!lines.length || isConferenceCurrent(table.id, lines, restaurant)) continue;
      const label = `Mesa ${String(table.number).padStart(2, "0")}`;
      void printTableConference(table, lines, restaurant)
        .then((result) => {
          toast.success(`${label} pediu a conta. Conferência impressa.`);
          if (result.fallbackReason) {
            toast.warning(`Impressora direta indisponível: ${result.fallbackReason}`);
          }
        })
        .catch((error: unknown) => {
          toast.error(
            `${label} pediu a conta, mas a conferência não imprimiu: ${errorMessage(error)}`,
          );
        });
    }
  }, [loading, tables, orders, restaurant]);

  return null;
}
