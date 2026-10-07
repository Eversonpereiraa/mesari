import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { actions, brl, tableStatus, total, useStore } from "@/lib/store";
import { Btn, StatusTag, btn } from "@/components/ui-kit";
import { MobileFrame } from "@/components/mobile-frame";

export const Route = createFileRoute("/mesa/$id")({
  head: () => ({
    meta: [
      { title: "Detalhe da mesa | Mesari" },
      { name: "description", content: "Itens pedidos e total da mesa." },
      { property: "og:title", content: "Detalhe da mesa | Mesari" },
      { property: "og:description", content: "Itens pedidos e total da mesa." },
    ],
  }),
  component: Mesa,
});

function Mesa() {
  const { id } = Route.useParams();
  const s = useStore((x) => x);
  const nav = useNavigate();
  const t = s.tables.find((x) => x.id === id);
  const lines = s.orders[id] ?? [];
  const st = tableStatus(s, id);
  if (!t) return <p className="p-8 text-center">Mesa não encontrada.</p>;

  return (
    <MobileFrame
      header={
        <>
          <Link to="/garcom" aria-label="Voltar" className="-ml-2 p-2 text-ink"><ChevronLeft className="h-5 w-5" /></Link>
          <h1 className="text-lg font-semibold text-ink">Mesa {String(t.number).padStart(2, "0")}</h1>
          <StatusTag s={st} className="ml-auto" />
        </>
      }
      footer={
        <div className="grid gap-2">
          <Link to="/pedido/$id" params={{ id }} className={btn({ size: "lg" })}>Adicionar Pedido</Link>
          <div className="grid grid-cols-2 gap-2">
            <Btn size="lg" variant="success" disabled={!lines.length || st === "conta"} onClick={() => actions.requestBill(id)}>
              {st === "conta" ? "Conta pedida" : "Fechar Conta"}
            </Btn>
            <Btn size="lg" variant="neutral" onClick={() => nav({ to: "/garcom" })}>Voltar</Btn>
          </div>
        </div>
      }
    >
      {lines.length === 0 ? (
        <p className="p-10 text-center text-sm text-muted-foreground">Mesa livre. Nenhum pedido lançado.</p>
      ) : (
        <ul className="bg-card">
          {lines.map((l) => (
            <li key={l.id} className="flex items-start justify-between gap-3 border-b px-4 py-3">
              <div className="min-w-0">
                <div className="font-medium text-ink"><span className="num">{l.qty}×</span> {l.name}</div>
                {l.note && <div className="text-xs text-muted-foreground">Obs.: {l.note}</div>}
              </div>
              <span className="num shrink-0 font-medium text-ink">{brl(l.qty * l.price)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-baseline justify-between px-4 py-4">
        <span className="text-sm text-muted-foreground">Total</span>
        <span className="num text-2xl font-bold text-ink">{brl(total(lines))}</span>
      </div>
    </MobileFrame>
  );
}
