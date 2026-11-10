import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  batches: [] as Record<string, unknown>[][],
  rpc: vi.fn(),
  imprimirComanda: vi.fn(),
  imprimirNota: vi.fn(),
  config: { printKitchenEnabled: true, connection: "rede" },
  printer: { connected: true, reachable: true, label: "Rede (IP)", error: null as string | null },
}));

vi.mock("@/lib/supabase", () => {
  const channel = {
    on: () => channel,
    subscribe: () => channel,
    track: async () => "ok",
    presenceState: () => ({}),
  };
  const query = {
    select: () => query,
    gte: () => query,
    eq: () => query,
    order: () => query,
    limit: async () => ({ data: [], error: null }),
  };
  return {
    supabase: {
      from: () => query,
      channel: () => channel,
      removeChannel: vi.fn(),
      rpc: mocks.rpc,
    },
  };
});

vi.mock("@/lib/printing", () => ({
  getPrinterStatus: () => mocks.printer,
  imprimirComanda: mocks.imprimirComanda,
  imprimirNota: mocks.imprimirNota,
  initializePrinter: async () => undefined,
  loadConfig: () => mocks.config,
  printErrorMessage: (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
  startPrinterMonitor: () => undefined,
  stopPrinterMonitor: () => undefined,
  subscribeConfig: () => () => undefined,
  subscribePrinterStatus: () => () => undefined,
}));

vi.mock("@/lib/bill-print", () => ({
  preBillReceipt: (table: { id: string; number: number }, lines: unknown[]) => ({
    id: `nota-${table.id}`,
    table: table.number,
    lines,
    preBill: true,
  }),
}));

import {
  getQueueState,
  resetPrintQueueForTests,
  setQueueRestaurant,
  startPrintQueue,
  tick,
  unprintedJobs,
  type QueueJob,
} from "@/lib/print-queue";
import type { State } from "@/lib/store";

const comanda = (overrides: Record<string, unknown> = {}) => ({
  id: "pc-1",
  numero: 12,
  mesa_numero: 5,
  setor: "cozinha",
  garcom_nome: "Ana",
  adicional: false,
  origem: "mesa",
  criado_em: new Date().toISOString(),
  impresso_em: null,
  dados: null,
  itens: [{ produto: "Suco", quantidade: 1, valor_unitario: 8 }],
  ...overrides,
});

const concluded = () =>
  mocks.rpc.mock.calls
    .filter(([name]) => name === "concluir_impressao")
    .map(([, args]) => args as { p_id: string; p_ok: boolean; p_erro: string | null });

async function settle() {
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  resetPrintQueueForTests();
  mocks.batches = [];
  mocks.config = { printKitchenEnabled: true, connection: "rede" };
  mocks.printer = { connected: true, reachable: true, label: "Rede (IP)", error: null };
  mocks.imprimirComanda.mockReset().mockResolvedValue({ connection: "rede" });
  mocks.imprimirNota.mockReset().mockResolvedValue({ connection: "rede" });
  mocks.rpc.mockReset().mockImplementation(async (name: string) => {
    if (name === "reservar_impressao") return { data: mocks.batches.shift() ?? [], error: null };
    return { data: "impresso", error: null };
  });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  setQueueRestaurant({ name: "Mesari" } as State["restaurant"]);
});

afterEach(() => {
  resetPrintQueueForTests();
  vi.restoreAllMocks();
});

describe("fila de impressão", () => {
  it("imprime o adicional só com os itens da comanda e registra o sucesso", async () => {
    mocks.batches = [
      [
        {
          id: "job-1",
          tipo: "adicional",
          comanda: comanda({ adicional: true }),
        },
      ],
    ];
    startPrintQueue({ id: "u1", name: "Caixa" });
    await settle();
    await tick();
    expect(mocks.imprimirComanda).toHaveBeenCalledTimes(1);
    const ticket = mocks.imprimirComanda.mock.calls[0]![0] as {
      additional: boolean;
      items: unknown[];
      table: number;
      waiter: string;
    };
    expect(ticket.additional).toBe(true);
    expect(ticket.items).toHaveLength(1);
    expect(ticket.table).toBe(5);
    expect(ticket.waiter).toBe("Ana");
    expect(concluded()).toEqual([{ p_id: "job-1", p_ok: true, p_erro: null }]);
  });

  it("falha de impressão volta para a fila com o motivo (o banco agenda a nova tentativa)", async () => {
    mocks.imprimirComanda.mockRejectedValue(new Error("Impressora desligada"));
    mocks.batches = [[{ id: "job-2", tipo: "cozinha", comanda: comanda() }]];
    startPrintQueue({ id: "u1", name: "Caixa" });
    await settle();
    await tick();
    expect(concluded()).toEqual([{ p_id: "job-2", p_ok: false, p_erro: "Impressora desligada" }]);
  });

  it("imprime a conta da mesa a partir da cópia dos itens", async () => {
    mocks.batches = [
      [
        {
          id: "job-3",
          tipo: "conta",
          mesa_id: "mesa-1",
          dados: {
            mesa_numero: 7,
            itens: [
              { id: "i1", produto: "Pizza", quantidade: 2, valor_unitario: 40, garcom: "Ana" },
            ],
          },
        },
      ],
    ];
    startPrintQueue({ id: "u1", name: "Caixa" });
    await settle();
    await tick();
    expect(mocks.imprimirNota).toHaveBeenCalledTimes(1);
    const receipt = mocks.imprimirNota.mock.calls[0]![0] as {
      id: string;
      table: number;
      lines: { name: string; qty: number; price: number }[];
    };
    expect(receipt.id).toBe("fila-job-3");
    expect(receipt.table).toBe(7);
    expect(receipt.lines).toMatchObject([{ name: "Pizza", qty: 2, price: 40 }]);
    expect(concluded()[0]).toMatchObject({ p_id: "job-3", p_ok: true });
  });

  it("navegador sem impressora direta não reserva trabalhos (abriria a caixa de diálogo)", async () => {
    mocks.config = { printKitchenEnabled: true, connection: "navegador" };
    startPrintQueue({ id: "u1", name: "Caixa" });
    await settle();
    await tick();
    expect(getQueueState().canPrint).toBe(false);
    expect(mocks.rpc.mock.calls.some(([name]) => name === "reservar_impressao")).toBe(false);
  });

  it("impressora que não existe/responde: não reserva comandas neste aparelho", async () => {
    mocks.printer = {
      connected: false,
      reachable: false,
      label: "Impressora do Windows",
      error: "Nenhuma impressora instalada neste computador.",
    };
    startPrintQueue({ id: "u1", name: "Caixa" });
    await settle();
    await tick();
    expect(getQueueState().canPrint).toBe(false);
    expect(mocks.rpc.mock.calls.some(([name]) => name === "reservar_impressao")).toBe(false);
  });

  it("lista como não impressas as que falharam e as pendentes com mais de 3 horas", () => {
    const now = Date.now();
    const job = (id: string, status: QueueJob["status"], ageMs: number): QueueJob => ({
      id,
      type: "cozinha",
      status,
      attempts: 0,
      error: null,
      createdAt: now - ageMs,
      releasedAt: now - ageMs,
      printedAt: null,
      station: null,
      label: id,
    });
    const jobs = [
      job("recente", "pendente", 60_000),
      job("antiga", "pendente", 4 * 60 * 60 * 1000),
      job("falhou", "falhou", 60_000),
      job("ok", "impresso", 60_000),
    ];
    expect(unprintedJobs(jobs, now).map((entry) => entry.id)).toEqual(["antiga", "falhou"]);
  });
});
