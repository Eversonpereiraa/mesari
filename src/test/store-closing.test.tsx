import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>[]>,
  errors: {} as Record<string, { code?: string; message: string }>,
  calls: [] as { table: string; method: string; args: unknown[] }[],
  session: null as null | { user: { id: string; email: string } },
  auth: {
    getSession: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    onAuthStateChange: vi.fn(),
    setSession: vi.fn(),
  },
  from: vi.fn(),
  rpc: vi.fn(),
  channel: vi.fn(),
  removeChannel: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: mocks,
  supabaseConfigured: true,
  usernameEmail: (username: string) => `${username.trim().toLowerCase()}@mesari.local`,
}));

import {
  actions,
  categorySectorOptions,
  parseCategorySector,
  refreshData,
  tableStatus,
  useStore,
  type MenuItem,
} from "@/lib/store";

const item: MenuItem = {
  id: "item-1",
  name: "Prato cadastrado",
  categoryId: "category-1",
  price: 25,
  description: "",
  active: true,
  order: 0,
};

function makeQuery(table: string) {
  let operation = "select";
  let values: unknown;
  let selection: unknown;
  let filters: [string, unknown][] = [];

  const execute = () => {
    mocks.calls.push({ table, method: operation, args: [values ?? selection, ...filters] });
    const matchingRows = (mocks.rows[table] ?? []).filter((row) =>
      filters.every(([column, value]) => row[column] === value),
    );
    return {
      data: operation === "insert" && values ? values : matchingRows,
      error: mocks.errors[table] ?? null,
    };
  };

  const query: Record<string, unknown> = {
    select: (...args: unknown[]) => {
      selection = args[0];
      if (operation !== "select") mocks.calls.push({ table, method: "select", args });
      return query;
    },
    insert: (input: unknown) => {
      operation = "insert";
      values = input;
      return query;
    },
    update: (input: unknown) => {
      operation = "update";
      values = input;
      return query;
    },
    upsert: (input: unknown) => {
      operation = "upsert";
      values = input;
      return query;
    },
    delete: () => {
      operation = "delete";
      return query;
    },
    eq: (column: string, value: unknown) => {
      filters = [...filters, [column, value]];
      return query;
    },
    in: (column: string, value: unknown[]) => {
      filters = [...filters, [column, value]];
      return query;
    },
    order: () => query,
    limit: () => query,
    maybeSingle: async () => {
      const result = execute();
      return {
        ...result,
        data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data,
      };
    },
    single: async () => {
      const result = execute();
      return {
        ...result,
        data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data,
      };
    },
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve(execute()).then(resolve, reject),
  };
  return query;
}

const authenticatedSession = { user: { id: "profile-1", email: "caixa@mesari.local" } };
const sale = {
  id: "sale-1",
  numero: 42,
  mesa_numero: 16,
  itens: [
    {
      id: "line-1",
      produto_id: item.id,
      produto_nome: item.name,
      quantidade: 2,
      valor_unitario: 25,
      observacao: "Sem pimenta",
      garcom_id: "profile-2",
      garcom_nome: "Carlos",
      criado_em: "2026-10-08T10:00:00.000Z",
    },
  ],
  subtotal: 50,
  taxa_servico: 5,
  total: 55,
  pagamentos: [
    { forma: "pix", valor: 30 },
    { forma: "dinheiro", valor: 25, recebido: 30, troco: 5 },
  ],
  fechada_em: "2026-10-08T10:15:00.000Z",
};

beforeEach(async () => {
  mocks.rows = {};
  mocks.errors = {};
  mocks.calls = [];
  mocks.session = null;
  mocks.auth.getSession.mockImplementation(async () => ({
    data: { session: mocks.session },
    error: null,
  }));
  mocks.auth.signInWithPassword.mockImplementation(async (credentials: { email: string }) => {
    mocks.session = {
      user: { id: "profile-1", email: credentials.email },
    };
    return { data: { user: mocks.session.user }, error: null };
  });
  mocks.auth.signOut.mockResolvedValue({ error: null });
  mocks.auth.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  });
  mocks.auth.setSession.mockResolvedValue({ error: null });
  mocks.from.mockImplementation((table: string) => makeQuery(table));
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.channel.mockReturnValue({
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
  });
  mocks.removeChannel.mockResolvedValue("ok");
  await refreshData();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("integração do store com o schema existente", () => {
  it("carrega status direto de mesas e perfis de profiles", async () => {
    mocks.session = authenticatedSession;
    mocks.rows["profiles"] = [
      { id: "profile-1", usuario: "caixa", nome: "Caixa", papel: "caixa", ativo: true },
      { id: "profile-2", usuario: "carlos", nome: "Carlos", papel: "garcom", ativo: true },
    ];
    mocks.rows["mesas"] = [
      {
        id: "table-1",
        numero: 16,
        lugares: 4,
        status: "conta",
        ativa: true,
        pos_x: 20,
        pos_y: 30,
      },
    ];
    mocks.rows["restaurante"] = [
      {
        id: 1,
        nome: "Mesari",
        taxa_servico_ativa: true,
        taxa_servico_percentual: 10,
      },
    ];

    await act(async () => refreshData());
    const { result } = renderHook(() => useStore((snapshot) => snapshot));

    expect(result.current.user).toMatchObject({ id: "profile-1", role: "caixa" });
    expect(result.current.staff).toEqual([
      { id: "profile-2", username: "carlos", name: "Carlos", role: "garcom", active: true },
    ]);
    expect(tableStatus(result.current, "table-1")).toBe("conta");
    expect(mocks.calls.some((call) => call.table === "garcons")).toBe(false);
    expect(mocks.calls.some((call) => call.table === "configuracoes_restaurante")).toBe(false);
  });

  it("autentica usando usuario@mesari.local e escolhe papel do profile", async () => {
    mocks.rows["profiles"] = [
      { id: "profile-1", usuario: "caixa", nome: "Caixa", papel: "caixa", ativo: true },
    ];
    mocks.rows["restaurante"] = [{ id: 1, nome: "Mesari" }];

    await expect(actions.login("Caixa", "senha")).resolves.toBe("caixa");

    expect(mocks.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "caixa@mesari.local",
      password: "senha",
    });
    expect(mocks.calls).toContainEqual({
      table: "profiles",
      method: "select",
      args: ["id,usuario,nome,papel,ativo", ["id", "profile-1"]],
    });
  });

  it("cadastra garçons pelo RPC sem alterar a sessão do caixa", async () => {
    mocks.session = authenticatedSession;

    await expect(
      actions.saveStaff({ name: "Carlos", username: "carlos", password: "senha123" }),
    ).resolves.toBeUndefined();

    expect(mocks.rpc).toHaveBeenCalledWith("criar_usuario", {
      p_usuario: "carlos",
      p_senha: "senha123",
      p_nome: "Carlos",
      p_papel: "garcom",
    });
    expect(mocks.auth.setSession).not.toHaveBeenCalled();
    expect(mocks.session).toEqual(authenticatedSession);
  });

  it("exibe o erro real do banco ao cadastrar um usuário duplicado", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "Esse usuário já existe" } });

    await expect(
      actions.saveStaff({ name: "Carlos", username: "carlos", password: "senha123" }),
    ).rejects.toThrow("Esse usuário já existe");
  });

  it("redefine senha pelo RPC usando o usuário normalizado", async () => {
    await expect(actions.resetStaffPassword(" Carlos ", "senha123")).resolves.toBeUndefined();

    expect(mocks.rpc).toHaveBeenCalledWith("redefinir_senha", {
      p_usuario: "carlos",
      p_senha: "senha123",
    });
  });

  it("envia um item pela RPC enviar_pedido sem inserir diretamente", async () => {
    await act(async () => actions.addLine("table-1", item, 2, "Sem pimenta"));

    expect(mocks.rpc).toHaveBeenCalledWith("enviar_pedido", {
      p_mesa_id: "table-1",
      p_itens: [{ produto_id: "item-1", quantidade: 2, observacao: "Sem pimenta" }],
      p_imprimir: true,
    });
    expect(
      mocks.calls.some((call) => call.table === "itens_pedido" && call.method === "insert"),
    ).toBe(false);
  });

  it("envia todos os itens do carrinho em uma chamada e respeita p_imprimir", async () => {
    const second: MenuItem = { ...item, id: "item-2", name: "Suco" };
    await act(async () =>
      actions.addLines(
        "table-1",
        [
          { item, qty: 2, note: "Sem pimenta" },
          { item: second, qty: 1, note: "" },
        ],
        false,
      ),
    );

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("enviar_pedido", {
      p_mesa_id: "table-1",
      p_itens: [
        { produto_id: "item-1", quantidade: 2, observacao: "Sem pimenta" },
        { produto_id: "item-2", quantidade: 1, observacao: "" },
      ],
      p_imprimir: false,
    });
  });

  it("atualiza o setor salvo da categoria sem criar schema novo", async () => {
    await act(async () => actions.setCategorySector("category-1", "bar"));

    expect(mocks.calls).toContainEqual({
      table: "categorias",
      method: "update",
      args: [{ setor: "bar" }, ["id", "category-1"]],
    });
  });

  it("cria categoria nova no setor cozinha, ou no setor escolhido", async () => {
    mocks.rows["categorias"] = [{ id: "category-new" }];
    await act(async () => actions.addCategory("Bebidas"));
    await act(async () => actions.addCategory("Drinks", "bar"));

    const inserts = mocks.calls.filter(
      (call) => call.table === "categorias" && call.method === "insert",
    );
    expect(inserts.map((call) => (call.args[0] as { setor: string }).setor)).toEqual([
      "cozinha",
      "bar",
    ]);
  });

  it("setor da categoria só tem Cozinha e Bar; registro antigo 'nenhum' vira cozinha", () => {
    expect(categorySectorOptions.map((option) => option.value)).toEqual(["cozinha", "bar"]);
    expect(parseCategorySector("nenhum", "Balcão")).toBe("cozinha");
    expect(parseCategorySector(null, "Sem setor")).toBe("cozinha");
    expect(parseCategorySector("bar", "Drinks")).toBe("bar");
    expect(() => parseCategorySector("copa", "Copa")).toThrow("Setor inválido");
  });

  it("lê comanda_unica e trata a coluna ausente (banco sem migração) como indisponível", async () => {
    mocks.rows["restaurante"] = [{ id: 1, comanda_unica: false }];
    await expect(actions.getSingleTicketMode()).resolves.toBe(false);

    mocks.errors["restaurante"] = {
      code: "42703",
      message: "column restaurante.comanda_unica does not exist",
    };
    await expect(actions.getSingleTicketMode()).resolves.toBeNull();
    delete mocks.errors["restaurante"];
  });

  it("limpa comandas antigas chamando a função existente", async () => {
    await act(async () => actions.cleanKitchenOrders());

    expect(mocks.rpc).toHaveBeenCalledWith("limpar_pedidos_cozinha");
  });

  it("solicita a conta pela função do banco sem alterar mesas.status", async () => {
    await act(async () => actions.requestBill("table-1"));

    expect(mocks.rpc).toHaveBeenCalledWith("solicitar_conta", { p_mesa_id: "table-1" });
    expect(
      mocks.calls.some(
        (call) => call.table === "mesas" && ["update", "upsert"].includes(call.method),
      ),
    ).toBe(false);
  });

  it("usa a venda retornada por fechar_conta para montar a nota", async () => {
    mocks.rpc.mockResolvedValue({ data: sale, error: null });
    const payments = [
      { forma: "pix" as const, valor: 30 },
      { forma: "dinheiro" as const, valor: 25, recebido: 30 },
    ];

    let receipt;
    await act(async () => {
      receipt = await actions.closeBill("table-1", payments);
    });

    expect(mocks.rpc).toHaveBeenCalledWith("fechar_conta", {
      p_mesa_id: "table-1",
      p_pagamentos: [
        { forma: "pix", valor: 30 },
        { forma: "dinheiro", valor: 25, recebido: 30 },
      ],
    });
    expect(receipt).toMatchObject({
      id: "sale-1",
      saleNumber: 42,
      table: 16,
      subtotal: 50,
      serviceCharge: 5,
      total: 55,
      payments: [
        { forma: "pix", valor: 30 },
        { forma: "dinheiro", valor: 25, recebido: 30, troco: 5 },
      ],
      lines: [{ itemId: "item-1", name: "Prato cadastrado", qty: 2, waiter: "Carlos" }],
    });
  });

  it("consulta o resumo de vendas por forma no período sem criar novas funções", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ forma: "pix", total: 100, contas: 2 }],
      error: null,
    });

    await expect(actions.paymentSummary("inicio", "fim")).resolves.toEqual([
      { forma: "pix", total: 100, contas: 2 },
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith("resumo_por_forma", {
      p_inicio: "inicio",
      p_fim: "fim",
    });
  });

  it("não envia o status do cliente ao salvar posições das mesas", async () => {
    mocks.rows["mesas"] = [{ id: "table-1", numero: 16, lugares: 4, status: "conta", ativa: true }];
    await act(async () => refreshData());

    await act(async () =>
      actions.saveTables([
        {
          id: "table-1",
          number: 16,
          seats: 4,
          x: 40,
          y: 50,
          status: "livre",
          active: true,
        },
      ]),
    );

    const save = mocks.calls.find((call) => call.table === "mesas" && call.method === "upsert");
    expect(save?.args[0]).toEqual([
      {
        id: "table-1",
        numero: 16,
        lugares: 4,
        ativa: true,
        pos_x: 40,
        pos_y: 50,
      },
    ]);
  });

  it("exibe o erro exato da API quando o perfil não está disponível", async () => {
    mocks.session = authenticatedSession;
    mocks.errors["profiles"] = {
      code: "PGRST205",
      message: "Could not find the table 'public.profiles' in the schema cache",
    };

    await act(async () => refreshData());
    const { result } = renderHook(() => useStore((snapshot) => snapshot.error));

    await waitFor(() => {
      expect(result.current).toBe("Could not find the table 'public.profiles' in the schema cache");
    });
  });
});
