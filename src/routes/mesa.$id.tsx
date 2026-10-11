import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Armchair, Plus } from "lucide-react";
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
  const [orderSent, setOrderSent] = useState(false);
  const [kitchenOffline, setKitchenOffline] = useState(false);

  useEffect(() => {
    const sent = sessionStorage.getItem("mesari-order-sent");
    if (!sent?.startsWith(`${id}:`)) return;
    sessionStorage.removeItem("mesari-order-sent");
    setKitchenOffline(sent.endsWith(":offline"));
    setOrderSent(true);
    const timer = window.setTimeout(() => setOrderSent(false), 3200);
    return () => window.clearTimeout(timer);
  }, [id]);

  if (!t) return <p className="p-8 text-center">Mesa não encontrada.</p>;

  return (
    <MobileFrame
      title={`Mesa ${String(t.number).padStart(2, "0")}`}
      subtitle="Detalhe da mesa"
      onBack={() => nav({ to: "/garcom" })}
      footer={
        <div className="grid gap-2">
          <Link
            to="/pedido/$id"
            params={{ id }}
            className={btn({ size: "lg", className: "min-h-12 w-full" })}
          >
            <Plus className="h-5 w-5" />
            Adicionar Pedido
          </Link>
          <div className="grid grid-cols-2 gap-2">
            <Btn
              size="lg"
              variant="success"
              disabled={!lines.length || st === "conta"}
              onClick={() => actions.requestBill(id)}
            >
              {st === "conta" ? "Conta pedida" : "Fechar Conta"}
            </Btn>
            <Btn size="lg" variant="neutral" onClick={() => nav({ to: "/garcom" })}>
              Voltar
            </Btn>
          </div>
        </div>
      }
    >
      <div className="px-4 pt-4">
        <StatusTag s={st} />
      </div>
      {orderSent && (
        <div
          role="status"
          className="mx-3 mt-3 rounded-xl bg-free px-4 py-3 text-sm font-bold text-white shadow-sm"
        >
          {kitchenOffline
            ? "Impressora desconectada. O pedido foi enviado, avise o caixa."
            : "Pedido enviado para a cozinha"}
        </div>
      )}
      {lines.length === 0 ? (
        <div className="grid min-h-56 place-items-center p-10 text-center text-sm text-muted-foreground">
          <p>
            <Armchair className="mx-auto mb-2 h-8 w-8 text-primary" />
            Mesa livre. Nenhum pedido lançado.
          </p>
        </div>
      ) : (
        <ul className="mx-3 mt-3 overflow-hidden rounded-[14px] border bg-card">
          {lines.map((l) => (
            <li key={l.id} className="flex items-start justify-between gap-3 border-b px-4 py-3">
              <div className="min-w-0">
                <div className="font-medium text-ink">
                  <span className="num">{l.qty}×</span> {l.name}
                </div>
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
