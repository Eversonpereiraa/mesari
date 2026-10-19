import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import {
  getPrinterStatus,
  getPrintSettings,
  initializePrinter,
  printKitchenTicket,
  subscribePrinterStatus,
  type KitchenTicket,
} from "@/lib/printing";
import { errorMessage, useStore } from "@/lib/store";
import { mapStationTicket as mapTicket, type StationTicket } from "@/lib/kitchen-ticket-row";
import { trackKitchenStation, untrackKitchenStation } from "@/lib/kitchen-presence";
import { Btn } from "@/components/ui-kit";

type TicketRow = StationTicket;
const FAILED_KEY = "mesari-unprinted-kitchen-orders";
const THREE_HOURS = 3 * 60 * 60 * 1000;

function readFailed(): TicketRow[] {
  const stored = localStorage.getItem(FAILED_KEY);
  if (!stored) return [];
  const value: unknown = JSON.parse(stored);
  if (!Array.isArray(value)) throw new Error("A lista local de comandas pendentes está inválida.");
  return value as TicketRow[];
}

function writeFailed(tickets: TicketRow[]) {
  localStorage.setItem(FAILED_KEY, JSON.stringify(tickets));
}

function ticketLocation(ticket: TicketRow) {
  if (ticket.external) {
    return `${ticket.external.origin === "entrega" ? "Entrega" : "Retirada"} · ${ticket.external.customerName}`;
  }
  return ticket.table === null ? "Mesa —" : `Mesa ${String(ticket.table).padStart(2, "0")}`;
}

async function playNotice() {
  const Constructor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Constructor) return;
  const audio = new Constructor();
  if (audio.state === "suspended") await audio.resume();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.frequency.value = 880;
  gain.gain.value = 0.08;
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.start();
  oscillator.stop(audio.currentTime + 0.12);
  await new Promise<void>((resolve) => window.setTimeout(resolve, 160));
  await audio.close();
}

export function KitchenPrintStation() {
  const user = useStore((state) => state.user);
  const settings = getPrintSettings();
  const printer = useSyncExternalStore(subscribePrinterStatus, getPrinterStatus, getPrinterStatus);
  const [failed, setFailed] = useState<TicketRow[]>([]);
  const [recent, setRecent] = useState<TicketRow[]>([]);
  const [warning, setWarning] = useState<TicketRow | null>(null);
  const active = useRef(true);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  const busy = useRef(new Set<string>());
  const recovering = useRef(false);
  const channel = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const reloadFailed = useCallback(() => {
    try {
      const pending = readFailed();
      setFailed(pending);
      return pending;
    } catch (cause) {
      toast.error(errorMessage(cause));
      return [];
    }
  }, []);

  const printReserved = useCallback(async (ticket: TicketRow) => {
    if (busy.current.has(ticket.id)) return;
    busy.current.add(ticket.id);
    try {
      await printKitchenTicket(ticket, getPrintSettings(), false);
      setFailed((current) => {
        const next = current.filter((item) => item.id !== ticket.id);
        writeFailed(next);
        return next;
      });
      setWarning(null);
      setRecent((current) =>
        [ticket, ...current.filter((item) => item.id !== ticket.id)].slice(0, 30),
      );
      void playNotice().catch((cause: unknown) =>
        toast.error(`Comanda impressa, mas o aviso sonoro falhou: ${errorMessage(cause)}`),
      );
    } catch (cause) {
      setFailed((current) => {
        const next = [ticket, ...current.filter((item) => item.id !== ticket.id)];
        writeFailed(next);
        return next;
      });
      setWarning(ticket);
      toast.error(`Comanda #${ticket.number} não imprimiu: ${errorMessage(cause)}`);
    } finally {
      busy.current.delete(ticket.id);
    }
  }, []);

  const reserveAndPrint = useCallback(async (ticket: TicketRow) => {
    if (busy.current.has(ticket.id)) return;
    busy.current.add(ticket.id);
    try {
      const { data, error } = await supabase.rpc("marcar_impresso", { p_id: ticket.id });
      if (error) throw error;
      if (data !== true) return;
      try {
        await printKitchenTicket(ticket, getPrintSettings(), false);
        setRecent((current) =>
          [ticket, ...current.filter((item) => item.id !== ticket.id)].slice(0, 30),
        );
        void playNotice().catch((cause: unknown) =>
          toast.error(`Comanda impressa, mas o aviso sonoro falhou: ${errorMessage(cause)}`),
        );
      } catch (cause) {
        setFailed((current) => {
          const next = [ticket, ...current.filter((item) => item.id !== ticket.id)];
          writeFailed(next);
          return next;
        });
        setWarning(ticket);
        toast.error(`Comanda #${ticket.number} não imprimiu: ${errorMessage(cause)}`);
      }
    } finally {
      busy.current.delete(ticket.id);
    }
  }, []);

  const recoverPending = useCallback(async () => {
    if (
      recovering.current ||
      !active.current ||
      user?.role !== "caixa" ||
      !getPrintSettings().printKitchenEnabled
    ) {
      return;
    }
    recovering.current = true;
    try {
      const cutoff = new Date(Date.now() - THREE_HOURS).toISOString();
      const ticketsData: unknown[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("pedidos_cozinha")
          .select(
            "id,numero,mesa_numero,setor,garcom_nome,adicional,itens,criado_em,impresso_em,origem,dados",
          )
          .is("impresso_em", null)
          .gte("criado_em", cutoff)
          .order("criado_em", { ascending: true })
          .range(from, from + 499);
        if (error) throw error;
        ticketsData.push(...(data ?? []));
        if (!data || data.length < 500) break;
        from += 500;
      }
      const tickets = ticketsData.map(mapTicket);
      setRecent((current) => {
        const next = [...current];
        for (const ticket of tickets) {
          if (!next.some((item) => item.id === ticket.id)) next.push(ticket);
        }
        return next.sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
      });
      for (const ticket of tickets) {
        if (!active.current) break;
        await reserveAndPrint(ticket);
      }
    } catch (cause) {
      if (active.current)
        toast.error(`Não foi possível verificar comandas pendentes: ${errorMessage(cause)}`);
    } finally {
      recovering.current = false;
    }
  }, [reserveAndPrint, user?.role]);

  useEffect(() => {
    active.current = true;
    reloadFailed();
    void initializePrinter().catch((cause: unknown) =>
      toast.error(`Falha ao conectar a impressora: ${errorMessage(cause)}`),
    );
    return () => {
      active.current = false;
      if (channel.current) void supabase.removeChannel(channel.current);
      channel.current = null;
    };
  }, [reloadFailed]);

  useEffect(() => {
    if (user?.role !== "caixa" || !settings.printKitchenEnabled) return;
    const realtime = supabase
      .channel("caixa-comandas-impressao")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "pedidos_cozinha" },
        (payload) => {
          try {
            const ticket = mapTicket(payload.new);
            setRecent((current) =>
              [ticket, ...current.filter((item) => item.id !== ticket.id)].slice(0, 30),
            );
            void reserveAndPrint(ticket);
          } catch (cause) {
            toast.error(`Comanda recebida em formato inválido: ${errorMessage(cause)}`);
          }
        },
      )
      .subscribe((status, cause) => {
        if (status === "SUBSCRIBED") void recoverPending();
        if (cause) toast.error(`Falha no Realtime das comandas: ${errorMessage(cause)}`);
      });
    channel.current = realtime;
    void recoverPending();
    const interval = window.setInterval(() => void recoverPending(), 30000);
    const refresh = () => void recoverPending();
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      if (channel.current === realtime) channel.current = null;
      void supabase.removeChannel(realtime);
    };
  }, [recoverPending, reserveAndPrint, settings.printKitchenEnabled, user?.role]);

  useEffect(() => {
    if (user?.role !== "caixa" || !settings.printKitchenEnabled) return;
    type WakeLockApi = { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
    const request = async () => {
      const api = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
      if (document.visibilityState !== "visible" || !api || wakeLock.current) return;
      try {
        wakeLock.current = await api.request("screen");
      } catch (cause) {
        toast.error(`Não foi possível manter a tela ativa: ${errorMessage(cause)}`);
      }
    };
    const visibilityChanged = () => {
      if (document.visibilityState === "visible") void request();
      else if (wakeLock.current) {
        const lock = wakeLock.current;
        wakeLock.current = null;
        void lock.release().catch((cause: unknown) => toast.error(errorMessage(cause)));
      }
    };
    void request();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      document.removeEventListener("visibilitychange", visibilityChanged);
      if (wakeLock.current) {
        const lock = wakeLock.current;
        wakeLock.current = null;
        void lock.release().catch((cause: unknown) => toast.error(errorMessage(cause)));
      }
    };
  }, [settings.printKitchenEnabled, user?.role]);

  useEffect(() => {
    if (user?.role !== "caixa") return;
    void trackKitchenStation({
      tipo: "estacao-impressao",
      pronta: printer.connected,
      usuario: user.username,
    }).catch((cause: unknown) =>
      toast.error(`Não foi possível publicar o estado da impressora: ${errorMessage(cause)}`),
    );
  }, [printer.connected, user?.role, user?.username]);

  useEffect(() => {
    if (user?.role !== "caixa") return;
    return () => untrackKitchenStation();
  }, [user?.role]);

  useEffect(() => {
    if (user?.role !== "caixa" || !settings.printKitchenEnabled) return;
    const warnBeforeExit = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "As comandas deixarão de imprimir";
    };
    window.addEventListener("beforeunload", warnBeforeExit);
    return () => window.removeEventListener("beforeunload", warnBeforeExit);
  }, [settings.printKitchenEnabled, user?.role]);

  useEffect(() => {
    if (!printer.connected) return;
    const pending = reloadFailed();
    void recoverPending();
    let chain = Promise.resolve();
    for (const ticket of pending) chain = chain.then(() => printReserved(ticket));
    void chain;
  }, [printer.connected, printReserved, recoverPending, reloadFailed]);

  if (user?.role !== "caixa") return null;
  const retryInWindows = async (ticket: TicketRow) => {
    try {
      const current = getPrintSettings();
      await printKitchenTicket(
        ticket,
        current.printerMode === "simulacao" ? current : { ...current, printerMode: "browser" },
        true,
      );
      setFailed((current) => {
        const next = current.filter((item) => item.id !== ticket.id);
        writeFailed(next);
        return next;
      });
      setWarning(null);
    } catch (cause) {
      toast.error(`Impressão pelo Windows também falhou: ${errorMessage(cause)}`);
    }
  };

  return (
    <>
      <div className="border-b bg-muted/60 px-4 py-2 text-center text-xs text-muted-foreground">
        Mantenha o Mesari aberto neste computador para imprimir os pedidos
      </div>
      {warning && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-center gap-3 bg-amber-100 px-4 py-2 text-sm text-amber-950"
        >
          Comanda #{warning.number} · {ticketLocation(warning)} não imprimiu.
          <Btn size="sm" onClick={() => void printReserved(warning)} disabled={!printer.connected}>
            Tentar de novo
          </Btn>
          <Btn size="sm" variant="outline" onClick={() => void retryInWindows(warning)}>
            Imprimir pelo Windows
          </Btn>
        </div>
      )}
      {failed.length > 1 && (
        <details className="border-b bg-amber-50 px-4 py-2 text-sm text-amber-950">
          <summary className="cursor-pointer font-semibold">
            Comandas não impressas ({failed.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {failed.map((ticket) => (
              <li key={ticket.id} className="flex items-center justify-between gap-3">
                <span>
                  Comanda #{ticket.number} · {ticketLocation(ticket)}
                </span>
                <Btn size="sm" variant="outline" onClick={() => void printReserved(ticket)}>
                  Tentar de novo
                </Btn>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="sr-only" aria-live="polite">
        {printer.connected ? "Impressora pronta" : "Impressora desconectada"}
      </div>
      <div
        className={`sticky top-16 z-20 flex items-center justify-center gap-2 border-b px-4 py-2 text-sm ${printer.connected ? "bg-green-50 text-green-800" : settings.printerDeviceId || settings.connectionType ? "bg-amber-50 text-amber-900" : "bg-red-50 text-red-800"}`}
      >
        {printer.connected ? (
          <span className="font-semibold">Impressora pronta · {printer.name}</span>
        ) : settings.printerDeviceId || settings.connectionType ? (
          <span className="font-semibold">Reconectando...</span>
        ) : (
          <Link to="/impressao" className="font-semibold underline">
            Impressora desconectada
          </Link>
        )}
      </div>
      {recent.length > 0 && (
        <details className="border-b px-4 py-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-semibold">
            Últimas comandas ({recent.length})
          </summary>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {recent.slice(0, 30).map((ticket) => (
              <span key={ticket.id}>
                #{ticket.number} · {ticketLocation(ticket)}
              </span>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
