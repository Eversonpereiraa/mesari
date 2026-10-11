import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Armchair, LayoutGrid, ListFilter, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { actions, brl, count, tableStatus, total, useStore } from "@/lib/store";
import { StatusTag } from "@/components/ui-kit";
import { MobileFrame } from "@/components/mobile-frame";

export const Route = createFileRoute("/garcom")({
  head: () => ({
    meta: [
      { title: "Mesas — Garçom | Mesari" },
      {
        name: "description",
        content: "App do garçom: veja as mesas e lance pedidos pelo celular.",
      },
      { property: "og:title", content: "Mesas — Garçom | Mesari" },
      {
        property: "og:description",
        content: "App do garçom: veja as mesas e lance pedidos pelo celular.",
      },
    ],
  }),
  component: Garcom,
});

function Garcom() {
  const s = useStore((x) => x);
  const [myTables, setMyTables] = useState(false);
  const allTables = [...s.tables].sort((a, b) => a.number - b.number);
  const tables = myTables
    ? allTables.filter((table) =>
        s.orders[table.id]?.some((line) =>
          line.waiterId ? line.waiterId === s.user?.id : line.waiter === s.user?.name,
        ),
      )
    : allTables;
  return (
    <MobileFrame
      title="Mesas"
      subtitle="Atendimento"
      footer={
        <nav aria-label="Navegação do garçom" className="grid grid-cols-3 gap-2">
          <button
            aria-pressed={!myTables}
            onClick={() => setMyTables(false)}
            className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-xs font-semibold ${!myTables ? "bg-primary text-white" : "text-sidebar-foreground/75 hover:bg-white/10"}`}
          >
            <LayoutGrid className="h-4 w-4" />
            Mesas
          </button>
          <button
            aria-pressed={myTables}
            onClick={() => setMyTables(true)}
            className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-xs font-semibold ${myTables ? "bg-primary text-white" : "text-sidebar-foreground/75 hover:bg-white/10"}`}
          >
            <ListFilter className="h-4 w-4" />
            Minhas mesas
          </button>
          <button
            onClick={() => actions.logout()}
            className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-xs font-semibold text-sidebar-foreground/75 hover:bg-white/10"
          >
            <LogOut className="h-4 w-4" />
            Sair
          </button>
        </nav>
      }
    >
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
        {tables.map((t) => {
          const st = tableStatus(s, t.id);
          const tone =
            st === "livre" ? "bg-free-bg" : st === "ocupada" ? "bg-busy-bg" : "bg-bill-bg";
          return (
            <Link
              key={t.id}
              to="/mesa/$id"
              params={{ id: t.id }}
              className={cn(
                "min-h-[148px] rounded-[14px] border border-transparent p-4 shadow-sm transition duration-150 active:scale-[0.98]",
                tone,
                st === "conta" && "table-requested",
              )}
            >
              <div className="flex items-start justify-between gap-1">
                <div className="font-display text-3xl font-extrabold text-ink">
                  {String(t.number).padStart(2, "0")}
                </div>
                <span className="text-[11px] text-muted-foreground">{t.seats} lug.</span>
              </div>
              <StatusTag s={st} className="mt-2 max-w-full truncate text-[11px]" />
              <div className="num mt-2 truncate text-sm font-bold text-ink">
                {st === "livre" ? (
                  <span aria-label="Mesa livre" title="Mesa livre">
                    <Armchair className="h-4 w-4" />
                  </span>
                ) : (
                  brl(total(s.orders[t.id]))
                )}
              </div>
              {st !== "livre" && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {count(s.orders[t.id])} {count(s.orders[t.id]) === 1 ? "item" : "itens"}
                </div>
              )}
            </Link>
          );
        })}
      </div>
      {tables.length === 0 && (
        <div className="grid min-h-48 place-items-center p-8 text-center text-sm text-muted-foreground">
          <p>
            <Armchair className="mx-auto mb-2 h-7 w-7" />
            Nenhuma mesa atribuída a você.
          </p>
        </div>
      )}
    </MobileFrame>
  );
}
