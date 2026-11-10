import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Btn } from "@/components/ui-kit";
import { KitchenPrintStation } from "@/components/kitchen-print-station";
import { BillPrintStation } from "@/components/bill-print-station";
import { PrinterSetupWizard } from "@/components/printer-setup-wizard";
import { errorMessage, useStore } from "@/lib/store";
import { getPrinterStatus, subscribePrinterStatus } from "@/lib/printing";
import {
  printPending,
  reprintJobs,
  setQueueRestaurant,
  startPrintQueue,
  stopPrintQueue,
  unprintedJobs,
  usePrintQueue,
  type QueueJob,
} from "@/lib/print-queue";

/** Instalador do app desktop (Releases do GitHub, gerado pelo workflow do desktop). */
export const DESKTOP_DOWNLOAD_URL = "https://github.com/Eversonpereiraa/mesari/releases/latest";

const isDesktop = () => typeof window !== "undefined" && Boolean(window.mesariDesktop);

/**
 * Fica no layout raiz: a estação de impressão continua rodando ao trocar de tela (e, no app
 * desktop, com a janela minimizada ou na bandeja).
 */
export function PrintQueueBootstrap() {
  const user = useStore((s) => s.user);
  const restaurant = useStore((s) => s.restaurant);
  const queue = usePrintQueue();
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);

  useEffect(() => setQueueRestaurant(restaurant), [restaurant]);

  useEffect(() => {
    if (user?.role !== "caixa") {
      stopPrintQueue();
      return;
    }
    startPrintQueue({ id: user.id, name: user.name });
  }, [user?.id, user?.name, user?.role]);

  useEffect(() => () => stopPrintQueue(), []);

  // Navegador imprimindo direto: mantém a tela ativa e avisa antes de fechar a aba.
  const browserStation = queue.available === true && queue.canPrint && !isDesktop();
  useEffect(() => {
    if (!browserStation) return;
    type WakeLockApi = { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
    const request = async () => {
      const api = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
      if (document.visibilityState !== "visible" || !api || wakeLock.current) return;
      wakeLock.current = await api.request("screen").catch(() => null);
    };
    const release = () => {
      const lock = wakeLock.current;
      wakeLock.current = null;
      void lock?.release().catch(() => undefined);
    };
    const visibilityChanged = () =>
      document.visibilityState === "visible" ? void request() : release();
    const warnBeforeExit = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "As comandas deixarão de imprimir";
    };
    void request();
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("beforeunload", warnBeforeExit);
    return () => {
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("beforeunload", warnBeforeExit);
      release();
    };
  }, [browserStation]);

  return null;
}

/** Barras do caixa: impressora, comandas não impressas e o aviso do app para Windows. */
export function PrintQueueBars() {
  const queue = usePrintQueue();
  const role = useStore((s) => s.user?.role);
  if (role !== "caixa") return null;
  // Banco sem a migration da fila: continua com a estação antiga (marcar_impresso).
  if (queue.available === false) {
    return (
      <>
        <KitchenPrintStation />
        <BillPrintStation />
      </>
    );
  }
  if (queue.available === null) return null;
  return (
    <>
      {/* Fixos no canto: aparecem sem empurrar a tela (nada muda de lugar sob o dedo). */}
      <div className="pointer-events-none fixed bottom-24 right-4 z-40 flex w-[min(24rem,calc(100vw-2rem))] flex-col items-stretch gap-2">
        <PrinterIndicator />
        <UnprintedAlert jobs={queue.jobs} />
      </div>
      {isDesktop() ? <PrinterSetupWizard /> : <DesktopAppNotice />}
    </>
  );
}

/** Falhas recentes de impressão (última 1 h) que ainda não foram resolvidas. */
const RECENT_FAILURE_MS = 60 * 60 * 1000;

/**
 * Só aparece quando há algo a resolver: nenhuma estação consegue imprimir, ou as últimas
 * comandas falharam. Com tudo funcionando, a tela do caixa fica limpa.
 */
function PrinterIndicator() {
  const queue = usePrintQueue();
  const printer = useSyncExternalStore(subscribePrinterStatus, getPrinterStatus, getPrinterStatus);
  const others = queue.stations.filter((station) => !station.self && station.ready);
  // Status real: no app desktop, impressora instalada/respondendo e sem falha recente.
  const localReady = queue.canPrint && printer.connected;
  const connected = localReady || others.length > 0;
  const now = Date.now();
  const failing = queue.jobs.filter(
    (job) =>
      job.status !== "impresso" &&
      job.attempts > 0 &&
      Boolean(job.error) &&
      now - job.createdAt < RECENT_FAILURE_MS,
  );
  const lastError = printer.error ?? failing[0]?.error;

  if (connected && failing.length === 0) return null;

  return (
    <div
      role="status"
      className="pointer-events-auto rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-lg"
    >
      <div className="font-semibold">
        {connected ? "A impressora não está imprimindo" : "Impressora desconectada"}
      </div>
      {lastError && <div className="mt-0.5 text-xs">{lastError}</div>}
      <Link to="/impressao" className="mt-1 inline-block text-xs font-semibold underline">
        {queue.canPrint || isDesktop() ? "Verificar impressora" : "Configurar impressão"}
      </Link>
    </div>
  );
}

function UnprintedAlert({ jobs }: { jobs: QueueJob[] }) {
  const [busy, setBusy] = useState(false);
  const [showList, setShowList] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const unprinted = unprintedJobs(jobs, now);
  if (!unprinted.length) return null;
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      role="alert"
      className="pointer-events-auto rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 shadow-lg"
    >
      <strong className="block">
        {unprinted.length}{" "}
        {unprinted.length === 1 ? "comanda não impressa" : "comandas não impressas"}
      </strong>
      <div className="mt-2 flex flex-wrap gap-2">
        <Btn
          size="sm"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const count = await printPending();
              toast.success(
                count === 1
                  ? "1 comanda enviada para impressão."
                  : `${count} comandas enviadas para impressão.`,
              );
            })
          }
        >
          Imprimir pendentes
        </Btn>
        <Btn
          size="sm"
          variant="outline"
          aria-expanded={showList}
          onClick={() => setShowList((value) => !value)}
        >
          {showList ? "Esconder lista" : "Ver lista"}
        </Btn>
      </div>
      {showList && (
        <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto border-t border-amber-200 pt-2 text-xs">
          {unprinted.map((job) => (
            <li key={job.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0">
                {job.label} ·{" "}
                {new Date(job.createdAt).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {job.status === "falhou"
                  ? ` · falhou ${job.attempts}x${job.error ? `: ${job.error}` : ""}`
                  : " · mais de 3 h (não imprime sozinha)"}
              </span>
              <Btn
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void run(() => reprintJobs([job.id]))}
              >
                Imprimir
              </Btn>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DesktopAppNotice() {
  return (
    <div className="fixed bottom-3 left-3 z-40 max-w-[calc(100vw-1.5rem)] rounded-md border bg-card/95 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur">
      Para imprimir automaticamente, use o app Mesari para Windows.{" "}
      <a
        href={DESKTOP_DOWNLOAD_URL}
        target="_blank"
        rel="noreferrer"
        className="font-semibold text-primary underline"
      >
        Baixar
      </a>
    </div>
  );
}
