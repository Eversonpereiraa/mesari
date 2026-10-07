import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { RotateCw, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { actions, brl, tableStatus, total, useStore } from "@/lib/store";
import { Btn, Mark, StatusTag } from "@/components/ui-kit";
import { MobileFrame } from "@/components/mobile-frame";

export const Route = createFileRoute("/garcom")({
  head: () => ({
    meta: [
      { title: "Mesas — Garçom | Mesari" },
      { name: "description", content: "App do garçom: veja as mesas e lance pedidos pelo celular." },
      { property: "og:title", content: "Mesas — Garçom | Mesari" },
      { property: "og:description", content: "App do garçom: veja as mesas e lance pedidos pelo celular." },
    ],
  }),
  component: Garcom,
});

function Garcom() {
  const s = useStore((x) => x);
  const [spin, setSpin] = useState(false);
  const tables = [...s.tables].sort((a, b) => a.number - b.number);
  return (
    <MobileFrame
      header={
        <>
          <Mark className="h-7 w-7" />
          <span className="flex-1 truncate font-semibold tracking-wide text-ink">{s.restaurant.name.toUpperCase()}</span>
          <Btn variant="ghost" size="sm" aria-label="Atualizar" onClick={() => { setSpin(true); setTimeout(() => setSpin(false), 500); }}>
            <RotateCw className={cn("h-5 w-5", spin && "animate-spin")} />
          </Btn>
          <Btn variant="ghost" size="sm" aria-label="Sair" onClick={() => actions.logout()}><LogOut className="h-5 w-5" /></Btn>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-2 p-3">
        {tables.map((t) => {
          const st = tableStatus(s, t.id);
          return (
            <Link key={t.id} to="/mesa/$id" params={{ id: t.id }} className="rounded-lg border bg-card p-3 active:bg-muted">
              <div className="num text-3xl font-bold text-ink">{String(t.number).padStart(2, "0")}</div>
              <StatusTag s={st} className="mt-1 max-w-full truncate text-[11px]" />
              <div className="num mt-2 text-sm font-semibold text-ink">{st === "livre" ? "—" : brl(total(s.orders[t.id]))}</div>
            </Link>
          );
        })}
      </div>
    </MobileFrame>
  );
}
