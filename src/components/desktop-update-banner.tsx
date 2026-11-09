import { useEffect, useRef, useState } from "react";
import { Btn } from "@/components/ui-kit";
import { MesariLogo } from "@/components/mesari-logo";

/**
 * Atualização do app desktop.
 *  - Versão nova encontrada → cartão "Nova atualização disponível" (canto inferior direito).
 *  - "Atualizar agora" → tela cheia com o progresso animado → "Reiniciando o Mesari…" → reabre.
 *  - "Depois" → baixa em segundo plano; quando terminar, um cartão discreto oferece reiniciar.
 *    Se ninguém reiniciar, a versão nova entra quando o Mesari for fechado.
 * Nunca reinicia sozinho sem o clique do usuário.
 */
export function DesktopUpdateBanner() {
  const updates = typeof window !== "undefined" ? window.mesariDesktop?.updates : undefined;
  if (!updates) return null;
  if (!updates.onState || !updates.state || !updates.download) return <LegacyBanner />;
  return <UpdateFlow />;
}

type Modo = "aviso" | "primeiro-plano" | "segundo-plano" | "oculto";

function UpdateFlow() {
  const [state, setState] = useState<MesariUpdateState>({ fase: "nenhuma" });
  const [modo, setModo] = useState<Modo>("aviso");
  const [verNotas, setVerNotas] = useState(false);
  const [reiniciando, setReiniciando] = useState(false);
  const installTimer = useRef<number | null>(null);

  useEffect(() => {
    const api = window.mesariDesktop?.updates;
    if (!api?.onState || !api.state) return;
    void api.state().then(setState).catch(() => undefined);
    return api.onState((next) => setState(next));
  }, []);

  // Baixou com a tela de progresso aberta → mostra "pronto" e reinicia sozinho em 2 s
  // (o usuário já tinha pedido "Atualizar agora").
  useEffect(() => {
    if (state.fase !== "pronta" || modo !== "primeiro-plano" || reiniciando) return;
    installTimer.current = window.setTimeout(() => {
      setReiniciando(true);
      void window.mesariDesktop?.updates?.install();
    }, 2000);
    return () => {
      if (installTimer.current) window.clearTimeout(installTimer.current);
    };
  }, [state.fase, modo, reiniciando]);

  const baixar = (emPrimeiroPlano: boolean) => {
    setModo(emPrimeiroPlano ? "primeiro-plano" : "segundo-plano");
    void window.mesariDesktop?.updates?.download?.();
  };

  const reiniciarAgora = () => {
    setModo("primeiro-plano");
    setReiniciando(true);
    void window.mesariDesktop?.updates?.install();
  };

  if (state.fase === "nenhuma" || modo === "oculto") return <UpdateStyles />;

  // ----- Tela cheia (o usuário escolheu atualizar agora) -----
  if (modo === "primeiro-plano") {
    return (
      <>
        <UpdateStyles />
        <div className="mesari-upd-backdrop fixed inset-0 z-[100] grid place-items-center bg-[#0b1f20]/70 p-4 backdrop-blur-md">
          <div className="mesari-upd-pop w-[min(92vw,26rem)] rounded-2xl bg-card p-8 text-center text-ink shadow-2xl">
            {state.fase === "erro" ? (
              <>
                <IconBadge tone="erro">!</IconBadge>
                <h2 className="mt-5 font-display text-xl font-bold">Não deu para atualizar</h2>
                <p className="mt-2 text-sm text-muted-foreground">{state.mensagem}</p>
                <div className="mt-6 flex gap-2">
                  <Btn variant="outline" className="flex-1" onClick={() => setModo("oculto")}>
                    Fechar
                  </Btn>
                  <Btn className="flex-1" onClick={() => baixar(true)}>
                    Tentar de novo
                  </Btn>
                </div>
              </>
            ) : state.fase === "pronta" ? (
              <>
                <div className="relative mx-auto grid size-28 place-items-center">
                  <span className="mesari-upd-ring absolute inset-0 rounded-full bg-success/20" />
                  <svg viewBox="0 0 52 52" className="relative size-24">
                    <circle cx="26" cy="26" r="24" fill="var(--success)" className="mesari-upd-scale" />
                    <path
                      d="M15 27l7 7 15-16"
                      fill="none"
                      stroke="#fff"
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="mesari-upd-check"
                    />
                  </svg>
                </div>
                <h2 className="mt-5 font-display text-xl font-bold">
                  {reiniciando ? "Reiniciando o Mesari…" : "Atualização concluída!"}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {reiniciando
                    ? "Em alguns segundos ele abre de novo, já na versão nova."
                    : `Versão ${state.versao} pronta para usar.`}
                </p>
                <Dots className="mt-5" />
              </>
            ) : (
              <>
                <ProgressRing pct={state.fase === "baixando" ? state.pct : 0} />
                <h2 className="mt-5 font-display text-xl font-bold">Atualizando o Mesari</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Baixando a versão {state.versao}. Não desligue o computador.
                </p>
                <div className="mt-5 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="mesari-upd-shimmer h-full rounded-full transition-[width] duration-500 ease-out"
                    style={{ width: `${Math.max(4, state.fase === "baixando" ? state.pct : 0)}%` }}
                  />
                </div>
                <p className="mt-2 text-xs tabular-nums text-muted-foreground">
                  {state.fase === "baixando" && state.total > 0
                    ? `${mb(state.baixado)} de ${mb(state.total)} · ${mb(state.velocidade)}/s`
                    : "Preparando o download…"}
                </p>
              </>
            )}
          </div>
        </div>
      </>
    );
  }

  // ----- Baixando em segundo plano: nada na tela até ficar pronto -----
  if (modo === "segundo-plano" && state.fase !== "pronta") return <UpdateStyles />;

  // ----- Cartão no canto -----
  const pronta = state.fase === "pronta";
  if (state.fase === "erro") return <UpdateStyles />;
  return (
    <>
      <UpdateStyles />
      <div
        role="status"
        className="mesari-upd-slide fixed bottom-4 right-4 z-50 w-[min(92vw,23rem)] overflow-hidden rounded-2xl border bg-card text-ink shadow-2xl"
      >
        <div className="flex gap-3 p-4">
          <div className="relative size-11 shrink-0">
            <span className="mesari-upd-ring absolute inset-0 rounded-xl bg-primary/25" />
            <MesariLogo variant="symbol" className="relative size-11 rounded-xl" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display font-bold">
              {pronta ? "Atualização pronta" : "Nova atualização disponível"}
            </p>
            <p className="text-xs text-muted-foreground">
              Versão {state.versao}
              {state.fase === "disponivel" && state.tamanho > 0 ? ` · ${mb(state.tamanho)}` : ""}
              {pronta ? " · reinicie quando puder" : ""}
            </p>
          </div>
          <button
            type="button"
            aria-label="Fechar"
            onClick={() => setModo("oculto")}
            className="-mr-1 -mt-1 grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted"
          >
            ×
          </button>
        </div>

        {state.notas && (
          <div className="px-4 pb-1">
            <button
              type="button"
              onClick={() => setVerNotas((v) => !v)}
              className="text-xs font-semibold text-primary hover:underline"
            >
              {verNotas ? "Esconder novidades" : "Ver o que mudou"}
            </button>
            {verNotas && (
              <div className="mt-2 max-h-36 overflow-auto whitespace-pre-line rounded-lg bg-muted p-3 text-xs leading-relaxed">
                {state.notas}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 p-4 pt-3">
          {pronta ? (
            <>
              <Btn size="sm" variant="outline" className="flex-1" onClick={() => setModo("oculto")}>
                Ao fechar o app
              </Btn>
              <Btn size="sm" className="flex-1" onClick={reiniciarAgora}>
                Reiniciar agora
              </Btn>
            </>
          ) : (
            <>
              <Btn size="sm" variant="outline" className="flex-1" onClick={() => baixar(false)}>
                Depois
              </Btn>
              <Btn size="sm" className="flex-1" onClick={() => baixar(true)}>
                Atualizar agora
              </Btn>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function ProgressRing({ pct }: { pct: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative mx-auto grid size-32 place-items-center">
      <svg viewBox="0 0 120 120" className="absolute inset-0 -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--muted)" strokeWidth="8" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          style={{ transition: "stroke-dashoffset .5s ease-out" }}
        />
      </svg>
      <span className="mesari-upd-orbit absolute inset-0" aria-hidden="true">
        <span className="absolute left-1/2 top-0 size-2.5 -translate-x-1/2 rounded-full bg-primary shadow-[0_0_12px_var(--primary)]" />
      </span>
      <div className="mesari-upd-breathe grid place-items-center">
        <MesariLogo variant="symbol" className="size-14 rounded-2xl" />
        <span className="mt-1 font-display text-sm font-bold tabular-nums">{pct}%</span>
      </div>
    </div>
  );
}

function IconBadge({ children, tone }: { children: string; tone: "erro" }) {
  return (
    <div
      className={`mesari-upd-scale mx-auto grid size-20 place-items-center rounded-full text-3xl font-bold text-white ${
        tone === "erro" ? "bg-destructive" : "bg-primary"
      }`}
    >
      {children}
    </div>
  );
}

function Dots({ className = "" }: { className?: string }) {
  return (
    <div className={`flex justify-center gap-1.5 ${className}`} aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="mesari-upd-dot size-2 rounded-full bg-primary"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}

const mb = (bytes: number) =>
  `${(bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} MB`;

function UpdateStyles() {
  return (
    <style>{`
      @keyframes mesari-upd-slide { from { opacity: 0; transform: translateY(24px) scale(.97) } to { opacity: 1; transform: none } }
      @keyframes mesari-upd-pop { 0% { opacity: 0; transform: scale(.9) } 60% { transform: scale(1.02) } 100% { opacity: 1; transform: none } }
      @keyframes mesari-upd-fade { from { opacity: 0 } to { opacity: 1 } }
      @keyframes mesari-upd-ring { 0% { transform: scale(1); opacity: .9 } 100% { transform: scale(1.6); opacity: 0 } }
      @keyframes mesari-upd-orbit { to { transform: rotate(360deg) } }
      @keyframes mesari-upd-breathe { 0%,100% { transform: scale(1) } 50% { transform: scale(1.05) } }
      @keyframes mesari-upd-shimmer { from { background-position: 200% 0 } to { background-position: -200% 0 } }
      @keyframes mesari-upd-check { from { stroke-dashoffset: 40 } to { stroke-dashoffset: 0 } }
      @keyframes mesari-upd-dot { 0%,80%,100% { transform: scale(.6); opacity: .4 } 40% { transform: scale(1); opacity: 1 } }
      .mesari-upd-slide { animation: mesari-upd-slide .45s cubic-bezier(.2,.9,.3,1.2) both }
      .mesari-upd-pop { animation: mesari-upd-pop .5s cubic-bezier(.2,.9,.3,1) both }
      .mesari-upd-backdrop { animation: mesari-upd-fade .3s ease both }
      .mesari-upd-scale { animation: mesari-upd-pop .45s cubic-bezier(.2,.9,.3,1.3) both; transform-origin: center }
      .mesari-upd-ring { animation: mesari-upd-ring 1.8s ease-out infinite }
      .mesari-upd-orbit { animation: mesari-upd-orbit 2.4s linear infinite }
      .mesari-upd-breathe { animation: mesari-upd-breathe 2s ease-in-out infinite }
      .mesari-upd-shimmer { background: linear-gradient(90deg, var(--primary) 0%, #34d3c3 50%, var(--primary) 100%); background-size: 200% 100%; animation: mesari-upd-shimmer 1.6s linear infinite }
      .mesari-upd-check { stroke-dasharray: 40; animation: mesari-upd-check .5s .25s ease-out both }
      .mesari-upd-dot { animation: mesari-upd-dot 1.2s ease-in-out infinite }
      @media (prefers-reduced-motion: reduce) {
        .mesari-upd-slide, .mesari-upd-pop, .mesari-upd-backdrop, .mesari-upd-scale, .mesari-upd-ring,
        .mesari-upd-orbit, .mesari-upd-breathe, .mesari-upd-shimmer, .mesari-upd-check, .mesari-upd-dot { animation: none }
      }
    `}</style>
  );
}

/** App desktop 1.1.x (sem progresso): o aviso antigo, depois que a versão já foi baixada. */
function LegacyBanner() {
  const [version, setVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    const api = window.mesariDesktop?.updates;
    if (!api) return;
    void api
      .status()
      .then((status) => setVersion(status.versao))
      .catch(() => undefined);
    return api.onReady((info) => {
      setVersion(info.versao);
      setDismissed(false);
    });
  }, []);

  if (!version || dismissed) return null;
  return (
    <>
      <UpdateStyles />
      <div
        role="status"
        className="fixed bottom-4 left-1/2 z-50 flex w-[min(92vw,30rem)] -translate-x-1/2 flex-wrap items-center gap-3 rounded-lg border bg-card p-3 text-sm text-ink shadow-xl"
      >
        <span className="min-w-0 flex-1">Nova versão disponível ({version}). Reiniciar agora?</span>
        <Btn size="sm" variant="outline" onClick={() => setDismissed(true)}>
          Depois
        </Btn>
        <Btn
          size="sm"
          disabled={restarting}
          onClick={() => {
            setRestarting(true);
            void window.mesariDesktop?.updates?.install().finally(() => setRestarting(false));
          }}
        >
          {restarting ? "Reiniciando..." : "Reiniciar agora"}
        </Btn>
      </div>
    </>
  );
}
