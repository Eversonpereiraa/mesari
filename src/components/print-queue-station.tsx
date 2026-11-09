import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Btn } from "@/components/ui-kit";
import { KitchenPrintStation } from "@/components/kitchen-print-station";
import { BillPrintStation } from "@/components/bill-print-station";
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
      <PrinterIndicator />
      <UnprintedAlert jobs={queue.jobs} />
      {!isDesktop() && <DesktopAppNotice />}
    </>
  );
}

function PrinterIndicator() {
  const queue = usePrintQueue();
  const printer = useSyncExternalStore(subscribePrinterStatus, getPrinterStatus, getPrinterStatus);
  const self = queue.stations.find((station) => station.self);
  const others = queue.stations.filter((station) => !station.self && station.ready);
  const localReady = queue.canPrint && (isDesktop() || printer.connected);
  const connected = localReady || others.length > 0;
  const printingNow = queue.stations.find((station) => station.printing);
  const stationCount = queue.stations.filter((station) => station.ready || station.self).length;
  const printingName = printingNow?.name ?? (stationCount >= 2 ? queue.lastStation : null) ?? null;

  return (
    <div
      role="status"
      className={`sticky top-16 z-20 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b px-4 py-2 text-sm ${connected ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}
    >
      <span className="font-semibold">Impressora: {connected ? "conectada" : "desconectada"}</span>
      {localReady && <span className="text-xs">· este computador ({printer.label})</span>}
      {!localReady && others.length > 0 && (
        <span className="text-xs">· imprimindo em {others[0]!.name}</span>
      )}
      {!connected && (
        <Link to="/impressao" className="text-xs font-semibold underline">
          {queue.canPrint ? (printer.error ?? "Verificar impressora") : "Configurar impressão"}
        </Link>
      )}
      {stationCount >= 2 && (
        <details className="text-xs">
          <summary className="cursor-pointer">
            {stationCount} estações abertas
            {printingName ? ` · imprimindo: ${printingName}` : ""}
          </summary>
          <ul className="mt-1 space-y-0.5">
            {queue.stations
              .filter((station) => station.ready || station.self)
              .map((station) => (
                <li key={`${station.key}-${station.name}`}>
                  {station.name}
                  {station === self ? " (este computador)" : ""}
                  {station.printing
                    ? " · imprimindo agora"
                    : station.ready
                      ? " · pronta"
                      : " · sem impressora"}
                </li>
              ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function UnprintedAlert({ jobs }: { jobs: QueueJob[] }) {
  const [busy, setBusy] = useState(false);
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
    <div role="alert" className="border-b bg-amber-100 px-4 py-2 text-sm text-amber-950">
      <div className="flex flex-wrap items-center justify-center gap-3">
        <strong>
          {unprinted.length}{" "}
          {unprinted.length === 1 ? "comanda não impressa" : "comandas não impressas"}
        </strong>
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
      </div>
      <details className="mx-auto mt-1 max-w-3xl">
        <summary className="cursor-pointer text-center text-xs">Ver lista</summary>
        <ul className="mt-2 space-y-1.5">
          {unprinted.map((job) => (
            <li key={job.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
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
      </details>
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
