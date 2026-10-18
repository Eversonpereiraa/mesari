import { useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase";

/**
 * Presença da estação de impressão (caixa ou tablet da cozinha).
 *
 * "desconhecido" = o canal ainda não sincronizou (ou caiu). Nunca deve gerar
 * aviso de "impressora desconectada": só "offline" é um offline confirmado.
 */
export type KitchenStationStatus = "desconhecido" | "online" | "offline";

type StationPayload = { tipo: "estacao-impressao"; pronta?: boolean } & Record<string, unknown>;

// supabase.channel() devolve o mesmo objeto para o mesmo tópico, e presence só
// pode ser registrado antes do subscribe(). Por isso este módulo é o único dono
// do canal "estacao-impressao" nesta aba.
let channel: ReturnType<typeof supabase.channel> | null = null;
let subscribed = false;
let synced = false;
let tracked: StationPayload | null = null;
let status: KitchenStationStatus = "desconhecido";
const listeners = new Set<() => void>();

function setStatus(next: KitchenStationStatus) {
  if (next === status) return;
  status = next;
  listeners.forEach((notify) => notify());
}

/** Uma estação conta como pronta se anunciou o tipo e não disse explicitamente que a impressora caiu. */
export function isReadyStation(entry: unknown) {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "tipo" in entry &&
    entry.tipo === "estacao-impressao" &&
    (!("pronta" in entry) || entry.pronta !== false)
  );
}

function recompute() {
  if (!channel || !subscribed || !synced) {
    setStatus("desconhecido");
    return;
  }
  const state = channel.presenceState();
  setStatus(
    Object.values(state).some((entries) => entries.some(isReadyStation)) ? "online" : "offline",
  );
}

function sendTrack() {
  if (!channel || !subscribed || !tracked) return Promise.resolve();
  return channel.track(tracked).then(() => undefined);
}

export function startKitchenPresenceObserver() {
  if (channel) return;
  const current = supabase.channel("estacao-impressao", {
    config: { presence: { key: crypto.randomUUID() } },
  });
  channel = current;
  current
    .on("presence", { event: "sync" }, () => {
      synced = true;
      recompute();
    })
    .on("presence", { event: "join" }, recompute)
    .on("presence", { event: "leave" }, recompute)
    .subscribe((state) => {
      if (channel !== current) return;
      subscribed = state === "SUBSCRIBED";
      if (subscribed) {
        void sendTrack().catch(() => undefined);
      } else {
        synced = false;
      }
      recompute();
    });
}

/** Anuncia esta aba como estação de impressão (usado pelo caixa). */
export function trackKitchenStation(payload: StationPayload) {
  tracked = payload;
  startKitchenPresenceObserver();
  return sendTrack();
}

export function untrackKitchenStation() {
  tracked = null;
  if (channel && subscribed) void channel.untrack().catch(() => undefined);
}

export function getKitchenStationStatus(): KitchenStationStatus {
  return status;
}

export function useKitchenStationStatus() {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    getKitchenStationStatus,
    () => "desconhecido" as const,
  );
}

/** Só para testes. */
export function resetKitchenPresenceForTests() {
  if (channel) void supabase.removeChannel(channel);
  channel = null;
  subscribed = false;
  synced = false;
  tracked = null;
  status = "desconhecido";
}
