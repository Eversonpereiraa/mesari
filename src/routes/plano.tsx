import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, Copy, Crown, X } from "lucide-react";
import { actions, mapPlan, useStore, type PlanInfo, type PlanLimits } from "@/lib/store";
import { AppShell, Btn, btn } from "@/components/ui-kit";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

/**
 * Página de pagamento (checkout) na landing page. Defina VITE_MESARI_CHECKOUT_URL
 * (ex.: https://mesari.com.br/assinar). O app abre: <url>?plano=<id>&ciclo=<mensal|anual>&restaurante=<código>
 */
const CHECKOUT_URL: string =
  import.meta.env["VITE_MESARI_CHECKOUT_URL"] || "https://mesari-site.vercel.app/";

export const Route = createFileRoute("/plano")({
  head: () => ({
    meta: [
      { title: "Meu plano | Mesari" },
      { name: "description", content: "Plano, assinatura e limites do Mesari." },
    ],
  }),
  component: Plano,
});

const statusLabel: Record<PlanInfo["status"], string> = {
  teste: "Teste grátis",
  ativa: "Ativa",
  atrasada: "Pagamento atrasado",
  cancelada: "Cancelada (vale até o fim do período)",
  expirada: "Vencida",
};

const money = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const date = (ms: number | null) =>
  ms === null
    ? "—"
    : new Date(ms).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

function checkoutLink(plan: PlanLimits["id"], cycle: "mensal" | "anual", code: string) {
  if (!CHECKOUT_URL) return "";
  const url = new URL(CHECKOUT_URL);
  url.searchParams.set("plano", plan);
  url.searchParams.set("ciclo", cycle);
  if (code) url.searchParams.set("restaurante", code);
  return url.toString();
}

function Plano() {
  const info = useStore((s) => s.plan);
  const role = useStore((s) => s.user?.role);
  const [plans, setPlans] = useState<PlanLimits[]>([]);
  const [cycle, setCycle] = useState<"mensal" | "anual">("mensal");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void actions
      .refreshPlan()
      .catch((cause: unknown) => setError(String((cause as Error)?.message ?? cause)));
    void supabase
      .from("planos")
      .select("*")
      .order("ordem")
      .then(({ data, error: loadError }) => {
        if (loadError) setError(loadError.message);
        else setPlans((data ?? []).map(mapPlan));
      });
  }, []);

  useEffect(() => {
    if (info?.cycle) setCycle(info.cycle);
  }, [info?.cycle]);

  const copyCode = async () => {
    if (!info?.restaurantCode) return;
    try {
      await navigator.clipboard.writeText(info.restaurantCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Sem permissão de área de transferência: o código continua visível na tela.
    }
  };

  return (
    <AppShell center="Meu plano">
      <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
        {error && (
          <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
        )}

        {info && (
          <section className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
            <div className="rounded-xl border bg-card p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Crown className="h-5 w-5 text-primary" />
                <h2 className="font-display text-xl font-bold">Plano {info.plan.name}</h2>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-xs font-bold",
                    info.active ? "bg-free-bg text-free" : "bg-busy-bg text-busy",
                  )}
                >
                  {statusLabel[info.status]}
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {info.status === "teste"
                  ? "O teste termina em "
                  : info.autoRenew
                    ? "Renova em "
                    : "Válido até "}
                <strong className="text-ink">{date(info.periodEnd)}</strong>
                {info.cycle && info.status !== "teste" ? ` · cobrança ${info.cycle}` : ""}
              </p>
              <div className="mt-5 space-y-3">
                <Usage label="Mesas" used={info.usage.tables} max={info.plan.maxTables} />
                <Usage label="Garçons" used={info.usage.waiters} max={info.plan.maxWaiters} />
                <Usage
                  label="Usuários de caixa"
                  used={info.usage.cashiers}
                  max={info.plan.maxCashiers}
                />
                <Usage label="Áreas do salão" used={info.usage.areas} max={info.plan.maxAreas} />
              </div>
            </div>

            <div className="rounded-xl border bg-card p-5">
              <h3 className="font-semibold">Código do restaurante</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Os garçons e o caixa usam este código, junto com o usuário e a senha, para entrar no
                app pela primeira vez em cada aparelho.
              </p>
              <button
                type="button"
                onClick={copyCode}
                className="mt-4 flex w-full items-center justify-between rounded-lg border-2 border-dashed border-primary/40 bg-accent px-4 py-3 font-mono text-3xl font-bold tracking-[0.3em] text-primary"
              >
                {info.restaurantCode}
                {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5 opacity-60" />}
              </button>
            </div>
          </section>
        )}

        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-lg font-bold">Planos</h2>
            <div className="inline-flex rounded-lg border bg-card p-1 text-sm">
              {(["mensal", "anual"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setCycle(value)}
                  className={cn(
                    "rounded-md px-3 py-1.5 font-medium",
                    cycle === value ? "bg-primary text-white" : "text-muted-foreground",
                  )}
                >
                  {value === "mensal" ? "Mensal" : "Anual (2 meses grátis)"}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {plans.map((plan) => {
              const current = info?.plan.id === plan.id && info.status !== "teste";
              const featured = plan.id === "profissional";
              const link = checkoutLink(plan.id, cycle, info?.restaurantCode ?? "");
              const price = cycle === "mensal" ? plan.monthlyPrice : plan.yearlyPrice;
              return (
                <div
                  key={plan.id}
                  className={cn(
                    "relative flex flex-col rounded-xl border bg-card p-5",
                    featured && "border-primary shadow-lg",
                  )}
                >
                  {featured && (
                    <span className="absolute -top-3 left-5 rounded-full bg-primary px-3 py-0.5 text-xs font-bold text-white">
                      Mais escolhido
                    </span>
                  )}
                  <h3 className="font-display text-lg font-bold">{plan.name}</h3>
                  <p className="mt-2">
                    <span className="font-display text-3xl font-bold">{money(price)}</span>
                    <span className="text-sm text-muted-foreground">
                      /{cycle === "mensal" ? "mês" : "ano"}
                    </span>
                  </p>
                  {cycle === "anual" && (
                    <p className="text-xs text-muted-foreground">
                      equivale a {money(plan.yearlyPrice / 12)}/mês
                    </p>
                  )}
                  <ul className="my-5 flex-1 space-y-2 text-sm">
                    <Feature ok text={limitText(plan.maxTables, "mesa", "mesas")} />
                    <Feature ok text={limitText(plan.maxWaiters, "garçom", "garçons")} />
                    <Feature
                      ok
                      text={limitText(plan.maxCashiers, "usuário de caixa", "usuários de caixa")}
                    />
                    <Feature ok text={limitText(plan.maxPrinters, "impressora", "impressoras")} />
                    <Feature ok={plan.delivery} text="Delivery e balcão" />
                    <Feature
                      ok={(plan.maxAreas ?? 2) > 1}
                      text="Várias áreas no salão (varanda, calçada...)"
                    />
                    <Feature ok={plan.printLogo} text="Logo na comanda e na conta" />
                    <Feature
                      ok
                      text={
                        plan.historyDays === null
                          ? "Histórico de vendas completo"
                          : `Histórico de ${plan.historyDays} dias`
                      }
                    />
                    <Feature ok text={`Suporte: ${plan.support}`} />
                  </ul>
                  {role === "caixa" &&
                    (current ? (
                      <Btn variant="outline" disabled className="w-full">
                        Plano atual
                      </Btn>
                    ) : link ? (
                      <a
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        className={cn(
                          btn({ variant: featured ? "primary" : "outline" }),
                          "h-10 w-full",
                        )}
                      >
                        {info?.plan.id === plan.id ? "Assinar" : "Mudar para este plano"}
                      </a>
                    ) : (
                      <Btn variant="outline" disabled className="w-full">
                        Pagamento online em breve
                      </Btn>
                    ))}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function limitText(max: number | null, one: string, many: string) {
  if (max === null) return `${many.charAt(0).toUpperCase()}${many.slice(1)} ilimitados`;
  return `Até ${max} ${max === 1 ? one : many}`;
}

function Feature({ ok, text }: { ok: boolean; text: string }) {
  return (
    <li className={cn("flex items-start gap-2", !ok && "text-muted-foreground line-through")}>
      {ok ? (
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-free" />
      ) : (
        <X className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      {text}
    </li>
  );
}

function Usage({ label, used, max }: { label: string; used: number; max: number | null }) {
  const pct = max === null ? 0 : Math.min(100, Math.round((used / Math.max(max, 1)) * 100));
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {used} / {max === null ? "ilimitado" : max}
        </span>
      </div>
      {max !== null && (
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full",
              pct >= 100 ? "bg-busy" : pct >= 80 ? "bg-bill" : "bg-primary",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
