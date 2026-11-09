/**
 * Estação de impressão automática: imprime a fila public.fila_impressao (cozinha, adicional,
 * delivery e conta) neste aparelho, em qualquer tela, sem clique.
 *
 * - Reserva os trabalhos com a RPC reservar_impressao (for update skip locked): com duas
 *   estações abertas, cada comanda sai uma vez só.
 * - Falha de impressão volta para a fila; o banco tenta de novo a cada 15 s, até 5 vezes.
 *   Depois disso o trabalho fica "falhou" e o caixa vê o alerta "Imprimir pendentes".
 * - Ao abrir, imprime o que ficou pendente nas últimas 3 horas; o mais antigo só aparece na lista.
 * - Quando a impressora volta (ou uma impressão dá certo), os que falharam nas últimas 3 horas
 *   voltam sozinhos para a fila.
 *
 * Imprime só onde dá para imprimir sem diálogo: no app desktop (sempre silencioso) ou no
 * navegador com impressora conectada direto (USB, Bluetooth, rede pelo agente).
 */
import { useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase";
import { preBillReceipt } from "@/lib/bill-print";
import { mapTicket } from "@/lib/kitchen-ticket";
import {
  getPrinterStatus,
  imprimirComanda,
  imprimirNota,
  initializePrinter,
  loadConfig,
  printErrorMessage,
  subscribeConfig,
  subscribePrinterStatus,
} from "@/lib/printing";
import type { OrderLine, State } from "@/lib/store";

export type JobType = "cozinha" | "adicional" | "delivery" | "conta";
export type JobStatus = "pendente" | "imprimindo" | "impresso" | "falhou";

export type QueueJob = {
  id: string;
  type: JobType;
  status: JobStatus;
  attempts: number;
  error: string | null;
  createdAt: number;
  releasedAt: number;
  printedAt: number | null;
  station: string | null;
  /** "Mesa 05 · comanda #12", "Entrega #3 · Maria"... */
  label: string;
};

export type PrintStation = {
  key: string;
  name: string;
  desktop: boolean;
  ready: boolean;
  printing: boolean;
  self: boolean;
};

export type QueueState = {
  /** null = verificando; false = migration da fila ainda não aplicada (usa a estação antiga). */
  available: boolean | null;
  jobs: QueueJob[];
  stations: PrintStation[];
  /** Este aparelho pode imprimir sozinho (app desktop ou impressora direta) e está ligado. */
  canPrint: boolean;
  printing: boolean;
  /** Estação que imprimiu por último (para "imprimindo em: ..."). */
  lastStation: string | null;
  error: string | null;
};

export const AUTO_WINDOW_MS = 3 * 60 * 60 * 1000;
const POLL_MS = 15_000;
const RECOVERY_MS = 60_000;
const STATION_KEY = "mesari-estacao-id";
const JOB_COLUMNS =
  "id,tipo,status,tentativas,erro,criado_em,liberado_em,impresso_em,estacao,dados,comanda:pedidos_cozinha(numero,mesa_numero,origem,dados)";

let state: QueueState = {
  available: null,
  jobs: [],
  stations: [],
  canPrint: false,
  printing: false,
  lastStation: null,
  error: null,
};
const listeners = new Set<() => void>();

function publish(next: Partial<QueueState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

export function getQueueState() {
  return state;
}

export function subscribeQueue(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePrintQueue() {
  return useSyncExternalStore(subscribeQueue, getQueueState, getQueueState);
}

// ---------------------------------------------------------------------------------------------
// Dados auxiliares

type Row = Record<string, unknown>;

function asRow(value: unknown): Row {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Row) : {};
}

function time(value: unknown) {
  return typeof value === "string" ? new Date(value).getTime() : null;
}

function message(cause: unknown) {
  if (cause instanceof Error) return cause.message;
  const row = asRow(cause);
  return typeof row["message"] === "string" ? row["message"] : String(cause);
}

const pad = (value: unknown) => String(value ?? "—").padStart(2, "0");

function jobLabel(type: JobType, row: Row) {
  if (type === "conta") return `Conta · Mesa ${pad(asRow(row["dados"])["mesa_numero"])}`;
  const comanda = asRow(row["comanda"]);
  const details = asRow(comanda["dados"]);
  if (type === "delivery") {
    const origin = comanda["origem"] === "retirada" ? "Retirada" : "Entrega";
    const name = typeof details["cliente_nome"] === "string" ? ` · ${details["cliente_nome"]}` : "";
    return `${origin} #${String(details["numero_dia"] ?? comanda["numero"] ?? "—")}${name}`;
  }
  const kind = type === "adicional" ? "Adicional" : "Comanda";
  return `${kind} #${String(comanda["numero"] ?? "—")} · Mesa ${pad(comanda["mesa_numero"])}`;
}

function mapJob(value: unknown): QueueJob {
  const row = asRow(value);
  const type = row["tipo"] as JobType;
  return {
    id: String(row["id"]),
    type,
    status: row["status"] as JobStatus,
    attempts: Number(row["tentativas"] ?? 0),
    error: typeof row["erro"] === "string" ? row["erro"] : null,
    createdAt: time(row["criado_em"]) ?? Date.now(),
    releasedAt: time(row["liberado_em"]) ?? Date.now(),
    printedAt: time(row["impresso_em"]),
    station: typeof row["estacao"] === "string" ? row["estacao"] : null,
    label: jobLabel(type, row),
  };
}

/** Trabalhos que precisam da atenção do caixa: falharam ou ficaram de fora da impressão automática. */
export function unprintedJobs(jobs: QueueJob[], now = Date.now()) {
  return jobs.filter(
    (job) =>
      job.status === "falhou" ||
      (job.status === "pendente" && now - job.releasedAt > AUTO_WINDOW_MS),
  );
}

function isMissingQueue(error: { code?: string; message?: string }) {
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.code === "PGRST202" ||
    /fila_impressao|reservar_impressao/.test(error.message ?? "")
  );
}

// ---------------------------------------------------------------------------------------------
// Este aparelho

const isDesktop = () => typeof window !== "undefined" && Boolean(window.mesariDesktop);

function stationKey() {
  try {
    let key = localStorage.getItem(STATION_KEY);
    if (!key) {
      key = crypto.randomUUID();
      localStorage.setItem(STATION_KEY, key);
    }
    return key;
  } catch {
    return "sem-armazenamento";
  }
}

/** Pode imprimir sem caixa de diálogo? Desktop: sempre. Navegador: só com impressora direta. */
function printsSilently() {
  return isDesktop() || loadConfig().connection !== "navegador";
}

function computeCanPrint() {
  return loadConfig().printKitchenEnabled && printsSilently();
}

// ---------------------------------------------------------------------------------------------
// Motor

type Session = {
  userId: string;
  stationName: string;
  key: string;
  channel: ReturnType<typeof supabase.channel>;
  presence: ReturnType<typeof supabase.channel>;
  timers: number[];
  unsubscribe: (() => void)[];
};

let session: Session | null = null;
let restaurant: State["restaurant"] | null = null;
let ticking = false;
let tickAgain = false;
let reloadTimer: number | null = null;

/** Dados do restaurante para a conta (taxa de serviço, rodapé, logo). */
export function setQueueRestaurant(next: State["restaurant"]) {
  restaurant = next;
}

function trackPresence() {
  if (!session) return;
  const { presence, stationName } = session;
  void presence
    .track({
      tipo: "estacao-impressao",
      // A tela do garçom considera a estação pronta quando ela imprime sozinha.
      pronta: state.canPrint && (isDesktop() || getPrinterStatus().connected),
      usuario: stationName,
      estacao: stationName,
      desktop: isDesktop(),
      imprimindo: state.printing,
    })
    .catch((cause: unknown) => console.warn("[fila] presença", cause));
}

function readStations() {
  if (!session) return [];
  const own = session.key;
  const stations: PrintStation[] = [];
  for (const [key, entries] of Object.entries(session.presence.presenceState())) {
    for (const entry of entries as unknown[]) {
      const row = asRow(entry);
      if (row["tipo"] !== "estacao-impressao" || typeof row["estacao"] !== "string") continue;
      stations.push({
        key,
        name: row["estacao"],
        desktop: row["desktop"] === true,
        ready: row["pronta"] === true,
        printing: row["imprimindo"] === true,
        self: key === own,
      });
    }
  }
  return stations;
}

async function loadJobs() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("fila_impressao")
    .select(JOB_COLUMNS)
    .gte("criado_em", since)
    .order("criado_em", { ascending: false })
    .limit(150);
  if (error) {
    if (isMissingQueue(error)) publish({ available: false });
    throw error;
  }
  const jobs = (data ?? []).map(mapJob);
  const last = jobs.find((job) => job.status === "impresso" && job.station);
  publish({ available: true, jobs, lastStation: last?.station ?? state.lastStation, error: null });
  return jobs;
}

function scheduleReload() {
  if (reloadTimer !== null) window.clearTimeout(reloadTimer);
  reloadTimer = window.setTimeout(() => {
    reloadTimer = null;
    void loadJobs().catch((cause: unknown) => console.warn("[fila] lista", cause));
  }, 300);
}

function orderLines(value: unknown): OrderLine[] {
  const items = Array.isArray(value) ? value : [];
  return items.map((entry, index) => {
    const item = asRow(entry);
    return {
      id: String(item["id"] ?? index),
      itemId: "",
      name: String(item["produto"] ?? ""),
      qty: Number(item["quantidade"] ?? 0),
      price: Number(item["valor_unitario"] ?? 0),
      note: String(item["observacao"] ?? ""),
      at: 0,
      waiter: String(item["garcom"] ?? ""),
    };
  });
}

async function printJob(job: Row) {
  const type = job["tipo"] as JobType;
  if (type === "conta") {
    if (!restaurant) throw new Error("Os dados do restaurante ainda não carregaram.");
    const details = asRow(job["dados"]);
    const table = {
      id: String(job["mesa_id"] ?? job["id"]),
      number: Number(details["mesa_numero"]),
    };
    const receipt = { ...preBillReceipt(table, orderLines(details["itens"]), restaurant) };
    // Mesmo id do trabalho: um evento repetido não imprime a conta duas vezes.
    receipt.id = `fila-${String(job["id"])}`;
    await imprimirNota(receipt, restaurant);
    return;
  }
  const comanda = job["comanda"];
  if (!comanda) throw new Error("A comanda deste trabalho não existe mais.");
  const ticket = mapTicket(comanda);
  await imprimirComanda({ ...ticket, additional: ticket.additional || type === "adicional" });
}

async function conclude(id: string, ok: boolean, error: string | null) {
  const { error: rpcError } = await supabase.rpc("concluir_impressao", {
    p_id: id,
    p_ok: ok,
    p_erro: error,
  });
  if (rpcError) throw rpcError;
}

/** Tipos que este aparelho aceita: conta no navegador só se nenhum app desktop estiver aberto. */
function acceptedTypes(): JobType[] | null {
  if (isDesktop()) return null;
  const desktopOnline = state.stations.some((station) => station.desktop && station.ready);
  return desktopOnline ? ["cozinha", "adicional", "delivery"] : null;
}

async function reserveBatch() {
  if (!session) return [];
  const { data, error } = await supabase.rpc("reservar_impressao", {
    p_estacao: session.stationName,
    p_tipos: acceptedTypes(),
    p_limite: 3,
  });
  if (error) {
    if (isMissingQueue(error)) publish({ available: false });
    throw error;
  }
  return Array.isArray(data) ? data.map(asRow) : [];
}

/** Reserva e imprime tudo o que estiver liberado. Chamadas durante uma rodada geram outra. */
export async function tick() {
  if (!session || state.available === false || !state.canPrint) return;
  if (ticking) {
    tickAgain = true;
    return;
  }
  ticking = true;
  let printedSomething = false;
  try {
    do {
      tickAgain = false;
      for (let round = 0; round < 10; round += 1) {
        const batch = await reserveBatch();
        if (!batch.length) break;
        publish({ printing: true });
        trackPresence();
        for (const job of batch) {
          const id = String(job["id"]);
          try {
            await printJob(job);
            await conclude(id, true, null);
            printedSomething = true;
          } catch (cause) {
            console.warn("[fila] impressão falhou", cause);
            await conclude(id, false, printErrorMessage(cause)).catch((error: unknown) =>
              console.error("[fila] não foi possível registrar a falha", error),
            );
          }
        }
      }
    } while (tickAgain && session);
    publish({ error: null });
  } catch (cause) {
    publish({ error: message(cause) });
  } finally {
    ticking = false;
    if (state.printing) {
      publish({ printing: false });
      trackPresence();
    }
  }
  if (printedSomething) {
    scheduleReload();
    // A impressora respondeu: o que falhou nas últimas 3 h volta para a fila.
    void retryRecentFailures();
  }
}

async function retryRecentFailures(limit?: number) {
  const now = Date.now();
  const failed = state.jobs
    .filter((job) => job.status === "falhou" && now - job.createdAt < AUTO_WINDOW_MS)
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, limit);
  if (!failed.length) return;
  await reprintJobs(failed.map((job) => job.id)).catch((cause: unknown) =>
    console.warn("[fila] nova tentativa automática", cause),
  );
}

/** Devolve trabalhos à fila (reimpressão de um item da lista). */
export async function reprintJobs(ids: string[]) {
  const { error } = await supabase.rpc("reenviar_impressao", { p_ids: ids });
  if (error) throw error;
  await loadJobs();
  void tick();
}

/** Botão "Imprimir pendentes": os que falharam e os antigos que não imprimiram. */
export async function printPending() {
  const { data, error } = await supabase.rpc("reenviar_impressao", { p_ids: null });
  if (error) throw error;
  await loadJobs();
  void tick();
  return Number(data ?? 0);
}

/** "Reimprimir nota": manda a conta da mesa de novo para a estação de impressão. */
export async function requestBillPrint(tableId: string) {
  const { error } = await supabase.rpc("imprimir_conta", { p_mesa_id: tableId });
  if (error) throw error;
}

/** Reimprime a comanda de um pedido de delivery pela fila. false = pedido sem comanda na fila. */
export async function reprintExternalOrder(orderId: string) {
  const { data, error } = await supabase
    .from("fila_impressao")
    .select("id")
    .eq("pedido_externo_id", orderId)
    .order("criado_em", { ascending: false })
    .limit(1);
  if (error) throw error;
  const id = data?.[0] ? String(asRow(data[0])["id"]) : null;
  if (!id) return false;
  await reprintJobs([id]);
  return true;
}

function refreshCanPrint() {
  const canPrint = computeCanPrint();
  if (canPrint !== state.canPrint) {
    publish({ canPrint });
    trackPresence();
    if (canPrint) void tick();
  }
}

export function startPrintQueue(user: { id: string; name: string }) {
  if (session?.userId === user.id) return;
  stopPrintQueue();
  const key = stationKey();
  const stationName = `${isDesktop() ? "App Windows" : "Navegador"} · ${user.name || "Caixa"} · ${key.slice(0, 4)}`;
  const channel = supabase
    .channel("fila-impressao")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "fila_impressao" },
      (payload) => {
        scheduleReload();
        const row = asRow(payload.new);
        if (row["status"] === "pendente") void tick();
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        scheduleReload();
        void tick();
      }
    });
  const presence = supabase.channel("estacao-impressao", { config: { presence: { key } } });
  presence
    .on("presence", { event: "sync" }, () => publish({ stations: readStations() }))
    .subscribe((status) => {
      if (status === "SUBSCRIBED") trackPresence();
    });

  session = { userId: user.id, stationName, key, channel, presence, timers: [], unsubscribe: [] };
  publish({ canPrint: computeCanPrint(), error: null });

  let wasConnected = getPrinterStatus().connected;
  session.unsubscribe.push(
    subscribeConfig(refreshCanPrint),
    subscribePrinterStatus(() => {
      const connected = getPrinterStatus().connected;
      trackPresence();
      // Impressora voltou: imprime o que falhou nas últimas 3 h.
      if (connected && !wasConnected) void retryRecentFailures().then(() => tick());
      wasConnected = connected;
    }),
  );
  session.timers.push(
    // Tentativas a cada 15 s (o banco libera o trabalho de novo 15 s depois da falha).
    window.setInterval(() => void tick(), POLL_MS),
    // Uma comanda que falhou 5 vezes é testada de novo a cada minuto (impressora religada).
    window.setInterval(() => {
      if (state.canPrint && !state.jobs.some((job) => job.status === "pendente")) {
        void retryRecentFailures(1);
      }
    }, RECOVERY_MS),
  );
  const online = () => void tick();
  window.addEventListener("online", online);
  session.unsubscribe.push(() => window.removeEventListener("online", online));

  void initializePrinter().catch((cause: unknown) => console.warn("[fila] impressora", cause));
  // Ao abrir: carrega a lista e imprime o que ficou pendente (até 3 h).
  void loadJobs()
    .then(() => tick())
    .catch((cause: unknown) => {
      if (state.available !== false) publish({ error: message(cause) });
    });
}

export function stopPrintQueue() {
  if (!session) return;
  const current = session;
  session = null;
  current.timers.forEach((timer) => window.clearInterval(timer));
  current.unsubscribe.forEach((unsubscribe) => unsubscribe());
  void supabase.removeChannel(current.channel);
  void supabase.removeChannel(current.presence);
  if (reloadTimer !== null) window.clearTimeout(reloadTimer);
  reloadTimer = null;
  publish({ jobs: [], stations: [], printing: false, canPrint: false, error: null });
}

/** Só para testes. */
export function resetPrintQueueForTests() {
  stopPrintQueue();
  ticking = false;
  tickAgain = false;
  restaurant = null;
  state = {
    available: null,
    jobs: [],
    stations: [],
    canPrint: false,
    printing: false,
    lastStation: null,
    error: null,
  };
}
