import { supabase } from "@/lib/supabase";

let presenceChannel: ReturnType<typeof supabase.channel> | null = null;
let presenceJoined = false;

export function startKitchenPresenceObserver() {
  if (presenceChannel) return;
  presenceChannel = supabase.channel("estacao-impressao");
  presenceChannel.subscribe((status) => {
    presenceJoined = status === "SUBSCRIBED";
  });
}

export function isKitchenStationOnline() {
  if (!presenceJoined || !presenceChannel) return false;
  const state = presenceChannel.presenceState();
  const isReadyStation = (entry: unknown): entry is { tipo: string; pronta: boolean } =>
    typeof entry === "object" &&
    entry !== null &&
    "tipo" in entry &&
    "pronta" in entry &&
    entry.tipo === "estacao-impressao" &&
    entry.pronta === true;
  return Object.values(state).some((entries) => entries.some(isReadyStation));
}





