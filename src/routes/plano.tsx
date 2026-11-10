import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, Check, Copy, Crown, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { actions, mapPlan, useStore, type PlanInfo, type PlanLimits } from "@/lib/store";
import { AppShell, Btn } from "@/components/ui-kit";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

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

/**
 * Data da próxima cobrança. Para assinaturas pagas no Asaas, o acesso fica liberado 3 dias
 * além do vencimento (folga para o pagamento compensar), então a renovação é 3 dias antes.
 */
const GRACE_MS = 3 * 86_400_000;
const renewalDate = (info: { periodEnd: number | null; onlinePayment: boolean }) =>
  info.periodEnd !== null && info.onlinePayment ? info.periodEnd - GRACE_MS : info.periodEnd;

type Ciclo = "mensal" | "anual";
type Previa = {
  acao: "checkout" | "upgrade" | "agendar" | "manter";
  url?: string;
  resumo?: string;
  valor?: number;
};
type Resultado = {
  acao: "pagar" | "liberado" | "agendado" | "mantido";
  url?: string;
  valor?: number;
};
type Falha = { erro: string; excedentes?: string[] };

/** Chama a Edge Function "trocar-plano" e devolve o corpo mesmo quando ela responde com erro. */
async function trocarPlano<T>(body: {
  plano: string;
  ciclo: Ciclo;
  confirmar: boolean;
}): Promise<T | Falha> {
  const { data, error } = await supabase.functions.invoke("trocar-plano", { body });
  if (!error) return data as T;
  const context = (error as { context?: Response }).context;
  const parsed = context ? await context.json().catch(() => null) : null;
  return (parsed as Falha | null) ?? { erro: error.message || "Sem conexão. Tente de novo." };
}
const isFalha = (value: unknown): value is Falha =>
  typeof value === "object" && value !== null && "erro" in value;

/** Chama a Edge Function "renovar" (Mercado Pago) e devolve o link de pagamento. */
async function pedirRenovacao(): Promise<
  { acao: "pagar" | "checkout"; url: string; valor?: number } | Falha
> {
  const { data, error } = await supabase.functions.invoke("renovar", { body: { confirmar: true } });
  if (!error) return data as { acao: "pagar" | "checkout"; url: string; valor?: number };
  const context = (error as { context?: Response }).context;
  const parsed = context ? await context.json().catch(() => null) : null;
  return (parsed as Falha | null) ?? { erro: error.message || "Sem conexão. Tente de novo." };
}

function abrirFora(url: string) {
  // No app desktop, links com target _blank abrem no navegador padrão.
  window.open(url, "_blank", "noopener,noreferrer");
}

function Plano() {
  const info = useStore((s) => s.plan);
  const role = useStore((s) => s.user?.role);
  const [plans, setPlans] = useState<PlanLimits[]>([]);
  const [cycle, setCycle] = useState<"mensal" | "anual">("mensal");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: "confirmar"; plano: PlanLimits; ciclo: Ciclo; previa: Previa }
    | { kind: "falha"; falha: Falha }
    | { kind: "aguardando"; plano: PlanLimits; url: string; valor: number }
    | null
  >(null);
  const waitTimer = useRef<number | null>(null);
  const [renewing, setRenewing] = useState<"idle" | "busy" | "aberto">("idle");

  const pagarRenovacao = async () => {
    setError("");
    setRenewing("busy");
    const res = await pedirRenovacao();
    if (isFalha(res)) {
      setRenewing("idle");
      setError(res.erro);
      return;
    }
    abrirFora(res.url);
    setRenewing("aberto");
  };

  const stopWaiting = useCallback(() => {
    if (waitTimer.current !== null) window.clearInterval(waitTimer.current);
    waitTimer.current = null;
  }, []);

  // Quando o cliente volta do navegador (pagou a diferença), atualiza o plano.
  useEffect(() => {
    const onFocus = () => void actions.refreshPlan().catch(() => {});
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      stopWaiting();
    };
  }, [stopWaiting]);

  const waitForPlan = (planId: string) => {
    stopWaiting();
    const started = Date.now();
    waitTimer.current = window.setInterval(() => {
      if (Date.now() - started > 15 * 60_000) return stopWaiting();
      void actions
        .refreshPlan()
        .then((now) => {
          if (now.plan.id === planId) {
            stopWaiting();
            setDialog(null);
            toast.success(`Pronto! Seu plano agora é o ${now.plan.name}.`);
          }
        })
        .catch(() => {});
    }, 5000);
  };

  const pedirTroca = async (plano: PlanLimits) => {
    setBusy(plano.id);
    const previa = await trocarPlano<Previa>({ plano: plano.id, ciclo: cycle, confirmar: false });
    setBusy(null);
    if (isFalha(previa)) return setDialog({ kind: "falha", falha: previa });
    if (previa.acao === "checkout" && previa.url) return abrirFora(previa.url);
    setDialog({ kind: "confirmar", plano, ciclo: cycle, previa });
  };

  const confirmarTroca = async () => {
    if (dialog?.kind !== "confirmar") return;
    const { plano, ciclo } = dialog;
    setBusy("confirmar");
    const res = await trocarPlano<Resultado>({ plano: plano.id, ciclo, confirmar: true });
    setBusy(null);
    if (isFalha(res)) return setDialog({ kind: "falha", falha: res });
    await actions.refreshPlan().catch(() => {});
    if (res.acao === "pagar" && res.url) {
      abrirFora(res.url);
      setDialog({ kind: "aguardando", plano, url: res.url, valor: res.valor ?? 0 });
      waitForPlan(plano.id);
      return;
    }
    setDialog(null);
    if (res.acao === "liberado") toast.success(`Pronto! Seu plano agora é o ${plano.name}.`);
    else if (res.acao === "agendado") toast.success("Troca agendada para a próxima renovação.");
    else toast.success("Troca agendada cancelada. Você continua no plano atual.");
  };

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
                  : info.gateway === "mercadopago"
                    ? info.active
                      ? "Vence em "
                      : "Venceu em "
                    : info.autoRenew
                      ? "Renova em "
                      : "Válido até "}
                <strong className="text-ink">
                  {date(
                    (info.autoRenew || info.gateway === "mercadopago") && info.status !== "teste"
                      ? renewalDate({ ...info, onlinePayment: true })
                      : info.periodEnd,
                  )}
                </strong>
                {info.cycle && info.status !== "teste" ? ` · cobrança ${info.cycle}` : ""}
              </p>
              {(info.nextPlan || info.nextCycle) && (
                <p className="mt-3 flex items-start gap-2 rounded-lg bg-accent px-3 py-2 text-sm">
                  <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>
                    Na renovação de <strong>{date(renewalDate(info))}</strong> passa para o{" "}
                    <strong>
                      {(info.nextPlan ?? info.plan).name} {info.nextCycle ?? info.cycle}
                    </strong>
                    .
                  </span>
                </p>
              )}
              {info.gateway === "mercadopago" &&
                info.owner &&
                info.status !== "teste" &&
                (() => {
                  const vence = renewalDate({ ...info, onlinePayment: true });
                  const dias = vence === null ? 0 : Math.ceil((vence - Date.now()) / 86_400_000);
                  const urgente = !info.active || dias <= 7;
                  return (
                    <div
                      className={cn(
                        "mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm",
                        urgente ? "bg-busy-bg text-busy" : "bg-accent",
                      )}
                    >
                      <span>
                        {!info.active
                          ? "Sua assinatura venceu. Pague a renovação para voltar a usar tudo."
                          : dias <= 0
                            ? "A renovação vence hoje. Você ainda tem 3 dias de folga para pagar."
                            : dias <= 7
                              ? `A renovação vence em ${dias} ${dias === 1 ? "dia" : "dias"}. Pague com Pix, boleto ou cartão.`
                              : "Pode pagar a renovação antes do vencimento, sem perder nenhum dia."}
                        {renewing === "aberto" &&
                          " Abrimos o pagamento no navegador; quando cair, o plano atualiza sozinho."}
                      </span>
                      <Btn
                        type="button"
                        size="sm"
                        variant={urgente ? "primary" : "outline"}
                        disabled={renewing === "busy"}
                        onClick={() => void pagarRenovacao()}
                      >
                        {renewing === "busy"
                          ? "Gerando pagamento..."
                          : renewing === "aberto"
                            ? "Abrir pagamento de novo"
                            : "Pagar renovação"}
                      </Btn>
                    </div>
                  );
                })()}
              {info.pendingUpgrade && (
                <p className="mt-3 rounded-lg bg-busy-bg px-3 py-2 text-sm text-busy">
                  Aguardando o pagamento de {money(info.pendingUpgrade.amount)} para liberar o plano
                  novo. Assim que cair, ele é liberado sozinho.
                </p>
              )}
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
              const scheduledAway = Boolean(info?.nextPlan || info?.nextCycle);
              const scheduledHere =
                scheduledAway &&
                (info?.nextPlan?.id ?? info?.plan.id) === plan.id &&
                (info?.nextCycle ?? info?.cycle) === cycle;
              const order = (id: string) => plans.findIndex((p) => p.id === id);
              const buttonLabel = !info?.onlinePayment
                ? "Assinar este plano"
                : current && scheduledAway && cycle === info?.cycle
                  ? "Manter este plano"
                  : current
                    ? `Mudar para ${cycle}`
                    : order(plan.id) > order(info?.plan.id ?? "")
                      ? "Subir para este plano"
                      : "Mudar para este plano";
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
                    (!info?.owner ? (
                      <Btn variant="outline" disabled className="w-full">
                        {current ? "Plano atual" : "Só o dono da conta troca o plano"}
                      </Btn>
                    ) : current && !scheduledAway && cycle === info?.cycle ? (
                      <Btn variant="outline" disabled className="w-full">
                        Plano atual
                      </Btn>
                    ) : scheduledHere ? (
                      <Btn variant="outline" disabled className="w-full">
                        Agendado para {date(info ? renewalDate(info) : null)}
                      </Btn>
                    ) : (
                      <Btn
                        variant={featured ? "primary" : "outline"}
                        className="h-10 w-full"
                        disabled={busy !== null}
                        onClick={() => void pedirTroca(plan)}
                      >
                        {busy === plan.id && <Loader2 className="h-4 w-4 animate-spin" />}
                        {buttonLabel}
                      </Btn>
                    ))}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => !open && (stopWaiting(), setDialog(null))}
      >
        <DialogContent>
          {dialog?.kind === "confirmar" && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {dialog.previa.acao === "upgrade"
                    ? `Subir para o ${dialog.plano.name}`
                    : dialog.previa.acao === "manter"
                      ? "Manter o plano atual"
                      : `Mudar para o ${dialog.plano.name} ${dialog.ciclo}`}
                </DialogTitle>
                <DialogDescription className="text-base leading-relaxed">
                  {dialog.previa.resumo}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Btn variant="outline" onClick={() => setDialog(null)} disabled={busy !== null}>
                  Voltar
                </Btn>
                <Btn onClick={() => void confirmarTroca()} disabled={busy !== null}>
                  {busy === "confirmar" && <Loader2 className="h-4 w-4 animate-spin" />}
                  {dialog.previa.acao === "upgrade" && (dialog.previa.valor ?? 0) > 0
                    ? `Pagar ${money(dialog.previa.valor ?? 0)}`
                    : "Confirmar"}
                </Btn>
              </DialogFooter>
            </>
          )}
          {dialog?.kind === "aguardando" && (
            <>
              <DialogHeader>
                <DialogTitle>Aguardando o pagamento</DialogTitle>
                <DialogDescription className="text-base leading-relaxed">
                  Abrimos a cobrança de {money(dialog.valor)} no seu navegador. Pague com Pix,
                  boleto ou cartão. Assim que o pagamento cair, o {dialog.plano.name} é liberado
                  aqui sozinho, sem precisar reiniciar.
                </DialogDescription>
              </DialogHeader>
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Conferindo o pagamento…
              </p>
              <DialogFooter>
                <Btn variant="outline" onClick={() => abrirFora(dialog.url)}>
                  Abrir a cobrança de novo
                </Btn>
                <Btn onClick={() => (stopWaiting(), setDialog(null))}>Fechar</Btn>
              </DialogFooter>
            </>
          )}
          {dialog?.kind === "falha" && (
            <>
              <DialogHeader>
                <DialogTitle>Não deu para trocar agora</DialogTitle>
                <DialogDescription className="text-base leading-relaxed">
                  {dialog.falha.erro}
                </DialogDescription>
              </DialogHeader>
              {dialog.falha.excedentes && dialog.falha.excedentes.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {dialog.falha.excedentes.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
              <DialogFooter>
                <Btn onClick={() => setDialog(null)}>Entendi</Btn>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
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
