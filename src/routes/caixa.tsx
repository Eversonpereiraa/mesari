import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { RotateCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { actions, brl, count, tableStatus, total, useStore, type Status } from "@/lib/store";
import { AppShell, Btn, StatusTag } from "@/components/ui-kit";
import { MenuPicker } from "@/components/menu-picker";
import { BillViewer } from "@/components/bill-viewer";

export const Route = createFileRoute("/caixa")({
  head: () => ({
    meta: [
      { title: "Mesas — Caixa | Mesari" },
      { name: "description", content: "Painel do caixa com todas as mesas, consumo e fechamento de conta." },
      { property: "og:title", content: "Mesas — Caixa | Mesari" },
      { property: "og:description", content: "Painel do caixa com todas as mesas, consumo e fechamento de conta." },
    ],
  }),
  component: Caixa,
});

type Filter = "todas" | Status;
const filters: { k: Filter; l: string }[] = [
  { k: "todas", l: "Todas" }, { k: "livre", l: "Livres" }, { k: "ocupada", l: "Ocupadas" }, { k: "conta", l: "Conta" },
];

function Caixa() {
  const s = useStore((x) => x);
  const [f, setF] = useState<Filter>("todas");
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [spin, setSpin] = useState(false);
  const [viewer, setViewer] = useState(false);

  const tables = [...s.tables].sort((a, b) => a.number - b.number).filter((t) => f === "todas" || tableStatus(s, t.id) === f);
  const sel = s.tables.find((t) => t.id === open);
  const lines = open ? s.orders[open] ?? [] : [];

  return (
    <AppShell
      center="Mesas"
      right={
        <div className="flex items-center gap-1">
          {filters.map((x) => (
            <button key={x.k} onClick={() => setF(x.k)}
              className={cn("rounded-md px-2.5 py-1.5 text-sm", f === x.k ? "bg-muted font-semibold text-ink" : "text-muted-foreground hover:text-ink")}>
              {x.l}
            </button>
          ))}
          <Btn variant="ghost" size="sm" aria-label="Atualizar" onClick={() => { setSpin(true); setTimeout(() => setSpin(false), 500); }}>
            <RotateCw className={cn("h-4 w-4", spin && "animate-spin")} />
          </Btn>
        </div>
      }
    >
      <div className="flex">
        <div className="min-w-0 flex-1 p-5">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
            {tables.map((t) => {
              const st = tableStatus(s, t.id);
              const l = s.orders[t.id];
              return (
                <button key={t.id} onClick={() => { setOpen(t.id); setAdding(false); }}
                  className={cn("rounded-lg border bg-card p-4 text-left transition-colors hover:border-input",
                    open === t.id && "border-primary ring-1 ring-primary")}>
                  <div className="flex items-start justify-between">
                    <span className="num text-3xl font-bold text-ink">{String(t.number).padStart(2, "0")}</span>
                    <span className="text-xs text-muted-foreground">{t.seats} lug.</span>
                  </div>
                  <StatusTag s={st} className="mt-2" />
                  <div className="mt-3 flex items-end justify-between border-t pt-2">
                    <span className="num font-semibold text-ink">{st === "livre" ? "—" : brl(total(l))}</span>
                    <span className="text-xs text-muted-foreground">{count(l)} itens</span>
                  </div>
                </button>
              );
            })}
          </div>
          {tables.length === 0 && <p className="py-16 text-center text-sm text-muted-foreground">Nenhuma mesa neste filtro.</p>}
        </div>

        {sel && (
          <aside className="sticky top-14 flex h-[calc(100vh-3.5rem)] w-[380px] shrink-0 flex-col border-l bg-card">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-ink">Mesa {String(sel.number).padStart(2, "0")}</h2>
                <StatusTag s={tableStatus(s, sel.id)} />
              </div>
              <Btn variant="ghost" size="sm" aria-label="Fechar painel" onClick={() => setOpen(null)}><X className="h-4 w-4" /></Btn>
            </div>

            {adding ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex items-center justify-between border-b px-4 py-2 text-sm">
                  <span className="font-medium text-ink">Adicionar item</span>
                  <button className="text-primary hover:underline" onClick={() => setAdding(false)}>Concluir</button>
                </div>
                <div className="min-h-0 flex-1">
                  <MenuPicker onAdd={(i, q, n) => actions.addLine(sel.id, i, q, n, s.user?.name ?? "Caixa")} />
                </div>
              </div>
            ) : (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {lines.length === 0 ? (
                    <p className="p-8 text-center text-sm text-muted-foreground">Nenhum item lançado.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="text-xs text-muted-foreground">
                        <tr className="border-b">
                          <th className="px-4 py-2 text-left font-medium">Item</th>
                          <th className="py-2 text-right font-medium">Qtd</th>
                          <th className="py-2 text-right font-medium">Unit.</th>
                          <th className="px-4 py-2 text-right font-medium">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((l) => (
                          <tr key={l.id} className="group border-b align-top">
                            <td className="px-4 py-2.5 text-ink">
                              {l.name}
                              {l.note && <div className="text-xs text-muted-foreground">Obs.: {l.note}</div>}
                              <button className="hidden text-xs text-destructive group-hover:block" onClick={() => { if (confirm(`Remover ${l.qty}x ${l.name}?`)) actions.removeLine(sel.id, l.id); }}>remover</button>
                            </td>
                            <td className="num py-2.5 text-right">{l.qty}</td>
                            <td className="num py-2.5 text-right text-muted-foreground">{brl(l.price)}</td>
                            <td className="num px-4 py-2.5 text-right font-medium text-ink">{brl(l.qty * l.price)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="border-t p-4">
                  <div className="mb-4 flex items-baseline justify-between">
                    <span className="text-sm text-muted-foreground">Total da mesa</span>
                    <span className="num text-2xl font-bold text-ink">{brl(total(lines))}</span>
                  </div>
                  <div className="grid gap-2">
                    <Btn onClick={() => setAdding(true)}>Adicionar Item</Btn>
                    <div className="grid grid-cols-2 gap-2">
                      <Btn variant="success" disabled={!lines.length}
                        onClick={() => { if (confirm(`Fechar conta da mesa ${sel.number} — ${brl(total(lines))}?`)) actions.closeBill(sel.id); }}>
                        Fechar Conta
                      </Btn>
                      <Btn variant="neutral" disabled={!lines.length} onClick={() => setViewer(true)}>Imprimir a conta</Btn>
                    </div>
                  </div>
                </div>
              </>
            )}
          </aside>
        )}
      </div>
      {viewer && sel && <BillViewer s={s} tableId={sel.id} onClose={() => setViewer(false)} />}
    </AppShell>
  );
}
