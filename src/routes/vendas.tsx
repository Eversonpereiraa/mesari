import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Banknote, CalendarDays, CreditCard, QrCode, WalletCards } from "lucide-react";
import { AppShell } from "@/components/ui-kit";
import { BillViewer } from "@/components/bill-viewer";
import {
  actions,
  brl,
  errorMessage,
  paymentMethodLabel,
  type Closing,
  type PaymentMethod,
  type PaymentSummary,
} from "@/lib/store";
import { useStore } from "@/lib/store";
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

type Period = "hoje" | "ontem" | "semana" | "mes" | "data";
const methodIcons: Record<PaymentMethod, typeof Banknote> = {
  dinheiro: Banknote,
  pix: QrCode,
  credito: CreditCard,
  debito: WalletCards,
  nao_informado: CalendarDays,
};
const methods: Exclude<PaymentMethod, "nao_informado">[] = ["dinheiro", "pix", "credito", "debito"];
const todayValue = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
};

function periodRange(period: Period, selectedDate: string) {
  const anchor = period === "data" ? new Date(`${selectedDate}T00:00:00`) : new Date();
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const end = new Date(start);
  if (period === "ontem") start.setDate(start.getDate() - 1);
  if (period === "semana") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (period === "mes") start.setDate(1);
  end.setTime(start.getTime());
  if (period === "semana") end.setDate(start.getDate() + 6);
  else if (period === "mes") end.setMonth(start.getMonth() + 1, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function Vendas() {
  const user = useStore((snapshot) => snapshot.user);
  const authLoading = useStore((snapshot) => snapshot.loading);
  const snapshot = useStore((value) => value);
  const history = useStore((snapshot) => snapshot.history);
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>("hoje");
  const [selectedDate, setSelectedDate] = useState(todayValue);
  const [filter, setFilter] = useState<PaymentMethod | "todas">("todas");
  const [summary, setSummary] = useState<PaymentSummary[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedSale, setSelectedSale] = useState<Closing | null>(null);
  const range = useMemo(() => periodRange(period, selectedDate), [period, selectedDate]);

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
                ["data", "Data escolhida"],
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
            {period === "data" && (
              <input
                aria-label="Escolher data do relatório"
                type="date"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
                className="min-h-9 rounded-lg border bg-card px-3 text-sm"
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
                  {contas} {contas === 1 ? "conta" : "contas"} · {percent.toFixed(1)}%
                </div>
                <div
                  role="progressbar"
                  aria-label={`${paymentMethodLabel[forma]}: ${percent.toFixed(1)}% do total`}
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

        <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
            <div>
              <h2 className="font-display text-lg font-bold text-ink">Vendas do período</h2>
              <p className="text-sm text-muted-foreground">
                {filteredSales.length} vendas na lista carregada
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              Forma
              <select
                aria-label="Filtrar vendas por forma de pagamento"
                value={filter}
                onChange={(event) => setFilter(event.target.value as PaymentMethod | "todas")}
                className="min-h-10 rounded-lg border bg-background px-3"
              >
                <option value="todas">Todas</option>
                {methods.map((forma) => (
                  <option key={forma} value={forma}>
                    {paymentMethodLabel[forma]}
                  </option>
                ))}
                {summary.some((row) => row.forma === "nao_informado") && (
                  <option value="nao_informado">Não informado</option>
                )}
              </select>
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
                        Venda {String(sale.saleNumber).padStart(4, "0")} · Mesa {sale.table}
                      </div>
                      <time className="text-xs text-muted-foreground">
                        {new Date(sale.at).toLocaleString("pt-BR")}
                      </time>
                      <div className="mt-1 flex flex-wrap gap-1">
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
