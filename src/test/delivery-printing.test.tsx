import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  events: [] as string[],
  rpc: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  useNavigate: () => vi.fn(),
}));
vi.mock("@/components/ui-kit", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Btn: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props} />
  ),
  Field: ({ label, children }: { label: string; children: ReactNode }) => (
    <label>
      {label}
      {children}
    </label>
  ),
}));
vi.mock("@/components/menu-picker", () => ({ MenuPicker: () => null }));
vi.mock("@/components/payment-dialog", () => ({ PaymentDialog: () => null }));
vi.mock("@/components/app-select", () => ({ AppSelect: () => null }));
vi.mock("@/components/system-dialog-provider", () => ({ usePrompt: () => vi.fn(async () => "") }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: vi.fn() } }));
vi.mock("@/lib/store", () => {
  const snapshot = {
    loading: false,
    user: { id: "u1", role: "caixa", username: "caixa" },
    restaurant: { deliveryFee: 5 },
  };
  return {
    useStore: (select: (state: typeof snapshot) => unknown) => select(snapshot),
    brl: (value: number) => `R$ ${value.toFixed(2)}`,
    errorMessage: (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
  };
});
vi.mock("@/lib/supabase", () => {
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    supabase: {
      from: () => ({
        select: () => ({
          order: () => ({
            limit: async () => ({ data: mocks.rows.map((row) => ({ ...row })), error: null }),
          }),
        }),
      }),
      channel: () => channel,
      removeChannel: vi.fn(),
      rpc: mocks.rpc,
    },
  };
});

import { Route } from "@/routes/delivery";
import { defaultConfig, resetConfigCache, saveConfig } from "@/lib/printing/config";
import { resetPrinterForTests } from "@/lib/printing/printer";

const Delivery = (Route as unknown as { options: { component: () => ReactNode } }).options
  .component;

let rowSeq = 0;
function deliveryRow() {
  rowSeq += 1;
  return {
    id: `pedido-${rowSeq}`,
    numero_dia: 7,
    canal: "whatsapp",
    tipo: "entrega",
    cliente_nome: "Maria",
    telefone: "11999990000",
    endereco: "Rua A, 10",
    observacao: "",
    subtotal: 30,
    taxa_entrega: 5,
    total: 35,
    status: "novo",
    criado_em: new Date().toISOString(),
    entregador: "",
    pagamento_previsto: { forma: "pix", pago: false, troco_para: null },
    itens: [{ produto: "Pizza", quantidade: 1, observacao: "sem cebola", valor_unitario: 30 }],
  };
}

function agent(printOk: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      mocks.events.push(`agente:${path}`);
      const ok = path !== "/print" || printOk;
      return {
        ok,
        status: ok ? 200 : 502,
        json: async () =>
          ok
            ? { ok: true }
            : { ok: false, mensagem: "Não foi possível conectar à impressora em 10.0.0.9:9100." },
      };
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
  resetConfigCache();
  resetPrinterForTests();
  mocks.rows = [deliveryRow()];
  mocks.events = [];
  mocks.toastError.mockReset();
  mocks.rpc.mockReset().mockImplementation(async (name: string, args: Record<string, unknown>) => {
    mocks.events.push(`rpc:${name}:${String(args["p_status"])}`);
    if (name === "atualizar_status_pedido_externo") mocks.rows[0]!["status"] = args["p_status"];
    return { data: null, error: null };
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Delivery: impressão ao avançar para Em preparo", () => {
  it("grava o status primeiro e imprime uma única vez", async () => {
    saveConfig({
      ...defaultConfig(),
      connection: "rede",
      ip: "10.0.0.9",
      autoPrintOnPreparing: true,
    });
    agent(true);
    render(<Delivery />);
    fireEvent.click(await screen.findByRole("button", { name: /Avançar: Em preparo/ }));
    await waitFor(() => expect(mocks.events).toContain("agente:/print"));
    expect(mocks.events.indexOf("rpc:atualizar_status_pedido_externo:em_preparo")).toBeLessThan(
      mocks.events.indexOf("agente:/print"),
    );
    fireEvent.click(await screen.findByRole("button", { name: /Avançar: Pronto/ }));
    await waitFor(() =>
      expect(mocks.events).toContain("rpc:atualizar_status_pedido_externo:pronto"),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.events.filter((event) => event === "agente:/print")).toHaveLength(1);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("com a impressora desligada, o status muda e aparece o erro com Reimprimir", async () => {
    saveConfig({
      ...defaultConfig(),
      connection: "rede",
      ip: "10.0.0.9",
      autoPrintOnPreparing: true,
    });
    agent(false);
    render(<Delivery />);
    fireEvent.click(await screen.findByRole("button", { name: /Avançar: Em preparo/ }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    const [title, options] = mocks.toastError.mock.calls[0] as [
      string,
      { description?: string; action?: { label: string } },
    ];
    expect(title).toBe("Pedido #7 está em preparo, mas não imprimiu");
    expect(options.description).toBe("Não foi possível conectar à impressora em 10.0.0.9:9100.");
    expect(options.action?.label).toBe("Reimprimir");
    // O status foi gravado e nada tentou desfazê-lo.
    expect(
      mocks.rpc.mock.calls.map(([, args]) => (args as Record<string, unknown>)["p_status"]),
    ).toEqual(["em_preparo"]);
    expect(await screen.findByRole("button", { name: /Avançar: Pronto/ })).toBeInTheDocument();
  });

  it("não imprime ao avançar quando a opção está desligada", async () => {
    saveConfig({
      ...defaultConfig(),
      connection: "rede",
      ip: "10.0.0.9",
      autoPrintOnPreparing: false,
    });
    agent(true);
    render(<Delivery />);
    fireEvent.click(await screen.findByRole("button", { name: /Avançar: Em preparo/ }));
    await waitFor(() =>
      expect(mocks.events).toContain("rpc:atualizar_status_pedido_externo:em_preparo"),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.events).not.toContain("agente:/print");
  });
});
