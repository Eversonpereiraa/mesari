import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Printer, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { Btn } from "@/components/ui-kit";
import { supabase } from "@/lib/supabase";
import { actions, errorMessage, useStore } from "@/lib/store";
import { getPrintSettings, printKitchenTicket, type KitchenTicket } from "@/lib/printing";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/cozinha")({
  head: () => ({
    meta: [
      { title: "Estação de impressão | Mesari" },
      { name: "description", content: "Comandas da cozinha e do bar." },
    ],
  }),
  component: KitchenStation,
});

type Sector = KitchenTicket["sector"];
type KitchenRow = KitchenTicket & { printedAt: number | null };
const SECTORS_KEY = "mesari-kitchen-sectors";
const DEFAULT_SECTORS: Sector[] = ["cozinha", "bar"];

function mapOrder(value: unknown): KitchenRow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("O Supabase retornou uma comanda em formato inválido.");
  }
  const row = value as Record<string, unknown>;
  if (row.setor !== "cozinha" && row.setor !== "bar") {
    throw new Error(`Setor inválido recebido na comanda: ${String(row.setor)}.`);
  }
  if (!Array.isArray(row.itens)) throw new Error("A comanda não contém uma lista válida de itens.");
  return {
    id: String(row.id),
    number: Number(row.numero),
    table: Number(row.mesa_numero),
    sector: row.setor,
    waiter: typeof row.garcom_nome === "string" ? row.garcom_nome : "",
    additional: row.adicional === true,
    createdAt: new Date(String(row.criado_em)).getTime(),
    printedAt: row.impresso_em ? new Date(String(row.impresso_em)).getTime() : null,
    items: row.itens.map((value: unknown) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("Um item da comanda está em formato inválido.");
      }
      const item = value as Record<string, unknown>;
      return {
        product: typeof item.produto === "string" ? item.produto : "",
        quantity: Number(item.quantidade),
        note: typeof item.observacao === "string" ? item.observacao : "",
        ...(typeof item.valor_unitario === "number" && Number.isFinite(item.valor_unitario)
          ? { unitPrice: item.valor_unitario }
          : {}),
      };
    }),
  };
}

function makeTestTicket(sector: Sector): KitchenTicket {
  return {
    id: "teste",
    number: 123,
    table: 5,
    sector,
    waiter: "Teste de impressão",
    additional: false,
    createdAt: Date.now(),
    items: [
      { product: "Picanha na chapa", quantity: 2, note: "sem cebola", unitPrice: 48.5 },
      { product: "Suco de laranja", quantity: 1, note: "", unitPrice: 12 },
    ],
  };
}

async function playNotice() {
  const AudioContextConstructor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) throw new Error("Este navegador não suporta aviso sonoro.");
  const context = new AudioContextConstructor();
  if (context.state === "suspended") await context.resume();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 880;
  gain.gain.value = 0.08;
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.14);
  await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
  await context.close();
}

function KitchenStation() {
  const user = useStore((snapshot) => snapshot.user);
  const authLoading = useStore((snapshot) => snapshot.loading);
  const navigate = useNavigate();
  const [selectedSectors, setSelectedSectors] = useState<Sector[]>(DEFAULT_SECTORS);
  const [connected, setConnected] = useState(false);
  const [orders, setOrders] = useState<KitchenRow[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sectorReady, setSectorReady] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const processingRef = useRef(new Set<string>());

  useEffect(() => {
    if (!authLoading && !user) void navigate({ to: "/", replace: true });
  }, [authLoading, navigate, user]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SECTORS_KEY);
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        if (
          Array.isArray(parsed) &&
          parsed.length > 0 &&
          parsed.every((value) => value === "cozinha" || value === "bar")
        ) {
          setSelectedSectors([...new Set(parsed as Sector[])]);
        } else {
          throw new Error("A seleção local de setores da cozinha está inválida.");
        }
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSectorReady(true);
    }
  }, []);

  const loadRecent = useCallback(async (selected: Sector[]) => {
    if (selected.length === 0) return;
    const { data, error: queryError } = await supabase
      .from("pedidos_cozinha")
      .select("id,numero,mesa_numero,setor,garcom_nome,adicional,itens,criado_em,impresso_em")
      .in("setor", selected)
      .order("criado_em", { ascending: false })
      .limit(30);
    if (queryError) throw queryError;
    setOrders((data ?? []).map(mapOrder));
  }, []);

  const reserveAndPrint = useCallback(
    async (ticket: KitchenRow, automatic: boolean) => {
      if (processingRef.current.has(ticket.id)) return;
      processingRef.current.add(ticket.id);
      try {
        const { data, error: reserveError } = await supabase.rpc("marcar_impresso", {
          p_id: ticket.id,
        });
        if (reserveError) throw reserveError;
        if (data === true) {
          await printKitchenTicket(ticket, getPrintSettings());
          if (automatic) {
            try {
              await playNotice();
            } catch (cause) {
              setError(errorMessage(cause));
            }
          }
          setMessage(`Comanda #${ticket.number} impressa.`);
        } else {
          setMessage(`A comanda #${ticket.number} já foi reservada por outra estação.`);
        }
      } finally {
        try {
          await loadRecent(selectedSectors);
        } finally {
          processingRef.current.delete(ticket.id);
        }
      }
    },
    [loadRecent, selectedSectors],
  );

  useEffect(() => {
    if (!user || !sectorReady || selectedSectors.length === 0) return;
    let active = true;
    let recovery = Promise.resolve();
    const channel = supabase.channel("estacao-impressao", {
      config: { presence: { key: `${user.id}` } },
    });
    channelRef.current = channel;
    for (const selected of selectedSectors) {
      channel.on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "pedidos_cozinha",
          filter: `setor=eq.${selected}`,
        },
        (payload) => {
          try {
            const ticket = mapOrder(payload.new);
            setOrders((current) =>
              [ticket, ...current.filter((row) => row.id !== ticket.id)].slice(0, 30),
            );
            recovery = recovery
              .then(() => reserveAndPrint(ticket, true))
              .catch((cause: unknown) => {
                if (active) setError(errorMessage(cause));
              });
          } catch (cause) {
            setError(errorMessage(cause));
          }
        },
      );
    }
    channel.subscribe((status, cause) => {
      if (!active) return;
      const isConnected = status === "SUBSCRIBED";
      setConnected(isConnected);
      if (cause) setError(errorMessage(cause));
      if (isConnected) {
        setError("");
        void channel
          .track({ tipo: "estacao-impressao", setores: selectedSectors, usuario: user.username })
          .catch((trackError: unknown) => {
            if (active) setError(errorMessage(trackError));
          });
        recovery = recovery
          .then(async () => {
            await loadRecent(selectedSectors);
            const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
            const { data, error: queryError } = await supabase
              .from("pedidos_cozinha")
              .select(
                "id,numero,mesa_numero,setor,garcom_nome,adicional,itens,criado_em,impresso_em",
              )
              .in("setor", selectedSectors)
              .is("impresso_em", null)
              .gte("criado_em", cutoff)
              .order("criado_em", { ascending: true });
            if (queryError) throw queryError;
            for (const value of data ?? []) {
              if (!active) break;
              await reserveAndPrint(mapOrder(value), true);
            }
          })
          .catch((loadError: unknown) => {
            if (active) setError(errorMessage(loadError));
          });
      }
    });

    return () => {
      active = false;
      setConnected(false);
      if (channelRef.current === channel) channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [loadRecent, reserveAndPrint, sectorReady, selectedSectors, user]);

  useEffect(() => {
    if (!sectorReady) return;
    try {
      localStorage.setItem(SECTORS_KEY, JSON.stringify(selectedSectors));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [selectedSectors, sectorReady]);

  useEffect(() => {
    if (!user) return;
    type WakeLock = {
      release: () => Promise<void>;
      addEventListener?: (type: "release", listener: () => void) => void;
    };
    type WakeLockNavigator = Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeLock> };
    };
    let lock: WakeLock | null = null;
    let active = true;
    const requestLock = async () => {
      const api = (navigator as WakeLockNavigator).wakeLock;
      if (!api) {
        setMessage("O navegador não oferece suporte a manter a tela ativa.");
        return;
      }
      try {
        lock = await api.request("screen");
        if (active) setWakeLockActive(true);
        lock.addEventListener?.("release", () => {
          lock = null;
          if (active) setWakeLockActive(false);
        });
      } catch (cause) {
        if (active) setError(errorMessage(cause));
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible" && !lock) void requestLock();
    };
    void requestLock();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisibility);
      if (lock) {
        void lock.release().catch((cause: unknown) => {
          if (active) setError(errorMessage(cause));
        });
      }
    };
  }, [user]);

  const printTest = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await printKitchenTicket(makeTestTicket(selectedSectors[0] ?? "cozinha"), getPrintSettings());
      setMessage("Comanda de teste enviada para impressão.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const printOne = async (ticket: KitchenRow) => {
    setBusy(true);
    setError("");
    try {
      if (!ticket.printedAt) {
        await reserveAndPrint(ticket, false);
      } else {
        await printKitchenTicket(ticket, getPrintSettings());
        setMessage(`Comanda #${ticket.number} reimpressa.`);
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (authLoading || !user) return null;
  const pendingCount = orders.filter((order) => !order.printedAt).length;
  const toggleSector = (value: Sector, checked: boolean) => {
    setSelectedSectors((current) => {
      if (!checked && current.length === 1) return current;
      return checked ? [...new Set([...current, value])] : current.filter((item) => item !== value);
    });
  };

  return (
    <main className="min-h-screen bg-[#101316] text-white">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 bg-[#171b1f] px-5 py-4 shadow-lg">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-white/50">
            Estação de impressão
          </div>
          <h1 className="font-display text-2xl font-extrabold">
            Imprimir comandas neste computador
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={selectedSectors.includes("cozinha")}
              onChange={(event) => toggleSector("cozinha", event.target.checked)}
            />
            Cozinha
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={selectedSectors.includes("bar")}
              onChange={(event) => toggleSector("bar", event.target.checked)}
            />
            Bar
          </label>
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-bold",
              connected ? "bg-emerald-400/15 text-emerald-300" : "bg-amber-300/15 text-amber-200",
            )}
          >
            {connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
            {connected ? "Conectado" : "Reconectando..."}
          </span>
          <Btn variant="outline" disabled={busy} onClick={() => void printTest()}>
            <Printer className="h-4 w-4" />
            Imprimir teste
          </Btn>
        </div>
      </header>

      <div className="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-center gap-2 bg-amber-300 px-4 py-2 text-center font-bold text-[#201900] shadow-[0_-4px_20px_#0008]">
        <Check className="h-4 w-4" />
        Mantenha esta página aberta
        {!wakeLockActive && <span className="text-xs font-medium">(a tela pode apagar)</span>}
      </div>

      <section className="mx-auto max-w-7xl space-y-5 p-4 pb-20 md:p-7 md:pb-24">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-bold">Comandas recentes</h2>
            <p className="mt-1 text-sm text-white/55">
              {orders.length} últimas · {pendingCount} aguardando
            </p>
          </div>
        </div>
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-red-300/20 bg-red-500/10 p-4 text-sm text-red-200"
          >
            {error}
          </p>
        )}
        {message && (
          <p
            role="status"
            className="rounded-xl border border-emerald-300/20 bg-emerald-500/10 p-3 text-sm text-emerald-200"
          >
            {message}
          </p>
        )}
        {orders.length === 0 ? (
          <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-white/15 bg-white/[0.03] text-center text-white/45">
            <div>
              <RefreshCw className="mx-auto mb-3 h-8 w-8" />
              <p className="text-lg font-semibold">Aguardando pedidos</p>
              <p className="mt-1 text-sm">Novas comandas dos setores selecionados aparecem aqui.</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {orders.map((order) => (
              <article
                key={order.id}
                className={cn(
                  "overflow-hidden rounded-2xl border shadow-lg",
                  order.printedAt
                    ? "border-white/10 bg-[#1b2025]"
                    : "border-amber-300/60 bg-[#312916] ring-2 ring-amber-300/15",
                )}
              >
                <header
                  className={cn(
                    "flex items-center justify-between gap-3 px-5 py-4",
                    order.printedAt ? "bg-white/[0.035]" : "bg-amber-300 text-[#19160e]",
                  )}
                >
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider opacity-65">
                      Pedido
                    </div>
                    <div className="font-display text-2xl font-black">#{order.number}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-display text-4xl font-black">
                      Mesa {String(order.table).padStart(2, "0")}
                    </div>
                    <div className="text-sm font-semibold opacity-70">
                      {new Date(order.createdAt).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                </header>
                <div className="px-5 py-3 text-sm text-white/65">
                  {order.additional ? (
                    <span className="font-extrabold text-amber-200">** ADICIONAL **</span>
                  ) : (
                    <span className="font-extrabold text-emerald-300">NOVO PEDIDO</span>
                  )}
                  <span className="mx-2 text-white/20">·</span>
                  Garçom: <strong className="text-white">{order.waiter || "—"}</strong>
                </div>
                <ul className="divide-y divide-white/10 border-y border-white/10 px-5">
                  {order.items.map((item, index) => (
                    <li key={`${order.id}-${index}`} className="py-4">
                      <div className="text-xl font-extrabold leading-snug">
                        {item.quantity}x&nbsp; {item.product}
                      </div>
                      {item.note && (
                        <div className="mt-2 rounded-md bg-amber-300/10 px-3 py-2 text-base font-bold text-amber-200">
                          &gt;&gt; {item.note}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                <footer className="flex items-center justify-between gap-3 px-5 py-4">
                  <span
                    className={cn(
                      "text-sm font-semibold",
                      order.printedAt ? "text-emerald-300" : "text-amber-200",
                    )}
                  >
                    {order.printedAt
                      ? `Impresso às ${new Date(order.printedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
                      : "Aguardando"}
                  </span>
                  <Btn
                    variant={order.printedAt ? "outline" : "success"}
                    disabled={busy}
                    onClick={() => void printOne(order)}
                  >
                    <Printer className="h-4 w-4" />
                    {order.printedAt ? "Reimprimir" : "Imprimir"}
                  </Btn>
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
