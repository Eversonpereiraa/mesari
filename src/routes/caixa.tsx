import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Armchair,
  Banknote,
  CircleDollarSign,
  ReceiptText,
  RotateCw,
  Utensils,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  actions,
  brl,
  errorMessage,
  paymentMethodLabel,
  tableStatus,
  billTotals,
  useStore,
  type OrderLine,
  type OriginSummary,
  type PaymentSummary,
  type PaymentInput,
  type PaymentMethod,
  type Status,
} from "@/lib/store";
import { AppShell, Btn } from "@/components/ui-kit";
import { MenuPicker } from "@/components/menu-picker";
import { PaymentDialog } from "@/components/payment-dialog";
import { printPreBill, reprintBill, useBillPrintFailures } from "@/lib/bill-print";
import { abrirGaveta, avisarFalhaImpressao, loadConfig } from "@/lib/printing";
import { requestBillPrint, usePrintQueue } from "@/lib/print-queue";
import { useConfirm } from "@/components/system-dialog-provider";
import {
  AreaFilter,
  MapCard,
  SalaoMap,
  StatusLegend,
  type Selection,
} from "@/components/salao/SalaoMap";
import {
  LiveEmptyPanel,
  LiveTablePanel,
  PanelCard,
  StatusPill,
} from "@/components/salao/TablePanel";
import { useLiveInfo, useMinuteClock, useSalaoData } from "@/components/salao/useSalao";
import { tableNumber } from "@/components/salao/iso";

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

function Caixa() {
  // Só o que a tela usa: mudanças em outras partes do store não redesenham o caixa nem o mapa.
  const user = useStore((x) => x.user);
  const loading = useStore((x) => x.loading);
  const tables = useStore((x) => x.tables);
  const orders = useStore((x) => x.orders);
  const restaurant = useStore((x) => x.restaurant);
  const billPrintAvailable = useStore((x) => x.billPrintAvailable);
  // Fila de impressão no banco: a conta sai sozinha na estação quando a mesa vai para "conta".
  const queueAvailable = usePrintQueue().available === true;
  const navigate = useNavigate();
  const confirmar = useConfirm();
  const salao = useSalaoData();
  const salaoTables = salao.tables;
  const liveInfo = useLiveInfo(salaoTables);
  const [areaFilter, setAreaFilter] = useState<string | null>(null);
  const tablesPerArea = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of salaoTables) if (t.areaId) counts[t.areaId] = (counts[t.areaId] ?? 0) + 1;
    return counts;
  }, [salaoTables]);
  const focusAreaId =
    areaFilter && salao.areas.some((a) => a.id === areaFilter) ? areaFilter : null;
  const now = useMinuteClock();
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [spin, setSpin] = useState(false);
  const [reprinting, setReprinting] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [salesVersion, setSalesVersion] = useState(0);
  const closing = useRef(false);
  const cleanedOrders = useRef(false);
  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/", replace: true });
    if (user && user.role !== "caixa") void navigate({ to: "/garcom", replace: true });
  }, [navigate, loading, user]);
  useEffect(() => {
    if (user?.role !== "caixa" || cleanedOrders.current) return;
    cleanedOrders.current = true;
    void actions.cleanKitchenOrders().catch((cause: unknown) => toast.error(errorMessage(cause)));
  }, [user?.role]);

  const sel = salaoTables.find((t) => t.id === open);
  const selInfo = sel ? liveInfo[sel.id] : undefined;
  const lines = open ? (orders[open] ?? []) : [];
  // Mesmo cálculo do mapa e da nota de consumo (com taxa de serviço, se ativa).
  const { serviceChargeCents, totalCents: amountDueCents } = billTotals(lines, restaurant);
  const amountDue = amountDueCents / 100;
  const billFailures = useBillPrintFailures();
  const billFailed = sel ? billFailures.has(sel.id) : false;
  const billOutdated =
    sel?.status === "ocupada" &&
    sel.billPrintedAt != null &&
    lines.some((line) => line.at > (sel.billPrintedAt ?? 0));
  const selectTable = useCallback((id: string | null) => {
    setOpen(id);
    setAdding(false);
    // Em telas estreitas o painel fica embaixo do mapa: leva o caixa até ele.
    if (id && window.matchMedia("(max-width: 980px)").matches) {
      requestAnimationFrame(() =>
        panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    }
  }, []);
  const mapSelection = useMemo<Selection | null>(
    () => (open ? { kind: "table", id: open } : null),
    [open],
  );
  const onMapSelect = useCallback(
    (selection: Selection | null) => selectTable(selection?.kind === "table" ? selection.id : null),
    [selectTable],
  );
  const requestBill = async () => {
    if (!sel) return;
    const table = sel;
    const tableLines = lines;
    try {
      await actions.requestBill(table.id);
    } catch (cause) {
      toast.error(errorMessage(cause));
      return;
    }
    toast.success(`Conta solicitada na mesa ${tableNumber(table.number)}. Imprimindo a nota...`);
    // Com a fila (ou a migration da nota), a estação de impressão imprime; antes dela, imprime aqui.
    if (queueAvailable || billPrintAvailable) return;
    try {
      await printPreBill(table, tableLines, restaurant);
    } catch (cause) {
      avisarFalhaImpressao(cause, {
        title: "Nota não impressa",
        onRetry: () =>
          void reprintBill(table, tableLines, restaurant, false).catch(avisarFalhaImpressao),
      });
    }
  };
  const reprint = async () => {
    if (!sel) return;
    setReprinting(true);
    try {
      if (queueAvailable) await requestBillPrint(sel.id);
      else await reprintBill(sel, lines, restaurant, billPrintAvailable);
      toast.success(`Reimprimindo a nota da mesa ${tableNumber(sel.number)}`);
    } catch (cause) {
      avisarFalhaImpressao(cause, { title: "Nota não impressa", onRetry: () => void reprint() });
    } finally {
      setReprinting(false);
    }
  };
  const removeLine = async (line: OrderLine) => {
    if (
      sel &&
      (await confirmar({
        title: "Remover item?",
        description: `Remover ${line.qty}x ${line.name} desta mesa?`,
        confirmText: "Remover item",
        variant: "danger",
      }))
    ) {
      actions.removeLine(sel.id, line.id);
    }
  };
  const statusCounts: Record<Status, number> = { livre: 0, ocupada: 0, conta: 0 };
  for (const table of tables) statusCounts[tableStatus({ tables }, table.id)] += 1;
  const openTotal =
    tables.reduce((sum, table) => {
      if (tableStatus({ tables }, table.id) === "livre") return sum;
      return sum + billTotals(orders[table.id], restaurant).totalCents;
    }, 0) / 100;
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

  /** Registra o pagamento e libera a mesa. Não imprime: a nota sai ao pedir a conta. */
  const receivePayment = async (payments: PaymentInput[]) => {
    if (closing.current || !sel || !lines.length) return;
    closing.current = true;
    try {
      const closedSale = await actions.closeBill(sel.id, payments);
      setPaymentOpen(false);
      // Pagamento já gravado: a gaveta é extra e nunca desfaz o fechamento.
      if (loadConfig().openDrawerOnPayment) void abrirGaveta().catch(avisarFalhaImpressao);
      setSalesVersion((version) => version + 1);
      toast.success(
        `Pagamento recebido. Mesa ${tableNumber(closedSale.table)} liberada e venda salva.`,
      );
    } finally {
      closing.current = false;
    }
  };

  if (user?.role !== "caixa") return null;

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
      <div className="min-w-0 p-4 md:p-6">
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
        <div className="grid items-start gap-4 min-[981px]:grid-cols-[minmax(0,1fr)_340px]">
          <MapCard
            legend={<StatusLegend />}
            toolbar={
              salao.areas.length > 1 ? (
                <AreaFilter
                  areas={salao.areas}
                  counts={tablesPerArea}
                  value={focusAreaId}
                  onChange={setAreaFilter}
                />
              ) : undefined
            }
          >
            <SalaoMap
              mode="live"
              tables={salaoTables}
              areas={salao.areas}
              elements={salao.elements}
              live={liveInfo}
              now={now}
              selection={mapSelection}
              onSelect={onMapSelect}
              focusAreaId={focusAreaId}
            />
            {salaoTables.length === 0 && (
              <p className="flex items-center justify-center gap-2 border-t p-4 text-sm text-muted-foreground">
                <Armchair className="h-4 w-4" />
                Nenhuma mesa cadastrada. Monte o salão em Layout do salão.
              </p>
            )}
          </MapCard>
          <div
            ref={panelRef}
            className="min-w-0 scroll-mt-20 min-[981px]:sticky min-[981px]:top-20"
          >
            {!sel || !selInfo ? (
              <LiveEmptyPanel />
            ) : adding ? (
              <PanelCard className="h-[min(640px,80vh)] gap-0 overflow-hidden p-0">
                <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <h2 className="font-display text-lg font-extrabold text-ink">
                      Mesa {tableNumber(sel.number)}
                    </h2>
                    <StatusPill status={selInfo.status} />
                  </div>
                  <button
                    className="text-sm font-medium text-primary hover:underline"
                    onClick={() => setAdding(false)}
                  >
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
              </PanelCard>
            ) : (
              <LiveTablePanel
                table={sel}
                info={selInfo}
                now={now}
                amountDue={amountDue}
                serviceCharge={serviceChargeCents / 100}
                billFailed={billFailed}
                billOutdated={billOutdated}
                reprinting={reprinting}
                onClose={() => selectTable(null)}
                onAddItem={() => setAdding(true)}
                onRequestBill={() => void requestBill()}
                onReprint={() => void reprint()}
                onReceivePayment={() => setPaymentOpen(true)}
                onRemoveLine={(line) => void removeLine(line)}
              />
            )}
          </div>
        </div>
      </div>
      {paymentOpen && sel && (
        <PaymentDialog
          table={sel.number}
          totalCents={amountDueCents}
          confirmLabel="Receber pagamento"
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
