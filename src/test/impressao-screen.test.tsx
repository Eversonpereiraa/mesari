import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/components/app-select", () => ({
  AppSelect: ({ ariaLabel, placeholder }: { ariaLabel?: string; placeholder?: string }) => (
    <select aria-label={ariaLabel ?? placeholder} />
  ),
}));
vi.mock("@/lib/store", () => {
  const snapshot = { user: { role: "caixa" }, restaurant: { name: "Cantina" } };
  return {
    useStore: (select: (state: typeof snapshot) => unknown) => select(snapshot),
    errorMessage: (cause: unknown) => String(cause),
  };
});
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
    }),
  },
}));

import { Route } from "@/routes/impressao";
import { loadConfig, resetConfigCache } from "@/lib/printing/config";
import { resetPrinterForTests } from "@/lib/printing/printer";

const Impressao = (Route as unknown as { options: { component: () => ReactNode } }).options
  .component;

beforeEach(() => {
  localStorage.clear();
  resetConfigCache();
  resetPrinterForTests();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("tela Impressão", () => {
  it("mostra as conexões indisponíveis desabilitadas com o motivo", async () => {
    render(<Impressao />);
    const serial = await screen.findByRole("radio", { name: /USB \(Web Serial\)/ });
    expect(serial).toBeDisabled();
    expect(serial).toHaveTextContent("Web Serial não é suportado neste navegador");
    expect(screen.getByRole("radio", { name: /^Bluetooth/ })).toHaveTextContent(
      "Bluetooth não é suportado neste navegador",
    );
    expect(screen.queryByRole("radio", { name: /app Android/ })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Navegador" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("ao escolher Rede, pede o IP e mostra que o agente não foi encontrado", async () => {
    render(<Impressao />);
    fireEvent.click(await screen.findByRole("radio", { name: /Rede \(IP\)/ }));
    expect(loadConfig().connection).toBe("rede");
    expect(screen.getByPlaceholderText("192.168.0.50")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Não encontrado")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Como instalar o agente" })).toHaveAttribute(
      "href",
      "#instalar-agente",
    );
  });

  it("salva largura, codepage e opções neste aparelho", async () => {
    render(<Impressao />);
    expect(await screen.findByText("Configurações")).toBeInTheDocument();
    expect(loadConfig()).toMatchObject({ paperWidth: 80, codepage: "CP850", autoCut: true });
    fireEvent.click(screen.getByRole("switch", { name: /Abrir gaveta ao concluir pagamento/ }));
    expect(loadConfig().openDrawerOnPayment).toBe(true);
    expect(JSON.parse(localStorage.getItem("mesari-impressora") ?? "{}")).toMatchObject({
      openDrawerOnPayment: true,
    });
  });
});
