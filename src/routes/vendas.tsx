import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Banknote, CalendarDays, CreditCard, QrCode, WalletCards } from "lucide-react";
import { AppShell } from "@/components/ui-kit";
import { AppSelect } from "@/components/app-select";
import { BillViewer } from "@/components/bill-viewer";
import {
  dateKeyForPicker,
  getShortcutRange,
  parseDateKey,
  ReportDatePicker,
  reportDateRange,
  saoPauloDateKey,
  type DateShortcut,
} from "@/components/report-date-picker";
import {
  actions,
  brl,
  errorMessage,
  paymentMethodLabel,
  type Closing,
  type OriginSummary,
  type PaymentMethod,
  type PaymentSummary,
} from "@/lib/store";
import { useStore } from "@/lib/store";
import { formatPercent } from "@/lib/masks";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/vendas")({
  head: () => ({
    meta: [
      { title: "Vendas | Mesari" },
      { name: "description", content: "Relatório de vendas e formas de pagamento." },
    ],
  }),
  component: Vendas,
});

type Period = "hoje" | "ontem" | "semana" | "mes" | "7dias" | "data" | "intervalo";
const methodIcons: Record<PaymentMethod, typeof Banknote> = {
  dinheiro: Banknote,
  pix: QrCode,
  credito: CreditCard,
  debito: WalletCards,
  nao_informado: CalendarDays,
};
const methods: Exclude<PaymentMethod, "nao_informado">[] = ["dinheiro", "pix", "credito", "debito"];
const todayValue = saoPauloDateKey;

function addDateDays(value: string, days: number) {
  const { year, month, day } = parseDateKey(value);
  const date = new Date(year, month - 1, day + days, 12);
  return dateKeyForPicker(date);
}

function periodRange(period: Period, selectedDate: string, selectedEndDate: string) {
  const today = todayValue();
  if (period === "data") return reportDateRange(selectedDate, selectedDate);
  if (period === "intervalo") return reportDateRange(selectedDate, selectedEndDate);
  if (period === "7dias") return reportDateRange(addDateDays(today, -6), today);
  if (period === "ontem") {
    const { start } = getShortcutRange("yesterday");
    const date = dateKeyForPicker(start);
    return reportDateRange(date, date);
  }
  if (period === "semana") {
    const { year, month, day } = parseDateKey(today);
    const start = new Date(year, month - 1, day, 12);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const startValue = dateKeyForPicker(start);
    const endValue = addDateDays(startValue, 6);
    return reportDateRange(startValue, endValue > today ? today : endValue);
  }
  if (period === "mes") {
    const start = `${today.slice(0, 7)}-01`;
    return reportDateRange(start, today);
  }
  return reportDateRange(today, today);
}

function Vendas() {
  const user = useStore((snapshot) => snapshot.user);
  const authLoading = useStore((snapshot) => snapshot.loading);
  const snapshot = useStore((value) => value);
  const history = useStore((snapshot) => snapshot.history);
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>("hoje");
  const [selectedDate, setSelectedDate] = useState(todayValue);
  const [selectedEndDate, setSelectedEndDate] = useState("");
  const [filter, setFilter] = useState<PaymentMethod | "todas">("todas");
  const [summary, setSummary] = useState<PaymentSummary[]>([]);
  const [originSummary, setOriginSummary] = useState<OriginSummary[]>([]);
  const [originError, setOriginError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedSale, setSelectedSale] = useState<Closing | null>(null);
  const range = useMemo(
    () => periodRange(period, selectedDate, selectedEndDate),
    [period, selectedDate, selectedEndDate],
  );

  useEffect(() => {
    if (!authLoading && !user) void navigate({ to: "/", replace: true });
    if (user && user.role !== "caixa") void navigate({ to: "/garcom", replace: true });
  }, [authLoading, navigate, user]);

  useEffect(() => {
    if (user?.role !== "caixa") return;
    let active = true;
    setLoading(true);
    setError("");
    setSummary([]);
    setOriginSummary([]);
    setOriginError("");
    actions
      .paymentSummary(range.start.toISOString(), range.end.toISOString())
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
      .originSummary(range.start.toISOString(), range.end.toISOString())
      .then((result) => {
        if (active) setOriginSummary(result);
      })
      .catch((cause: unknown) => {
        if (active) setOriginError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [range, user?.role]);

  const summaryTotal = summary.reduce((sum, row) => sum + Math.round(row.total * 100), 0);
  const visibleSummary = [
    ...methods.map(
      (forma) => summary.find((row) => row.forma === forma) ?? { forma, total: 0, contas: 0 },
    ),
    ...summary.filter((row) => row.forma === "nao_informado"),
  ];
  const filteredSales = history
    .filter((sale) => sale.at >= range.start.getTime() && sale.at <= range.end.getTime())
    .filter((sale) => {
      if (filter === "todas") return true;
      const forms = sale.payments.length
        ? sale.payments.map((payment) => payment.forma)
        : ["nao_informado"];
      return forms.includes(filter);
    });

  if (user?.role !== "caixa") return null;

  return (
    <AppShell center="Vendas">
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-extrabold text-ink">Vendas</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Totais e formas de pagamento no período selecionado.
            </p>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Período do relatório">
            {(
              [
                ["hoje", "Hoje"],
                ["ontem", "Ontem"],
                ["semana", "Semana"],
                ["mes", "Mês"],
                ["7dias", "Últimos 7 dias"],
                ["intervalo", "Intervalo de datas"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={period === value}
                onClick={() => setPeriod(value)}
                className={cn(
                  "min-h-9 rounded-full border px-3 text-sm font-semibold",
                  period === value
                    ? "border-primary bg-primary text-white"
                    : "bg-card text-muted-foreground hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
            {(period === "data" || period === "intervalo") && (
              <ReportDatePicker
                startValue={selectedDate}
                endValue={selectedEndDate}
                onChange={(start, end) => {
                  setSelectedDate(start);
                  setSelectedEndDate(end);
                  setPeriod(end ? "intervalo" : "data");
                }}
                onShortcut={(shortcut: DateShortcut) => {
                  const { start, end } = getShortcutRange(shortcut);
                  setSelectedDate(dateKeyForPicker(start));
                  setSelectedEndDate(dateKeyForPicker(end));
                  setPeriod(
                    shortcut === "today"
                      ? "hoje"
                      : shortcut === "yesterday"
                        ? "ontem"
                        : shortcut === "last7days"
                          ? "7dias"
                          : "mes",
                  );
                }}
              />
            )}
          </div>
        </header>

        {error && (
          <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            Não foi possível carregar o resumo: {error}
          </p>
        )}

        <section
          aria-label="Resumo por forma de pagamento"
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        >
          {visibleSummary.map(({ forma, total: amount, contas }) => {
            const Icon = methodIcons[forma];
            const percent = summaryTotal ? (Math.round(amount * 100) / summaryTotal) * 100 : 0;
            return (
              <article key={forma} className="rounded-xl border bg-card p-4 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                  <Icon className="h-4 w-4 text-primary" />
                  {paymentMethodLabel[forma]}
                </div>
                <div className="mt-3 font-display text-2xl font-extrabold text-ink">
                  {loading ? "—" : brl(amount)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {contas} {contas === 1 ? "conta" : "contas"} · {formatPercent(percent)}%
                </div>
                <div
                  role="progressbar"
                  aria-label={`${paymentMethodLabel[forma]}: ${formatPercent(percent)}% do total`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                  className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${Math.min(100, percent)}%` }}
                  />
                </div>
              </article>
            );
          })}
        </section>

        <section aria-label="Resumo por origem" className="grid gap-3 sm:grid-cols-3">
          {originError && <p className="text-sm text-destructive sm:col-span-3">{originError}</p>}
          {originSummary.map(({ origem, quantidade, total }) => (
            <article key={origem} className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="text-sm font-semibold text-muted-foreground">
                {origem === "mesa" ? "Mesa" : origem === "entrega" ? "Entrega" : "Retirada"}
              </div>
              <div className="mt-2 font-display text-xl font-extrabold text-ink">
                {loading ? "—" : brl(total)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {quantidade} {quantidade === 1 ? "venda" : "vendas"} no período
              </div>
            </article>
          ))}
        </section>

        <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
            <div>
              <h2 className="font-display text-lg font-bold text-ink">Vendas do período</h2>
              <p className="text-sm text-muted-foreground">
                {filteredSales.length} {filteredSales.length === 1 ? "venda" : "vendas"} na lista
                carregada
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              Forma
              <AppSelect
                aria-label="Filtrar vendas por forma de pagamento"
                value={filter}
                onValueChange={(value) => setFilter(value as PaymentMethod | "todas")}
                className="min-w-36"
                options={[
                  { value: "todas", label: "Todas" },
                  ...methods.map((forma) => ({
                    value: forma,
                    label: paymentMethodLabel[forma],
                    Icon: methodIcons[forma],
                  })),
                  ...(summary.some((row) => row.forma === "nao_informado")
                    ? [
                        {
                          value: "nao_informado",
                          label: "Não informado",
                          Icon: methodIcons.nao_informado,
                        },
                      ]
                    : []),
                ]}
              />
            </label>
          </div>
          {filteredSales.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              Nenhuma venda encontrada nesse período.
            </div>
          ) : (
            <div className="divide-y">
              {filteredSales.map((sale) => {
                const forms = sale.payments.length
                  ? [...new Set(sale.payments.map((payment) => paymentMethodLabel[payment.forma]))]
                  : [];
                return (
                  <article
                    key={sale.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div>
                      <div className="font-semibold text-ink">
                        Venda {String(sale.saleNumber).padStart(4, "0")} ·{" "}
                        {sale.origin === "entrega" || sale.origin === "retirada"
                          ? `${sale.origin === "entrega" ? "Entrega" : "Retirada"}${sale.customerName ? ` - ${sale.customerName}` : ""}`
                          : `Mesa ${sale.table}`}
                      </div>
                      <time className="text-xs text-muted-foreground">
                        {new Date(sale.at).toLocaleString("pt-BR")}
                      </time>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {sale.origin && sale.origin !== "mesa" && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${sale.origin === "entrega" ? "bg-blue-100 text-blue-800" : "bg-purple-100 text-purple-800"}`}
                          >
                            {sale.origin === "entrega" ? "ENTREGA" : "RETIRADA"}
                          </span>
                        )}
                        {(forms.length ? forms : ["Não informado"]).map((form) => (
                          <span
                            key={form}
                            className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                          >
                            {form}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="font-display text-lg font-bold text-ink">{brl(sale.total)}</div>
                    <button
                      type="button"
                      onClick={() => setSelectedSale(sale)}
                      className="rounded-lg border px-3 py-2 text-sm font-semibold text-primary hover:bg-accent"
                    >
                      Abrir nota
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
      {selectedSale && (
        <BillViewer
          s={snapshot}
          receipt={selectedSale}
          isReprint
          onClose={() => setSelectedSale(null)}
        />
      )}
    </AppShell>
  );
}
