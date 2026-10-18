import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Armchair,
  Banknote,
  CircleDollarSign,
  Plus,
  Printer,
  ReceiptText,
  RotateCw,
  Trash2,
  TriangleAlert,
  Utensils,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  actions,
  brl,
  count,
  errorMessage,
  paymentMethodLabel,
  tableStatus,
  total,
  useStore,
  type OriginSummary,
  type PaymentSummary,
  type PaymentInput,
  type PaymentMethod,
  type Status,
} from "@/lib/store";
import { AppShell, Btn, StatusTag } from "@/components/ui-kit";
import { MenuPicker } from "@/components/menu-picker";
import {
  billAmounts,
  clearConference,
  isConferenceOutdated,
  printTableConference,
  useConferenceVersion,
} from "@/lib/conference";
import { PaymentDialog } from "@/components/payment-dialog";
import { useConfirm } from "@/components/system-dialog-provider";

export const Route = createFileRoute("/caixa")({
  head: () => ({
    meta: [
      { title: "Mesas — Caixa | Mesari" },
      {
        name: "description",
        content: "Painel do caixa com todas as mesas, consumo e fechamento de conta.",
      },
      { property: "og:title", content: "Mesas — Caixa | Mesari" },
      {
        property: "og:description",
        content: "Painel do caixa com todas as mesas, consumo e fechamento de conta.",
      },
    ],
  }),
  component: Caixa,
});

type Filter = "todas" | Status;
const filters: { k: Filter; l: string }[] = [
  { k: "todas", l: "Todas" },
  { k: "livre", l: "Livres" },
  { k: "ocupada", l: "Ocupadas" },
  { k: "conta", l: "Conta" },
];
const filterActive: Record<Filter, string> = {
  todas: "bg-primary text-white",
  livre: "bg-free text-white",
  ocupada: "bg-busy text-white",
  conta: "bg-bill text-white",
};

function Caixa() {
  const s = useStore((x) => x);
  const navigate = useNavigate();
  const confirmar = useConfirm();
  const [f, setF] = useState<Filter>("todas");
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [spin, setSpin] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [splitBy, setSplitBy] = useState(1);
  const [printingBill, setPrintingBill] = useState(false);
  const [salesVersion, setSalesVersion] = useState(0);
  useConferenceVersion();
  const closing = useRef(false);
  const cleanedOrders = useRef(false);
  useEffect(() => {
    if (!s.loading && !s.user) void navigate({ to: "/", replace: true });
    if (s.user && s.user.role !== "caixa") void navigate({ to: "/garcom", replace: true });
  }, [navigate, s.loading, s.user]);
  useEffect(() => {
    if (s.user?.role !== "caixa" || cleanedOrders.current) return;
    cleanedOrders.current = true;
    void actions.cleanKitchenOrders().catch((cause: unknown) => toast.error(errorMessage(cause)));
  }, [s.user?.role]);

  const tables = [...s.tables]
    .sort((a, b) => a.number - b.number)
    .filter((t) => f === "todas" || tableStatus(s, t.id) === f);
  const sel = s.tables.find((t) => t.id === open);
  const lines = open ? (s.orders[open] ?? []) : [];
  const { serviceChargeCents, totalCents: amountDueCents } = billAmounts(lines, s.restaurant);
  const amountDue = amountDueCents / 100;
  const billOutdated = Boolean(
    sel && lines.length && isConferenceOutdated(sel.id, lines, s.restaurant),
  );
  const statusCounts: Record<Status, number> = { livre: 0, ocupada: 0, conta: 0 };
  for (const table of s.tables) statusCounts[tableStatus(s, table.id)] += 1;
  const openTotal = s.tables.reduce((sum, table) => {
    if (tableStatus(s, table.id) === "livre") return sum;
    const tableTotal = total(s.orders[table.id]);
    return sum + tableTotal;
  }, 0);
  const summaries = [
    { label: "Livres", value: statusCounts.livre, Icon: Armchair, tone: "text-free bg-free-bg" },
    {
      label: "Ocupadas",
      value: statusCounts.ocupada,
      Icon: Utensils,
      tone: "text-busy bg-busy-bg",
    },
    {
      label: "Aguardando conta",
      value: statusCounts.conta,
      Icon: ReceiptText,
      tone: "text-bill bg-bill-bg",
    },
    {
      label: "Total em aberto",
      value: brl(openTotal),
      Icon: CircleDollarSign,
      tone: "text-primary bg-accent",
    },
  ];

  /** Conferência de consumo: imprime sem fechar a conta e sem pedir pagamento. */
  const printBill = async () => {
    if (printingBill || !sel || !lines.length) return;
    const table = sel;
    setPrintingBill(true);
    try {
      const result = await printTableConference(table, lines, s.restaurant, splitBy);
      if (result.fallbackReason) {
        toast.warning(`Impressora direta indisponível: ${result.fallbackReason}`);
      }
      if (tableStatus(s, table.id) !== "conta") await actions.requestBill(table.id);
    } catch (error) {
      toast.error(`Não foi possível imprimir a conta: ${errorMessage(error)}`);
    } finally {
      setPrintingBill(false);
    }
  };

  /** Registra o pagamento e fecha a conta. Não imprime nada. */
  const receivePayment = async (payments: PaymentInput[]) => {
    if (closing.current || !sel || !lines.length) return;
    closing.current = true;
    try {
      const closedSale = await actions.closeBill(sel.id, payments);
      clearConference(sel.id);
      setPaymentOpen(false);
      setSalesVersion((version) => version + 1);
      toast.success(`Mesa ${closedSale.table} fechada e venda salva`);
    } finally {
      closing.current = false;
    }
  };

  if (s.user?.role !== "caixa") return null;

  return (
    <AppShell
      center="Mesas"
      right={
        <Btn
          variant="ghost"
          size="sm"
          aria-label="Atualizar"
          onClick={() => {
            setSpin(true);
            setTimeout(() => setSpin(false), 500);
          }}
        >
          <RotateCw className={cn("h-4 w-4", spin && "animate-spin")} />
        </Btn>
      }
    >
      <div className="flex min-w-0 flex-col xl:flex-row">
        <div className="min-w-0 flex-1 p-4 md:p-6">
          <section
            aria-label="Resumo das mesas"
            className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4"
          >
            {summaries.map(({ label, value, Icon, tone }) => (
              <div
                key={label}
                className="flex min-h-[82px] items-center gap-3 rounded-[14px] border bg-card px-4 py-3 shadow-sm"
              >
                <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", tone)}>
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-muted-foreground">{label}</div>
                  <div
                    className={cn(
                      "mt-1 truncate font-display text-xl font-extrabold text-ink",
                      label === "Total em aberto" && "text-lg",
                    )}
                  >
                    {value}
                  </div>
                </div>
              </div>
            ))}
            <TodaySalesCard refreshKey={salesVersion} />
          </section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-lg font-bold text-ink">Salão</h2>
            <div className="flex flex-wrap items-center gap-1.5">
              {filters.map((x) => {
                const filterCount = x.k === "todas" ? s.tables.length : statusCounts[x.k];
                return (
                  <button
                    key={x.k}
                    aria-pressed={f === x.k}
                    onClick={() => setF(x.k)}
                    className={cn(
                      "inline-flex min-h-10 items-center gap-1.5 rounded-full border border-transparent px-3 text-xs font-semibold transition-colors",
                      f === x.k
                        ? filterActive[x.k]
                        : "text-muted-foreground hover:border-border hover:bg-card hover:text-ink",
                    )}
                  >
                    {x.l}
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px]",
                        f === x.k ? "bg-white/20" : "bg-muted",
                      )}
                    >
                      {filterCount}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
            {tables.map((t) => {
              const st = tableStatus(s, t.id);
              const l = s.orders[t.id];
              const itemCount = count(l);
              const cardTone =
                st === "livre" ? "bg-free-bg" : st === "ocupada" ? "bg-busy-bg" : "bg-bill-bg";
              const stripeTone =
                st === "livre" ? "bg-free" : st === "ocupada" ? "bg-busy" : "bg-bill";
              return (
                <button
                  key={t.id}
                  aria-label={`Mesa ${t.number}, ${st === "conta" ? "conta solicitada" : st}`}
                  onClick={() => {
                    if (open !== t.id) setSplitBy(1);
                    setOpen(t.id);
                    setAdding(false);
                  }}
                  className={cn(
                    "group relative min-h-[166px] overflow-hidden rounded-[14px] border border-transparent p-4 pl-5 text-left shadow-sm transition duration-150 hover:-translate-y-0.5 hover:shadow-md",
                    cardTone,
                    st === "conta" && "table-requested",
                    open === t.id && "border-2 border-primary shadow-md",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn("absolute inset-y-0 left-0 w-[6px]", stripeTone)}
                  />
                  <div className="flex items-start justify-between">
                    <span className="font-display text-4xl font-extrabold leading-none text-ink">
                      {String(t.number).padStart(2, "0")}
                    </span>
                    <span className="text-xs font-medium text-muted-foreground">
                      {t.seats} lugares
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <StatusTag s={st} />
                    {st === "livre" ? (
                      <span
                        aria-label="Mesa livre"
                        title="Mesa livre"
                        className="text-muted-foreground"
                      >
                        <Armchair className="h-4 w-4" />
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {itemCount} {itemCount === 1 ? "item" : "itens"}
                      </span>
                    )}
                  </div>
                  {st !== "livre" && (
                    <div className="num mt-3 truncate text-xl font-extrabold text-ink">
                      {brl(total(l))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          {tables.length === 0 && (
            <div className="grid min-h-48 place-items-center text-center text-sm text-muted-foreground">
              <p>
                <Armchair className="mx-auto mb-2 h-7 w-7" />
                Nenhuma mesa neste filtro.
              </p>
            </div>
          )}
        </div>

        {sel && (
          <aside className="flex w-full shrink-0 flex-col border-t bg-card xl:sticky xl:top-16 xl:h-[calc(100vh-4rem)] xl:w-[390px] xl:border-l xl:border-t-0">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div className="flex items-center gap-3">
                <h2 className="font-display text-2xl font-extrabold text-ink">
                  Mesa {String(sel.number).padStart(2, "0")}
                </h2>
                <StatusTag s={tableStatus(s, sel.id)} />
              </div>
              <Btn
                variant="ghost"
                size="sm"
                aria-label="Fechar painel"
                onClick={() => setOpen(null)}
              >
                <X className="h-4 w-4" />
              </Btn>
            </div>

            {adding ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex items-center justify-between border-b px-4 py-2 text-sm">
                  <span className="font-medium text-ink">Adicionar item</span>
                  <button className="text-primary hover:underline" onClick={() => setAdding(false)}>
                    Concluir
                  </button>
                </div>
                <div className="min-h-0 flex-1">
                  <MenuPicker
                    onAdd={(item, quantity, note, print = true) =>
                      actions.addLine(sel.id, item, quantity, note, print)
                    }
                    onSubmit={(entries, print = true) => actions.addLines(sel.id, entries, print)}
                    showPrintOption
                  />
                </div>
              </div>
            ) : (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {lines.length === 0 ? (
                    <div className="grid min-h-48 place-items-center p-8 text-center text-sm text-muted-foreground">
                      <p>
                        <Utensils className="mx-auto mb-2 h-7 w-7 text-primary" />
                        Nenhum item lançado. Toque em Adicionar Item.
                      </p>
                    </div>
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
                          <tr key={l.id} className="border-b align-top">
                            <td className="px-4 py-2.5 text-ink">
                              {l.name}
                              {l.note && (
                                <div className="text-xs text-muted-foreground">Obs.: {l.note}</div>
                              )}
                              <button
                                aria-label={`Remover ${l.qty}x ${l.name}`}
                                className="mt-1 inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs font-semibold text-destructive hover:bg-destructive/10"
                                onClick={async () => {
                                  if (
                                    await confirmar({
                                      title: "Remover item?",
                                      description: `Remover ${l.qty}x ${l.name} desta mesa?`,
                                      confirmText: "Remover item",
                                      variant: "danger",
                                    })
                                  ) {
                                    actions.removeLine(sel.id, l.id);
                                  }
                                }}
                              >
                                <Trash2 className="h-3 w-3" /> Remover
                              </button>
                            </td>
                            <td className="num py-2.5 text-right">{l.qty}</td>
                            <td className="num py-2.5 text-right text-muted-foreground">
                              {brl(l.price)}
                            </td>
                            <td className="num px-4 py-2.5 text-right font-medium text-ink">
                              {brl(l.qty * l.price)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="border-t p-4">
                  <div className="mb-4 flex items-baseline justify-between">
                    <span className="text-sm text-muted-foreground">Total da mesa</span>
                    <span className="num text-2xl font-bold text-ink">{brl(amountDue)}</span>
                  </div>
                  {serviceChargeCents > 0 && (
                    <div className="-mt-3 mb-3 flex justify-between text-xs text-muted-foreground">
                      <span>Inclui taxa de serviço</span>
                      <span>{brl(serviceChargeCents / 100)}</span>
                    </div>
                  )}
                  {billOutdated && (
                    <div
                      role="alert"
                      className="mb-3 flex items-start gap-2 rounded-lg border border-bill bg-bill-bg px-3 py-2 text-sm font-semibold text-ink"
                    >
                      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-bill" />A conta mudou
                      depois da impressão. Reimprima antes de receber.
                    </div>
                  )}
                  <div className="grid gap-2">
                    <Btn
                      size="lg"
                      variant="outline"
                      className="w-full"
                      onClick={() => setAdding(true)}
                    >
                      <Plus className="h-5 w-5" />
                      Adicionar Item
                    </Btn>
                    <div className="flex gap-2">
                      <Btn
                        size="lg"
                        className={cn(
                          "min-w-0 flex-1",
                          billOutdated && "ring-2 ring-bill ring-offset-2 ring-offset-card",
                        )}
                        disabled={!lines.length || printingBill}
                        onClick={() => void printBill()}
                      >
                        <Printer className="h-5 w-5" />
                        {printingBill ? "Imprimindo..." : "Imprimir conta"}
                      </Btn>
                      <label
                        className="flex shrink-0 flex-col justify-center text-[11px] leading-tight text-muted-foreground"
                        title="Mostra na conta o valor por pessoa"
                      >
                        Dividir por
                        <input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={50}
                          aria-label="Dividir a conta por quantas pessoas"
                          className="field mt-0.5 h-8 w-16 px-2 text-sm text-ink"
                          value={splitBy}
                          onChange={(event) =>
                            setSplitBy(
                              Math.max(
                                1,
                                Math.min(50, Math.floor(Number(event.target.value)) || 1),
                              ),
                            )
                          }
                        />
                      </label>
                    </div>
                    <Btn
                      size="lg"
                      variant="success"
                      className="w-full"
                      disabled={!lines.length}
                      onClick={() => setPaymentOpen(true)}
                    >
                      <Wallet className="h-5 w-5" />
                      Receber pagamento
                    </Btn>
                  </div>
                </div>
              </>
            )}
          </aside>
        )}
      </div>
      {paymentOpen && sel && (
        <PaymentDialog
          table={sel.number}
          totalCents={amountDueCents}
          onClose={() => setPaymentOpen(false)}
          onConfirm={receivePayment}
        />
      )}
    </AppShell>
  );
}

function TodaySalesCard({ refreshKey }: { refreshKey: number }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<PaymentSummary[] | null>(null);
  const [originSummary, setOriginSummary] = useState<OriginSummary[]>([]);
  const [originError, setOriginError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setOriginError("");
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    actions
      .paymentSummary(start.toISOString(), end.toISOString())
      .then((result) => {
        if (active) setSummary(result);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    actions
      .originSummary(start.toISOString(), end.toISOString())
      .then((result) => {
        if (active) setOriginSummary(result);
      })
      .catch((cause: unknown) => {
        if (active) setOriginError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  const totalToday =
    (summary ?? []).reduce((sum, row) => sum + Math.round(row.total * 100), 0) / 100;
  return (
    <div className="group relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-[82px] w-full items-center gap-3 rounded-[14px] border bg-card px-4 py-3 text-left shadow-sm"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-free-bg text-free">
          <Banknote className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-medium text-muted-foreground">Vendido hoje</span>
          <span className="mt-1 block truncate font-display text-xl font-extrabold text-ink">
            {loading && !summary ? "Carregando..." : error && !summary ? "—" : brl(totalToday)}
          </span>
        </span>
      </button>
      <div
        className={cn(
          "absolute right-0 top-full z-20 mt-2 hidden w-72 rounded-xl border bg-card p-3 shadow-xl group-hover:block",
          open && "!block",
        )}
      >
        <h3 className="mb-2 text-sm font-bold text-ink">Vendas de hoje por forma</h3>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : loading && !summary ? (
          <p className="text-xs text-muted-foreground">Carregando resumo...</p>
        ) : (
          <div className="space-y-1.5">
            {(
              ["dinheiro", "pix", "credito", "debito", "nao_informado"] satisfies PaymentMethod[]
            ).map((form) => {
              const row = summary?.find((payment) => payment.forma === form);
              if (!row && form === "nao_informado") return null;
              return (
                <div key={form} className="flex justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">{paymentMethodLabel[form]}</span>
                  <span className="font-semibold text-ink">{brl(row?.total ?? 0)}</span>
                </div>
              );
            })}
          </div>
        )}
        <h3 className="mb-2 mt-4 border-t pt-3 text-sm font-bold text-ink">
          Vendas de hoje por origem
        </h3>
        {originError && (
          <p role="alert" className="text-xs text-destructive">
            {originError}
          </p>
        )}
        <div className="space-y-1.5">
          {originSummary.map(({ origem, quantidade, total }) => (
            <div key={origem} className="flex justify-between gap-2 text-xs">
              <span className="text-muted-foreground">
                {origem === "mesa" ? "Mesa" : origem === "entrega" ? "Entrega" : "Retirada"} ·{" "}
                {quantidade}
              </span>
              <span className="font-semibold text-ink">{brl(total)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
