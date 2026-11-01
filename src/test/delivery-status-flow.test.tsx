import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { State } from "@/lib/store";

// Banco falso de pedidos_externos: só aceita os status que o banco real aceita.
const h = vi.hoisted(() => {
  const accepted = ["novo", "preparo", "pronto", "saiu", "cancelado"];
  const db = { rows: [] as Record<string, unknown>[], offline: false };
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    if (db.offline) return { data: null, error: { message: "Failed to fetch" } };
    if (fn !== "atualizar_status_pedido_externo") return { data: null, error: null };
    const status = String(args["p_status"]);
    const row = db.rows.find((entry) => entry["id"] === args["p_id"]);
    if (!accepted.includes(status)) {
      return {
        data: null,
        error: { message: "Para concluir o pedido, use o pagamento (concluir_pedido_externo)" },
      };
    }
    if (status === "saiu" && row?.["tipo"] !== "entrega") {
      return { data: null, error: { message: "saiu só para entrega" } };
    }
    if (status === "cancelado" && !String(args["p_motivo"] ?? "").trim()) {
      return { data: null, error: { message: "motivo obrigatório" } };
    }
    if (row) row["status"] = status;
    return { data: null, error: null };
  });
  const query = () => {
    const chain = {
      select: () => chain,
      order: () => chain,
      limit: () => Promise.resolve({ data: db.rows.map((row) => ({ ...row })), error: null }),
    };
    return chain;
  };
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    db,
    rpc,
    supabase: {
      rpc,
      from: query,
      channel: () => channel,
      removeChannel: async () => "ok",
    },
    printKitchenTicket: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  };
});

vi.mock("@/lib/supabase", () => ({
  supabase: h.supabase,
  supabaseConfigured: true,
  usernameEmail: (username: string) => `${username}@mesari.local`,
}));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/lib/printing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/printing")>();
  return { ...actual, printKitchenTicket: h.printKitchenTicket };
});
vi.mock("@/components/ui-kit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui-kit")>();
  return { ...actual, AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div> };
});
vi.mock("@/lib/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/store")>();
  const state = {
    user: { id: "u1", username: "caixa", name: "Caixa", role: "caixa" },
    loading: false,
    restaurant: { deliveryFee: 6, name: "Sabor do Agreste" },
    categories: [],
    items: [],
  } as unknown as State;
  return { ...actual, useStore: <T,>(select: (snapshot: State) => T) => select(state) };
});

import { Route } from "@/routes/delivery";
import { SystemDialogProvider } from "@/components/system-dialog-provider";
import { resetNotifiedForTests } from "@/lib/whatsapp-notify";

const DeliveryPage = (Route as unknown as { options: { component: ComponentType } }).options
  .component;

function order(
  id: string,
  numero: number,
  tipo: "entrega" | "retirada",
  status: string,
  telefone = "",
) {
  return {
    id,
    numero_dia: numero,
    tipo,
    canal: "whatsapp",
    status,
    cliente_nome: `Cliente ${numero}`,
    telefone,
    pagamento_previsto: { forma: "pix", pago: false, troco_para: null },
    endereco: tipo === "entrega" ? "Rua A, 1" : "",
    observacao: "",
    subtotal: 30,
    taxa_entrega: tipo === "entrega" ? 6 : 0,
    total: tipo === "entrega" ? 36 : 30,
    criado_em: new Date().toISOString(),
    itens: [{ produto: "Baião de dois", quantidade: 1, valor_unitario: 30 }],
  };
}

/** Coluna do quadro onde o pedido está agora. */
function columnOf(numero: number) {
  const card = screen.getByText(`#${numero}`).closest("article")!;
  return card.closest("section")!.querySelector("h2")!.textContent?.trim();
}

function card(numero: number) {
  return within(screen.getByText(`#${numero}`).closest("article")!);
}

async function renderBoard() {
  render(
    <SystemDialogProvider>
      <DeliveryPage />
    </SystemDialogProvider>,
  );
  await screen.findByRole("heading", { name: "Pedidos Delivery" });
  await waitFor(() => expect(screen.queryByText("Carregando pedidos...")).toBeNull());
}

beforeEach(() => {
  localStorage.clear();
  resetNotifiedForTests();
  delete (window as { mesariDesktop?: unknown }).mesariDesktop;
  h.db.rows = [];
  h.db.offline = false;
  h.rpc.mockClear();
  h.printKitchenTicket.mockClear();
  h.toast.success.mockClear();
  h.toast.error.mockClear();
  h.toast.warning.mockClear();
});

describe("fluxo de status do delivery", () => {
  it("entrega: Novo → Em preparo → Pronto → Saiu → só Concluir e receber", async () => {
    h.db.rows = [order("e1", 12, "entrega", "novo")];
    await renderBoard();
    expect(columnOf(12)).toBe("Novo");

    fireEvent.click(card(12).getByRole("button", { name: /Avançar: Em preparo/ }));
    await waitFor(() => expect(columnOf(12)).toBe("Em preparo"));
    expect(h.rpc).toHaveBeenLastCalledWith("atualizar_status_pedido_externo", {
      p_id: "e1",
      p_status: "preparo",
      p_entregador: null,
      p_motivo: null,
    });

    fireEvent.click(card(12).getByRole("button", { name: /Avançar: Pronto/ }));
    await waitFor(() => expect(columnOf(12)).toBe("Pronto"));

    fireEvent.click(card(12).getByRole("button", { name: /Saiu para entrega/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Cícero" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar saída" }));
    await waitFor(() => expect(columnOf(12)).toBe("Saiu para entrega"));
    expect(h.rpc).toHaveBeenLastCalledWith(
      "atualizar_status_pedido_externo",
      expect.objectContaining({ p_status: "saiu", p_entregador: "Cícero" }),
    );

    expect(card(12).queryByRole("button", { name: /Avançar/ })).toBeNull();
    expect(card(12).getByRole("button", { name: /Concluir e receber/ })).toBeEnabled();
    expect(h.toast.error).not.toHaveBeenCalled();
    expect(h.printKitchenTicket).not.toHaveBeenCalled();
  });

  it("retirada: Novo → Em preparo → Pronto → só Concluir e receber, sem 'Saiu'", async () => {
    h.db.rows = [order("r1", 13, "retirada", "novo")];
    await renderBoard();

    fireEvent.click(card(13).getByRole("button", { name: /Avançar: Em preparo/ }));
    await waitFor(() => expect(columnOf(13)).toBe("Em preparo"));
    fireEvent.click(card(13).getByRole("button", { name: /Avançar: Pronto/ }));
    await waitFor(() => expect(columnOf(13)).toBe("Pronto"));

    expect(card(13).queryByRole("button", { name: /Avançar|Saiu/ })).toBeNull();
    expect(card(13).getByRole("button", { name: /Concluir e receber/ })).toBeEnabled();
  });

  it("pedido que o banco já gravou como 'preparo' aparece em Em preparo", async () => {
    h.db.rows = [order("p1", 14, "entrega", "preparo")];
    await renderBoard();
    expect(columnOf(14)).toBe("Em preparo");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("sem internet: não muda o card, não imprime e mostra mensagem amigável", async () => {
    h.db.rows = [order("e2", 15, "entrega", "novo")];
    await renderBoard();
    h.db.offline = true;
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    fireEvent.click(card(15).getByRole("button", { name: /Avançar: Em preparo/ }));
    await waitFor(() =>
      expect(h.toast.error).toHaveBeenCalledWith(
        "Não foi possível mudar o status do pedido. Tente novamente.",
      ),
    );
    expect(columnOf(15)).toBe("Novo");
    expect(h.printKitchenTicket).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent(
      /atualizar_status|pedidos_externos|Failed to fetch/,
    );
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("clique duplo no Avançar muda o status uma vez só", async () => {
    h.db.rows = [order("e3", 16, "entrega", "novo")];
    await renderBoard();
    const button = card(16).getByRole("button", { name: /Avançar: Em preparo/ });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await waitFor(() => expect(columnOf(16)).toBe("Em preparo"));
    expect(
      h.rpc.mock.calls.filter(([fn]) => fn === "atualizar_status_pedido_externo"),
    ).toHaveLength(1);
  });

  it("cancelar sem motivo pede o motivo e não chama o banco", async () => {
    h.db.rows = [order("e4", 17, "entrega", "novo")];
    await renderBoard();
    fireEvent.click(card(17).getByRole("button", { name: "Cancelar" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar pedido" }));

    expect(await within(dialog).findByText("Este campo é obrigatório.")).toBeInTheDocument();
    expect(h.rpc).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "Cliente desistiu" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar pedido" }));
    await waitFor(() =>
      expect(h.rpc).toHaveBeenCalledWith("atualizar_status_pedido_externo", {
        p_id: "e4",
        p_status: "cancelado",
        p_entregador: null,
        p_motivo: "Cliente desistiu",
      }),
    );
    await waitFor(() => expect(screen.queryByText("#17")).toBeNull());
  });
});

describe("aviso ao cliente pelo WhatsApp", () => {
  const phone = "81997218844";

  it("entrega: ao sair, oferece avisar; abre o WhatsApp Web na aba nomeada e marca Cliente avisado", async () => {
    h.db.rows = [order("w1", 21, "entrega", "pronto", phone)];
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await renderBoard();

    fireEvent.click(card(21).getByRole("button", { name: /Saiu para entrega/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar saída" }));
    await waitFor(() => expect(columnOf(21)).toBe("Saiu para entrega"));

    // Logo em seguida: faixa com o botão destacado, e o botão também no card.
    const banner = await screen.findByText(/Pedido #21 saiu para entrega\./);
    expect(banner.closest("[role=status]")).not.toBeNull();
    expect(card(21).queryByText("Cliente avisado")).toBeNull();
    fireEvent.click(card(21).getByRole("button", { name: /Avisar cliente no WhatsApp/ }));

    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    const [url, target] = open.mock.calls[0]!;
    expect(String(url)).toMatch(/^https:\/\/web\.whatsapp\.com\/send\?phone=5581997218844&text=/);
    expect(new URL(String(url)).searchParams.get("text")).toBe(
      "Olá, Cliente 21! Seu pedido #21 do Sabor do Agreste saiu para entrega. Total: R$ 36,00. Pagamento: Pix.",
    );
    expect(target).toBe("mesari-whatsapp");
    expect(await card(21).findByText("Cliente avisado")).toBeInTheDocument();
    expect(screen.queryByText(/Pedido #21 saiu para entrega\./)).toBeNull();
    open.mockRestore();
  });

  it("retirada pronta: Avisar que está pronto, nunca saiu para entrega", async () => {
    h.db.rows = [order("w2", 22, "retirada", "preparo", phone)];
    await renderBoard();
    fireEvent.click(card(22).getByRole("button", { name: /Avançar: Pronto/ }));
    await waitFor(() => expect(columnOf(22)).toBe("Pronto"));

    expect(card(22).getByRole("button", { name: /Avisar que está pronto/ })).toBeInTheDocument();
    expect(screen.getByText(/Pedido #22 está pronto para retirada\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Avisar cliente no WhatsApp/ })).toBeNull();
    expect(screen.queryByText(/saiu para entrega\./)).toBeNull();
  });

  it("em preparo: botão discreto Avisar: pedido confirmado", async () => {
    h.db.rows = [order("w3", 23, "entrega", "preparo", phone)];
    await renderBoard();
    expect(card(23).getByRole("button", { name: /Avisar: pedido confirmado/ })).toBeInTheDocument();
  });

  it("pedido sem telefone não mostra botão de WhatsApp", async () => {
    h.db.rows = [
      order("w4", 24, "entrega", "saiu"),
      order("w5", 25, "retirada", "pronto"),
      order("w6", 26, "entrega", "preparo"),
    ];
    await renderBoard();
    expect(screen.queryByRole("button", { name: /Avisar/ })).toBeNull();
  });

  it("no app desktop abre direto no WhatsApp instalado, sem abrir guia", async () => {
    const openWhatsApp = vi.fn(async (_phone: string, _text: string) => ({ ok: true }));
    (window as { mesariDesktop?: unknown }).mesariDesktop = { isDesktop: true, openWhatsApp };
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    h.db.rows = [order("w7", 27, "retirada", "pronto", phone)];
    await renderBoard();

    fireEvent.click(card(27).getByRole("button", { name: /Avisar que está pronto/ }));
    await waitFor(() => expect(openWhatsApp).toHaveBeenCalledTimes(1));
    expect(openWhatsApp.mock.calls[0]).toEqual([
      "81997218844",
      "Olá, Cliente 27! Seu pedido #27 já está pronto para retirada no Sabor do Agreste.",
    ]);
    expect(open).not.toHaveBeenCalled();
    expect(h.toast.warning).not.toHaveBeenCalled();
    expect(await card(27).findByText("Cliente avisado")).toBeInTheDocument();
    open.mockRestore();
  });

  it("app do WhatsApp não instalado: avisa e abre pelo navegador", async () => {
    const openWhatsApp = vi.fn(async () => ({ ok: false, error: "WhatsApp não encontrado." }));
    (window as { mesariDesktop?: unknown }).mesariDesktop = { isDesktop: true, openWhatsApp };
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    h.db.rows = [order("w8", 28, "retirada", "pronto", phone)];
    await renderBoard();

    fireEvent.click(card(28).getByRole("button", { name: /Avisar que está pronto/ }));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(String(open.mock.calls[0]![0])).toMatch(/^https:\/\/web\.whatsapp\.com\/send\?/);
    expect(open.mock.calls[0]![1]).toBe("mesari-whatsapp");
    expect(h.toast.warning).toHaveBeenCalledWith(
      "WhatsApp não encontrado neste PC. Abrindo pelo navegador.",
    );
    expect(await card(28).findByText("Cliente avisado")).toBeInTheDocument();
    open.mockRestore();
  });

  it("no desktop com WhatsApp Web escolhido, usa a aba nomeada", async () => {
    const openWhatsApp = vi.fn(async () => ({ ok: true }));
    (window as { mesariDesktop?: unknown }).mesariDesktop = { isDesktop: true, openWhatsApp };
    localStorage.setItem("mesari-whatsapp-modo", "web");
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    h.db.rows = [order("w9", 29, "retirada", "pronto", phone)];
    await renderBoard();

    fireEvent.click(card(29).getByRole("button", { name: /Avisar que está pronto/ }));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(open.mock.calls[0]![1]).toBe("mesari-whatsapp");
    expect(openWhatsApp).not.toHaveBeenCalled();
    open.mockRestore();
  });
});
