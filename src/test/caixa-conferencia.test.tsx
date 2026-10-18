import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderLine, State, Status } from "@/lib/store";
import type { PrintReceipt } from "@/lib/printing";

const h = vi.hoisted(() => {
  let state: unknown = null;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set: (next: unknown) => {
      state = next;
      subs.forEach((notify) => notify());
    },
    subs,
    actions: {
      requestBill: vi.fn(async () => undefined),
      closeBill: vi.fn(),
      cleanKitchenOrders: vi.fn(async () => undefined),
      paymentSummary: vi.fn(async () => []),
      originSummary: vi.fn(async () => []),
      removeLine: vi.fn(),
      addLine: vi.fn(),
      addLines: vi.fn(),
    },
    printConference: vi.fn(),
    printReceipt: vi.fn(),
  };
});

vi.mock("@/lib/supabase", () => ({
  supabase: {},
  supabaseConfigured: true,
  usernameEmail: (username: string) => `${username}@mesari.local`,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));

vi.mock("@/lib/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/store")>();
  const { useSyncExternalStore } = await import("react");
  return {
    ...actual,
    actions: h.actions,
    useStore: <T,>(select: (snapshot: State) => T) =>
      useSyncExternalStore(
        (notify) => {
          h.subs.add(notify);
          return () => h.subs.delete(notify);
        },
        () => select(h.get() as State),
      ),
  };
});

vi.mock("@/lib/printing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/printing")>();
  return { ...actual, printConference: h.printConference, printReceipt: h.printReceipt };
});

vi.mock("@/components/ui-kit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui-kit")>();
  return { ...actual, AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div> };
});

import { Route } from "@/routes/caixa";
import { BillRequestPrintStation } from "@/components/bill-request-print-station";
import { getDefaultPrintSettings, savePrintSettings } from "@/lib/printing";
import { resetConferencesForTests } from "@/lib/conference";
import { SystemDialogProvider } from "@/components/system-dialog-provider";

const CaixaPage = (Route as unknown as { options: { component: ComponentType } }).options.component;
const Caixa = () => (
  <SystemDialogProvider>
    <CaixaPage />
  </SystemDialogProvider>
);

const line = (id: string, name: string, qty: number, price: number): OrderLine => ({
  id,
  itemId: `item-${id}`,
  name,
  qty,
  price,
  note: "",
  at: 0,
  waiter: "Ana",
});

function makeState(status: Status, lines: OrderLine[]): State {
  return {
    user: { id: "u1", username: "caixa", name: "Caixa", role: "caixa" },
    staff: [],
    restaurant: {
      name: "Mesari",
      phone: "",
      address: "",
      cnpj: "",
      instagram: "",
      logo: "",
      serviceChargeEnabled: true,
      serviceChargePercent: 10,
      deliveryFee: 0,
    },
    tables: [{ id: "t1", number: 3, seats: 4, x: 0, y: 0, status, active: true }],
    categories: [],
    items: [],
    orders: { t1: lines },
    history: [],
    loading: false,
    configured: true,
    connection: "connected",
    error: null,
    orderSentMesaId: null,
  };
}

const firstLines = [line("l1", "Café", 2, 5), line("l2", "Pão de queijo", 1, 8)];

function setTable(status: Status, lines: OrderLine[]) {
  act(() => h.set(makeState(status, lines)));
}

function openTable() {
  fireEvent.click(screen.getByRole("button", { name: /^Mesa 3,/ }));
}

beforeEach(() => {
  resetConferencesForTests();
  localStorage.clear();
  vi.clearAllMocks();
  h.printConference.mockResolvedValue({ method: "simulacao" });
  h.actions.closeBill.mockResolvedValue({ id: "sale-1", table: 3, saleNumber: 7 });
  h.set(makeState("ocupada", firstLines));
});

afterEach(() => {
  localStorage.clear();
});

describe("caixa: conferência de consumo separada do pagamento", () => {
  it("Imprimir conta imprime a conferência, pede a conta e não fecha a mesa", async () => {
    render(<Caixa />);
    openTable();
    fireEvent.click(screen.getByRole("button", { name: "Imprimir conta" }));

    await waitFor(() => expect(h.actions.requestBill).toHaveBeenCalledWith("t1"));
    expect(h.printConference).toHaveBeenCalledOnce();
    const receipt = h.printConference.mock.calls[0]?.[0] as PrintReceipt;
    expect(receipt).toMatchObject({
      kind: "conferencia",
      table: 3,
      subtotal: 18,
      serviceCharge: 1.8,
      total: 19.8,
      splitCount: 1,
    });
    expect(receipt.payments).toBeUndefined();
    expect(h.actions.closeBill).not.toHaveBeenCalled();
    expect(h.printReceipt).not.toHaveBeenCalled();
  });

  it("não pede a conta de novo quando a mesa já está em conta e envia a divisão", async () => {
    h.set(makeState("conta", firstLines));
    render(<Caixa />);
    openTable();
    fireEvent.change(screen.getByRole("spinbutton", { name: /Dividir a conta/ }), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Imprimir conta" }));

    await waitFor(() => expect(h.printConference).toHaveBeenCalledOnce());
    expect(h.printConference.mock.calls[0]?.[0]).toMatchObject({ splitCount: 4 });
    expect(h.actions.requestBill).not.toHaveBeenCalled();
    expect(h.actions.closeBill).not.toHaveBeenCalled();
  });

  it("avisa que a conta mudou quando itens entram ou saem depois da impressão", async () => {
    render(<Caixa />);
    openTable();
    expect(screen.queryByText(/A conta mudou depois da impressão/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Imprimir conta" }));
    await waitFor(() => expect(h.actions.requestBill).toHaveBeenCalled());
    setTable("conta", firstLines);
    expect(screen.queryByText(/A conta mudou depois da impressão/)).not.toBeInTheDocument();

    setTable("conta", [...firstLines, line("l3", "Suco", 1, 9)]);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A conta mudou depois da impressão. Reimprima antes de receber.",
    );

    // Saiu o item novo: volta a bater com o que foi impresso.
    setTable("conta", firstLines);
    expect(screen.queryByText(/A conta mudou depois da impressão/)).not.toBeInTheDocument();

    setTable("conta", [firstLines[0]!]);
    expect(screen.getByText(/A conta mudou depois da impressão/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Imprimir conta" }));
    await waitFor(() =>
      expect(screen.queryByText(/A conta mudou depois da impressão/)).not.toBeInTheDocument(),
    );
  });

  it("Receber pagamento funciona sem conferência, fecha a conta e não imprime nada", async () => {
    render(<Caixa />);
    openTable();
    fireEvent.click(screen.getByRole("button", { name: "Receber pagamento" }));
    fireEvent.click(screen.getByRole("button", { name: "Pix" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pagamento" }));

    await waitFor(() =>
      expect(h.actions.closeBill).toHaveBeenCalledWith("t1", [{ forma: "pix", valor: 19.8 }]),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /Pagamento/ })).not.toBeInTheDocument(),
    );
    expect(h.printConference).not.toHaveBeenCalled();
    expect(h.printReceipt).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: /Conta –/ })).not.toBeInTheDocument();
  });
});

describe("estação do caixa: conferência quando o garçom pede a conta", () => {
  it("imprime quando a mesa passa para conta, sem repetir se os itens não mudaram", async () => {
    render(<BillRequestPrintStation />);
    setTable("conta", firstLines);
    await waitFor(() => expect(h.printConference).toHaveBeenCalledOnce());
    expect(h.printConference.mock.calls[0]?.[0]).toMatchObject({
      kind: "conferencia",
      total: 19.8,
    });

    // Volta a ocupada e pede de novo sem mudar nada: não reimprime.
    setTable("ocupada", firstLines);
    setTable("conta", firstLines);
    await act(async () => undefined);
    expect(h.printConference).toHaveBeenCalledOnce();

    // Com item novo, imprime a conferência atualizada.
    setTable("ocupada", [...firstLines, line("l3", "Suco", 1, 9)]);
    setTable("conta", [...firstLines, line("l3", "Suco", 1, 9)]);
    await waitFor(() => expect(h.printConference).toHaveBeenCalledTimes(2));
    expect(h.actions.closeBill).not.toHaveBeenCalled();
  });

  it("não imprime mesas que já estavam em conta ao abrir a tela", async () => {
    h.set(makeState("conta", firstLines));
    render(<BillRequestPrintStation />);
    setTable("conta", firstLines);
    await act(async () => undefined);
    expect(h.printConference).not.toHaveBeenCalled();
  });

  it("não imprime sozinho com a opção desligada", async () => {
    savePrintSettings({ ...getDefaultPrintSettings(), autoPrintConferenceOnRequest: false });
    render(<BillRequestPrintStation />);
    setTable("conta", firstLines);
    await act(async () => undefined);
    expect(h.printConference).not.toHaveBeenCalled();
  });

  it("não reimprime quando o próprio caixa imprimiu a conta antes de pedir", async () => {
    render(
      <>
        <Caixa />
        <BillRequestPrintStation />
      </>,
    );
    openTable();
    fireEvent.click(screen.getByRole("button", { name: "Imprimir conta" }));
    await waitFor(() => expect(h.actions.requestBill).toHaveBeenCalled());
    setTable("conta", firstLines);
    await act(async () => undefined);
    expect(h.printConference).toHaveBeenCalledOnce();
  });
});
