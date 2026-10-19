import { beforeEach, describe, expect, it, vi } from "vitest";

// Supabase falso: registra cada chamada e devolve dados mínimos por tabela/função.
const fake = vi.hoisted(() => {
  const calls: { client: string; kind: string; name: string; args: unknown[] }[] = [];
  let externalId = 0;
  let insertedId = 0;
  let saleId = 0;
  const tableData: Record<string, unknown[]> = {};

  function builder(client: string, table: string) {
    let result: { data: unknown; error: null } = { data: tableData[table] ?? [], error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "update", "upsert", "delete", "eq", "in", "order", "limit"]) {
      chain[method] = (...args: unknown[]) => {
        calls.push({ client, kind: "table", name: `${table}.${method}`, args });
        return chain;
      };
    }
    chain["insert"] = (...args: unknown[]) => {
      calls.push({ client, kind: "table", name: `${table}.insert`, args });
      insertedId += 1;
      result = { data: { id: `${table}-${insertedId}` }, error: null };
      return chain;
    };
    chain["single"] = () => chain;
    chain["then"] = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return chain;
  }

  function makeClient(name: string) {
    return {
      from: (table: string) => builder(name, table),
      rpc: (fn: string, args: unknown) => {
        calls.push({ client: name, kind: "rpc", name: fn, args: [args] });
        if (fn === "criar_pedido_externo") {
          externalId += 1;
          return Promise.resolve({ data: { id: `ext-${externalId}` }, error: null });
        }
        if (fn === "fechar_conta") {
          saleId += 1;
          return Promise.resolve({ data: { id: `venda-${saleId}` }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      auth: {
        signInWithPassword: (args: unknown) => {
          calls.push({ client: name, kind: "auth", name: "signIn", args: [args] });
          return Promise.resolve({ data: {}, error: null });
        },
        signOut: () => {
          calls.push({ client: name, kind: "auth", name: "signOut", args: [] });
          return Promise.resolve({ error: null });
        },
      },
    };
  }

  let waiterClients = 0;
  return {
    calls,
    tableData,
    caixa: makeClient("caixa"),
    nextWaiter: () => makeClient(`garcom-${++waiterClients}`),
    reset() {
      calls.length = 0;
      externalId = 0;
      insertedId = 0;
      saleId = 0;
      waiterClients = 0;
      for (const key of Object.keys(tableData)) delete tableData[key];
    },
  };
});

vi.mock("@/lib/supabase", () => ({
  supabase: fake.caixa,
  supabaseUrl: "https://teste-ref.supabase.co",
  supabaseAnonKey: "anon",
  supabaseProjectRef: () => "teste-ref",
  usernameEmail: (username: string) => `${username}@mesari.local`,
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => fake.nextWaiter() }));

async function loadSeed(testRef: string) {
  vi.resetModules();
  vi.stubEnv("VITE_MESARI_TESTE_REF", testRef);
  return import("@/lib/demo-seed");
}

const rpcs = (name: string) =>
  fake.calls.filter((call) => call.kind === "rpc" && call.name === name);

const paymentsCents = (call: { args: unknown[] }) =>
  (call.args[0] as { p_pagamentos: { valor: number }[] }).p_pagamentos.reduce(
    (total, payment) => total + Math.round(payment.valor * 100),
    0,
  );

/** Banco que aceita os ajustes de horário (o update devolve a linha alterada). */
function databaseWithRows() {
  fake.tableData["itens_pedido"] = [{ id: "item-antigo" }];
  fake.tableData["vendas"] = [{ id: "venda-delivery" }];
  fake.tableData["pedidos_externos"] = [
    { id: "antigo", status: "novo" },
    { id: "entregue", status: "entregue" },
  ];
}

beforeEach(() => {
  fake.reset();
  vi.unstubAllEnvs();
});

describe("dados da demonstração", () => {
  it("dia fecha em ~R$ 1.800 (mesas + deliveries concluídos), a maior parte em Pix", async () => {
    const { DEMO_SALES, DEMO_DELIVERIES_DONE, linesTotalCents, deliveryTotalCents } =
      await loadSeed("teste-ref");
    const byForm = { pix: 0, credito: 0, debito: 0, dinheiro: 0 };
    let total = 0;
    for (const sale of DEMO_SALES) {
      const cents = linesTotalCents(sale.itens);
      total += cents;
      const paid = sale.pagamentos.reduce(
        (sum, payment) => sum + Math.round((payment.valor ?? cents / 100) * 100),
        0,
      );
      expect(paid).toBe(cents);
      for (const payment of sale.pagamentos) {
        byForm[payment.forma] += Math.round((payment.valor ?? cents / 100) * 100);
        if (payment.recebido !== undefined) {
          expect(Math.round(payment.recebido * 100)).toBeGreaterThanOrEqual(cents);
        }
      }
    }
    expect(total).toBe(155_370);
    for (const order of DEMO_DELIVERIES_DONE) {
      total += deliveryTotalCents(order);
      byForm[order.recebidoEm] += deliveryTotalCents(order);
    }
    expect(total).toBe(178_240);
    expect(byForm.pix / total).toBeGreaterThan(0.5);
    expect(Object.values(byForm).every((cents) => cents > 0)).toBe(true);
  });

  it("horários só no almoço (12h–14h) e no jantar (19h–22h)", async () => {
    const { DEMO_SALES, DEMO_OPEN_TABLES, DEMO_DELIVERIES, DEMO_DELIVERIES_DONE, addMinutes } =
      await loadSeed("teste-ref");
    const hours = [
      ...DEMO_SALES.map((sale) => sale.hora),
      ...DEMO_OPEN_TABLES.flatMap((table) => table.pedidos.map((order) => order.hora)),
      ...DEMO_DELIVERIES.map((order) => order.hora),
      ...DEMO_DELIVERIES_DONE.flatMap((order) => [order.hora, addMinutes(order.hora, 35)]),
    ];
    for (const hour of hours) {
      expect(
        (hour >= "12:00" && hour <= "14:00") || (hour >= "19:00" && hour <= "22:00"),
        hour,
      ).toBe(true);
    }
    expect(addMinutes("20:40", 35)).toBe("21:15");
  });

  it("horário de São Paulo vira o instante certo em UTC", async () => {
    const { serviceTime } = await loadSeed("teste-ref");
    expect(serviceTime("12:14", "2026-10-19")).toBe("2026-10-19T15:14:00.000Z");
    expect(serviceTime("21:44", "2026-10-19")).toBe("2026-10-20T00:44:00.000Z");
  });

  it("6 mesas ocupadas (2 pedindo conta), garçons diferentes e deliveries em todas as etapas", async () => {
    const { DEMO_OPEN_TABLES, DEMO_DELIVERIES, DEMO_DELIVERIES_DONE, DEMO_PRODUCTS } =
      await loadSeed("teste-ref");
    expect(DEMO_OPEN_TABLES).toHaveLength(6);
    expect(DEMO_OPEN_TABLES.filter((table) => table.pedindoConta)).toHaveLength(2);
    expect(
      new Set(DEMO_OPEN_TABLES.flatMap((table) => table.pedidos.map((order) => order.garcom))).size,
    ).toBe(3);
    expect(DEMO_DELIVERIES.map((order) => order.status)).toEqual([
      "novo",
      "preparo",
      "pronto",
      "saiu",
    ]);
    expect(DEMO_DELIVERIES_DONE.map((order) => order.tipo).sort()).toEqual([
      "entrega",
      "entrega",
      "retirada",
    ]);
    expect(DEMO_PRODUCTS.map((product) => product.nome)).toEqual([
      "Baião de dois",
      "Carne de sol com macaxeira",
      "Galinha guisada",
      "Escondidinho de charque",
      "Cerveja 600ml",
      "Refrigerante lata",
      "Suco de cajá",
      "Cartola",
    ]);
  });
});

describe("trava do projeto", () => {
  it("só libera no projeto mesari-teste configurado", async () => {
    const { demoSeedAvailability } = await loadSeed("");
    expect(demoSeedAvailability("abc", "")).toMatchObject({ ok: false });
    expect(demoSeedAvailability("producao", "teste-ref")).toEqual({
      ok: false,
      reason: 'Bloqueado: este app está ligado ao projeto "producao", não ao mesari-teste.',
    });
    expect(demoSeedAvailability("teste-ref", "teste-ref")).toEqual({ ok: true });
  });

  it("em outro projeto não faz nenhuma chamada ao banco", async () => {
    const { seedDemoRestaurant } = await loadSeed("outro-ref");
    await expect(seedDemoRestaurant()).rejects.toThrow("Bloqueado");
    expect(fake.calls).toHaveLength(0);
  });
});

describe("montagem no mesari-teste", () => {
  it("monta salão, vendas, mesas abertas e delivery pelas funções do app, sem imprimir", async () => {
    databaseWithRows();
    const { seedDemoRestaurant, DEMO_SALES, serviceTime } = await loadSeed("teste-ref");
    const steps: string[] = [];
    await expect(seedDemoRestaurant((step) => steps.push(step))).resolves.toEqual({
      warnings: [],
    });

    // Vendas de mesa: fechadas pelo caixa, cada uma com o pagamento exato.
    expect(rpcs("fechar_conta")).toHaveLength(DEMO_SALES.length);
    expect(rpcs("fechar_conta").reduce((sum, call) => sum + paymentsCents(call), 0)).toBe(155_370);

    // Deliveries concluídos: 2 entregas e 1 retirada recebidos pelo valor com a taxa.
    const done = rpcs("concluir_pedido_externo");
    expect(done).toHaveLength(3);
    expect(done.reduce((sum, call) => sum + paymentsCents(call), 0)).toBe(22_870);

    // Pedidos lançados pelos garçons de demonstração (3 sessões), nunca pelo caixa, sem imprimir.
    const orders = rpcs("enviar_pedido");
    expect(orders).toHaveLength(DEMO_SALES.length + 8);
    expect(new Set(orders.map((call) => call.client))).toEqual(
      new Set(["garcom-1", "garcom-2", "garcom-3"]),
    );
    expect(
      orders.every((call) => (call.args[0] as { p_imprimir: boolean }).p_imprimir === false),
    ).toBe(true);
    expect(rpcs("solicitar_conta")).toHaveLength(2);

    // 17 mesas, salão limpo antes.
    const upsert = fake.calls.find((call) => call.name === "mesas.upsert");
    expect((upsert?.args[0] as unknown[]).length).toBe(17);
    expect(fake.calls.some((call) => call.name === "itens_pedido.delete")).toBe(true);

    // Delivery: o antigo em aberto é cancelado; 3 concluídos + 4 no quadro.
    expect(rpcs("criar_pedido_externo")).toHaveLength(7);
    expect(
      rpcs("criar_pedido_externo").every(
        (call) => (call.args[0] as { p_imprimir: boolean }).p_imprimir === false,
      ),
    ).toBe(true);
    const statusCalls = rpcs("atualizar_status_pedido_externo").map(
      (call) => call.args[0] as { p_id: string; p_status: string; p_entregador: string | null },
    );
    expect(statusCalls).toContainEqual(
      expect.objectContaining({ p_id: "antigo", p_status: "cancelado" }),
    );
    expect(statusCalls.some((call) => call.p_id === "entregue")).toBe(false);
    // concluídos: entrega→saiu (3+3) e retirada→pronto (2); no quadro: 0+1+2+3.
    expect(statusCalls.filter((call) => call.p_id !== "antigo")).toHaveLength(8 + 6);
    expect(statusCalls).toContainEqual(
      expect.objectContaining({ p_id: "ext-7", p_status: "saiu", p_entregador: "Cícero" }),
    );

    // Horários: primeira venda às 12:14 de hoje e o delivery "Novo" às 21:41.
    const retimes = fake.calls
      .filter((call) => call.name.endsWith(".update"))
      .map((call) => call.args[0] as Record<string, string>);
    expect(retimes).toContainEqual({ fechada_em: serviceTime("12:14") });
    expect(retimes).toContainEqual({ criado_em: serviceTime("21:41") });

    // Taxa de serviço desligada durante as vendas e ligada no fim.
    const restaurantUpdates = fake.calls
      .filter((call) => call.name === "restaurante.update")
      .map((call) => call.args[0] as { taxa_servico_ativa: boolean; telefone: string });
    expect(restaurantUpdates.map((update) => update.taxa_servico_ativa)).toEqual([false, true]);
    expect(restaurantUpdates[0]?.telefone).toBe("81996341234");

    // Sessões dos garçons encerradas.
    expect(fake.calls.filter((call) => call.name === "signOut")).toHaveLength(3);
    expect(steps.at(-1)).toBe("Taxa de serviço");
  });

  it("se o banco não deixar mudar os horários, termina e aponta o script SQL", async () => {
    databaseWithRows();
    delete fake.tableData["vendas"]; // update em vendas não devolve linha: bloqueado por RLS
    const { seedDemoRestaurant } = await loadSeed("teste-ref");
    const { warnings } = await seedDemoRestaurant();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/não deixou ajustar \d+ de \d+ horários/);
    expect(warnings[0]).toContain("supabase/scripts/demo-horarios.sql");
  });
});
