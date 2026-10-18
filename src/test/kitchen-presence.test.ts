import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = () => void;
const fake = vi.hoisted(() => ({
  handlers: {} as Record<string, () => void>,
  subscribe: null as ((state: string) => void) | null,
  presence: {} as Record<string, unknown[]>,
  track: vi.fn(() => Promise.resolve("ok")),
}));

vi.mock("@/lib/supabase", () => {
  const channel = {
    on(_type: string, filter: { event: string }, handler: Handler) {
      fake.handlers[filter.event] = handler;
      return channel;
    },
    subscribe(callback: (state: string) => void) {
      fake.subscribe = callback;
      return channel;
    },
    presenceState: () => fake.presence,
    track: fake.track,
    untrack: () => Promise.resolve("ok"),
  };
  return {
    supabase: { channel: () => channel, removeChannel: () => Promise.resolve("ok") },
    supabaseConfigured: true,
    usernameEmail: (value: string) => value,
  };
});

import {
  getKitchenStationStatus,
  resetKitchenPresenceForTests,
  startKitchenPresenceObserver,
  trackKitchenStation,
} from "@/lib/kitchen-presence";

describe("presença da estação de impressão", () => {
  beforeEach(() => {
    resetKitchenPresenceForTests();
    fake.handlers = {};
    fake.subscribe = null;
    fake.presence = {};
    fake.track.mockClear();
  });

  it("fica desconhecido (sem aviso) até o canal sincronizar", () => {
    startKitchenPresenceObserver();
    expect(getKitchenStationStatus()).toBe("desconhecido");
    fake.subscribe?.("SUBSCRIBED");
    expect(getKitchenStationStatus()).toBe("desconhecido");
  });

  it("fica online quando uma estação pronta aparece no sync", () => {
    startKitchenPresenceObserver();
    fake.subscribe?.("SUBSCRIBED");
    fake.presence = { a: [{ tipo: "estacao-impressao", pronta: true }] };
    fake.handlers["sync"]?.();
    expect(getKitchenStationStatus()).toBe("online");
  });

  it("conta o tablet da cozinha, que não informa 'pronta'", () => {
    startKitchenPresenceObserver();
    fake.subscribe?.("SUBSCRIBED");
    fake.presence = { a: [{ tipo: "estacao-impressao", setores: ["cozinha"] }] };
    fake.handlers["sync"]?.();
    expect(getKitchenStationStatus()).toBe("online");
  });

  it("só fica offline depois de sincronizar sem nenhuma estação pronta", () => {
    startKitchenPresenceObserver();
    fake.subscribe?.("SUBSCRIBED");
    fake.presence = { a: [{ tipo: "estacao-impressao", pronta: false }] };
    fake.handlers["sync"]?.();
    expect(getKitchenStationStatus()).toBe("offline");
  });

  it("volta para desconhecido se o canal cair", () => {
    startKitchenPresenceObserver();
    fake.subscribe?.("SUBSCRIBED");
    fake.handlers["sync"]?.();
    expect(getKitchenStationStatus()).toBe("offline");
    fake.subscribe?.("CHANNEL_ERROR");
    expect(getKitchenStationStatus()).toBe("desconhecido");
  });

  it("anuncia a estação do caixa assim que o canal conecta", async () => {
    await trackKitchenStation({ tipo: "estacao-impressao", pronta: true });
    expect(fake.track).not.toHaveBeenCalled();
    fake.subscribe?.("SUBSCRIBED");
    expect(fake.track).toHaveBeenCalledWith({ tipo: "estacao-impressao", pronta: true });
  });
});
