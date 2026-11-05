import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>[]>,
  errors: {} as Record<string, { code?: string; message: string }>,
  calls: [] as { table: string; method: string; args: unknown[]; extras?: unknown[][] }[],
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
  logo: {
    uploadLogo: vi.fn(),
    removeLogo: vi.fn(),
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: mocks,
  supabaseConfigured: true,
  usernameEmail: (username: string) => `${username.trim().toLowerCase()}@mesari.local`,
}));

// Compressão usa canvas (indisponível no jsdom): o envio ao Storage é simulado.
vi.mock("@/lib/logo-storage", () => ({
  isDataUrl: (value: string) => value.startsWith("data:"),
  dataUrlToBlob: async () => new Blob(["imagem"]),
  uploadLogo: mocks.logo.uploadLogo,
  removeLogo: mocks.logo.removeLogo,
}));

import { actions, refreshData, tableStatus, useStore, type MenuItem } from "@/lib/store";

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
  // Filtros de intervalo/conteúdo e paginação: só registrados (não filtram as linhas do mock).
  let extras: unknown[][] = [];

  const execute = () => {
    mocks.calls.push({
      table,
      method: operation,
      args: [values ?? selection, ...filters],
      ...(extras.length ? { extras } : {}),
    });
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
    gte: (...args: unknown[]) => {
      extras = [...extras, ["gte", ...args]];
      return query;
    },
    lte: (...args: unknown[]) => {
      extras = [...extras, ["lte", ...args]];
      return query;
    },
    contains: (...args: unknown[]) => {
      extras = [...extras, ["contains", ...args]];
      return query;
    },
    range: (...args: unknown[]) => {
      extras = [...extras, ["range", ...args]];
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

const STORAGE = "https://x.supabase.co/storage/v1/object/public/marca";

/** Caixa logado com o logo informado em restaurante.logo_url. */
async function loginWithLogo(logo: string, role = "caixa") {
  mocks.session = authenticatedSession;
  mocks.rows["profiles"] = [
    { id: "profile-1", usuario: role, nome: "Caixa", papel: role, ativo: true },
  ];
  mocks.rows["restaurante"] = [
    { id: 1, nome: "Mesari", taxa_servico_ativa: false, logo_url: logo },
  ];
  await act(async () => refreshData());
  mocks.calls = [];
}

const restaurantUpdate = () =>
  mocks.calls.find((call) => call.table === "restaurante" && call.method === "update")?.args[0] as
    Record<string, unknown> | undefined;

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
  mocks.logo.uploadLogo.mockResolvedValue(`${STORAGE}/logo-novo.webp`);
  mocks.logo.removeLogo.mockResolvedValue(undefined);
  await refreshData();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("integração do store com o schema existente", () => {
  it("carrega status direto de mesas e perfis de profiles", async () => {
    mocks.session = authenticatedSession;
    mocks.rows.profiles = [
      { id: "profile-1", usuario: "caixa", nome: "Caixa", papel: "caixa", ativo: true },
      { id: "profile-2", usuario: "carlos", nome: "Carlos", papel: "garcom", ativo: true },
    ];
    mocks.rows.mesas = [
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
    mocks.rows.restaurante = [
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
    mocks.rows.profiles = [
      { id: "profile-1", usuario: "caixa", nome: "Caixa", papel: "caixa", ativo: true },
    ];
    mocks.rows.restaurante = [{ id: 1, nome: "Mesari" }];

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

  it("lê os itens da venda com as chaves gravadas por fechar_conta (produto/garcom)", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        ...sale,
        itens: [
          {
            produto: "Baião de dois",
            quantidade: 1,
            valor_unitario: 32,
            observacao: "sem cebola",
            garcom: "Maria das Dores",
          },
        ],
      },
      error: null,
    });

    let receipt;
    await act(async () => {
      receipt = await actions.closeBill("table-1", [{ forma: "pix", valor: 55 }]);
    });

    expect(receipt).toMatchObject({
      lines: [
        { name: "Baião de dois", qty: 1, price: 32, note: "sem cebola", waiter: "Maria das Dores" },
      ],
    });
  });

  it("recarrega só a parte pedida (evento de itens não baixa vendas, mesas nem logo)", async () => {
    mocks.session = authenticatedSession;
    mocks.calls = [];

    await act(async () => refreshData(["orders"]));

    expect([...new Set(mocks.calls.map((call) => call.table))]).toEqual(["itens_pedido"]);
  });

  it("não baixa vendas nem o logo na carga do salão", async () => {
    mocks.session = authenticatedSession;
    mocks.rows.profiles = [
      { id: "profile-1", usuario: "caixa", nome: "Caixa", papel: "caixa", ativo: true },
    ];
    mocks.rows.restaurante = [{ id: 1, nome: "Mesari", logo_url: "data:image/jpeg;base64,AAA" }];
    mocks.calls = [];

    await act(async () => refreshData(["base", "tables", "orders", "layout"]));

    expect(mocks.calls.some((call) => call.table === "vendas")).toBe(false);
    expect(
      mocks.calls.some(
        (call) => call.table === "restaurante" && String(call.args[0]).includes("logo_url"),
      ),
    ).toBe(false);
  });

  it("mantém a mesma lista de mesas quando nada mudou (o mapa não re-renderiza)", async () => {
    mocks.session = authenticatedSession;
    mocks.rows.mesas = [{ id: "table-1", numero: 3, lugares: 4, status: "livre", ativa: true }];
    await act(async () => refreshData(["tables"]));
    const { result } = renderHook(() => useStore((snapshot) => snapshot.tables));
    const before = result.current;

    await act(async () => refreshData(["tables"]));
    expect(result.current).toBe(before);

    mocks.rows.mesas = [{ id: "table-1", numero: 3, lugares: 4, status: "ocupada", ativa: true }];
    await act(async () => refreshData(["tables"]));
    expect(result.current).not.toBe(before);
    expect(result.current[0]?.status).toBe("ocupada");
  });

  it("lista vendas do período paginando no banco e filtrando pela forma", async () => {
    mocks.rows.vendas = Array.from({ length: 3 }, (_, index) => ({
      ...sale,
      id: `sale-${index}`,
      numero: index,
    }));

    const page = await actions.listSales("inicio", "fim", "pix", 0, 2);

    expect(page.sales).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    const call = mocks.calls.find((entry) => entry.table === "vendas");
    expect(call?.extras).toEqual([
      ["gte", "fechada_em", "inicio"],
      ["lte", "fechada_em", "fim"],
      ["contains", "pagamentos", [{ forma: "pix" }]],
      ["range", 0, 2],
    ]);
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
      actions.saveTableLayout([
        {
          id: "table-1",
          number: 16,
          seats: 8,
          x: 4.5,
          y: 2,
          shape: "rect",
          rotation: 1,
          areaId: null,
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
        lugares: 8,
        ativa: true,
        pos_x: 4.5,
        pos_y: 2,
        shape: "rect",
        rotation: 1,
      },
    ]);
  });

  it("lê mesas sem posição e sem colunas do mapa com valores padrão", async () => {
    mocks.session = authenticatedSession;
    mocks.rows["profiles"] = [
      { id: "profile-1", usuario: "caixa", nome: "Caixa", papel: "caixa", ativo: true },
    ];
    mocks.rows["restaurante"] = [{ id: 1, nome: "Mesari", taxa_servico_ativa: false }];
    mocks.rows["mesas"] = [{ id: "table-1", numero: 3, lugares: 4, status: "livre", ativa: true }];
    await act(async () => refreshData());
    const { result } = renderHook(() => useStore((snapshot) => snapshot.tables));
    expect(result.current).toEqual([
      expect.objectContaining({ x: null, y: null, shape: "square", rotation: 0 }),
    ]);
  });

  it("bloqueia excluir mesa com pedido em aberto", async () => {
    mocks.session = authenticatedSession;
    mocks.rows["profiles"] = [
      { id: "profile-1", usuario: "caixa", nome: "Caixa", papel: "caixa", ativo: true },
    ];
    mocks.rows["restaurante"] = [{ id: 1, nome: "Mesari", taxa_servico_ativa: false }];
    mocks.rows["mesas"] = [
      { id: "table-1", numero: 3, lugares: 4, status: "ocupada", ativa: true },
    ];
    mocks.rows["itens_pedido"] = [
      {
        id: "line-1",
        mesa_id: "table-1",
        produto_id: "item-1",
        produto_nome: "Prato",
        quantidade: 1,
        valor_unitario: 10,
        observacao: "",
        criado_em: "2026-11-03T12:00:00Z",
      },
    ];
    await act(async () => refreshData());
    await expect(actions.deactivateTable("table-1")).rejects.toThrow(
      "A mesa 03 tem pedido em aberto",
    );
    expect(mocks.calls.some((call) => call.table === "mesas" && call.method === "update")).toBe(
      false,
    );
  });

  it("exibe o erro exato da API quando o perfil não está disponível", async () => {
    mocks.session = authenticatedSession;
    mocks.errors.profiles = {
      code: "PGRST205",
      message: "Could not find the table 'public.profiles' in the schema cache",
    };

    await act(async () => refreshData());
    const { result } = renderHook(() => useStore((snapshot) => snapshot.error));

    await waitFor(() => {
      expect(result.current).toBe("Could not find the table 'public.profiles' in the schema cache");
    });
  });

  it("envia o logo novo ao Storage, grava só a URL e apaga o arquivo antigo", async () => {
    await loginWithLogo(`${STORAGE}/logo-antigo.webp`);
    const { result } = renderHook(() => useStore((snapshot) => snapshot.restaurant));

    await act(async () =>
      actions.updateRestaurant({ ...result.current, logo: "data:image/png;base64,AAAA" }),
    );

    expect(mocks.logo.uploadLogo).toHaveBeenCalledTimes(1);
    expect(restaurantUpdate()).toEqual(
      expect.objectContaining({ nome: "Mesari", logo_url: `${STORAGE}/logo-novo.webp` }),
    );
    expect(mocks.logo.removeLogo).toHaveBeenCalledWith(`${STORAGE}/logo-antigo.webp`);
  });

  it("não envia nem apaga nada quando o logo não mudou", async () => {
    await loginWithLogo(`${STORAGE}/logo-antigo.webp`);
    const { result } = renderHook(() => useStore((snapshot) => snapshot.restaurant));

    await act(async () => actions.updateRestaurant({ ...result.current, name: "Novo nome" }));

    expect(mocks.logo.uploadLogo).not.toHaveBeenCalled();
    expect(mocks.logo.removeLogo).not.toHaveBeenCalled();
    expect(restaurantUpdate()).toEqual(
      expect.objectContaining({ nome: "Novo nome", logo_url: `${STORAGE}/logo-antigo.webp` }),
    );
  });

  it("se a gravação falhar, apaga o arquivo enviado e mantém o antigo", async () => {
    await loginWithLogo(`${STORAGE}/logo-antigo.webp`);
    const { result } = renderHook(() => useStore((snapshot) => snapshot.restaurant));
    mocks.errors["restaurante"] = { message: "Falha ao salvar" };

    await expect(
      actions.updateRestaurant({ ...result.current, logo: "data:image/png;base64,AAAA" }),
    ).rejects.toThrow("Falha ao salvar");

    expect(mocks.logo.removeLogo).toHaveBeenCalledTimes(1);
    expect(mocks.logo.removeLogo).toHaveBeenCalledWith(`${STORAGE}/logo-novo.webp`);
  });

  it("converte o logo base64 antigo para o Storage alterando só logo_url", async () => {
    await loginWithLogo("data:image/jpeg;base64,BBBB");

    await act(async () => actions.migrateLogo());

    expect(mocks.logo.uploadLogo).toHaveBeenCalledTimes(1);
    expect(restaurantUpdate()).toEqual({ logo_url: `${STORAGE}/logo-novo.webp` });
    // Recarrega só o logo, sem refazer cardápio, mesas ou pedidos.
    expect(
      mocks.calls.filter((call) => call.method === "select").map((call) => call.args[0]),
    ).toEqual(["logo_url"]);
  });

  it("não converte o logo fora do caixa nem quando já é URL", async () => {
    await loginWithLogo("data:image/jpeg;base64,BBBB", "garcom");
    await act(async () => actions.migrateLogo());
    await loginWithLogo(`${STORAGE}/logo-antigo.webp`);
    await act(async () => actions.migrateLogo());

    expect(mocks.logo.uploadLogo).not.toHaveBeenCalled();
    expect(restaurantUpdate()).toBeUndefined();
  });
});
