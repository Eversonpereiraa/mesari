import { useSyncExternalStore } from "react";
import { supabase, supabaseConfigured, usernameEmail } from "@/lib/supabase";

export type Status = "livre" | "ocupada" | "conta";
export type RealtimeStatus = "connected" | "reconnecting" | "offline";
export type Table = {
  id: string;
  number: number;
  seats: number;
  x: number;
  y: number;
  status?: Status;
  active: boolean;
};
export type Category = { id: string; name: string; sector: "cozinha" | "bar" };
export const categorySectorOptions: { value: Category["sector"]; label: string }[] = [
  { value: "cozinha", label: "Cozinha" },
  { value: "bar", label: "Bar" },
];

/**
 * Setor da categoria vindo do banco. Todo item sai na comanda: registros
 * antigos sem setor ou com "nenhum" (antigo "Não imprimir") viram cozinha.
 */
export function parseCategorySector(value: unknown, categoryName: string): Category["sector"] {
  if (value === "bar") return "bar";
  if (value === "cozinha" || value === "nenhum" || value === null || value === undefined) {
    return "cozinha";
  }
  throw new Error(`Setor inválido recebido para a categoria ${categoryName}.`);
}
export type MenuItem = {
  id: string;
  name: string;
  categoryId: string;
  price: number;
  description: string;
  active: boolean;
  order?: number;
};
export type OrderLine = {
  id: string;
  itemId: string;
  name: string;
  qty: number;
  price: number;
  note: string;
  at: number;
  waiter: string;
  waiterId?: string | undefined;
};
export type StaffMember = {
  id: string;
  name: string;
  username: string;
  role: "caixa" | "garcom";
  active: boolean;
};
export type PaymentMethod = "dinheiro" | "pix" | "credito" | "debito" | "nao_informado";
export type Payment = {
  forma: PaymentMethod;
  valor: number;
  recebido?: number;
  troco?: number;
};
export type PaymentInput = {
  forma: Exclude<PaymentMethod, "nao_informado">;
  valor: number;
  recebido?: number;
};
export type PaymentSummary = { forma: PaymentMethod; total: number; contas: number };
export type OriginSummary = {
  origem: "mesa" | "entrega" | "retirada";
  total: number;
  quantidade: number;
};
export const paymentMethodLabel: Record<PaymentMethod, string> = {
  dinheiro: "Dinheiro",
  pix: "Pix",
  credito: "Crédito",
  debito: "Débito",
  nao_informado: "Não informado",
};
export type Closing = {
  id: string;
  at: number;
  table: number;
  saleNumber: number;
  lines: OrderLine[];
  subtotal: number;
  serviceCharge: number;
  total: number;
  payments: Payment[];
  origin?: "mesa" | "entrega" | "retirada" | "balcao";
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  deliveryFee?: number;
  discount?: number;
};

export type State = {
  user: {
    id: string;
    username: string;
    name: string;
    role: "caixa" | "garcom" | "cozinha";
  } | null;
  staff: StaffMember[];
  restaurant: {
    name: string;
    phone: string;
    address: string;
    cnpj: string;
    instagram: string;
    logo: string;
    serviceChargeEnabled: boolean;
    serviceChargePercent: number;
    deliveryFee: number;
  };
  tables: Table[];
  categories: Category[];
  items: MenuItem[];
  orders: Record<string, OrderLine[]>;
  history: Closing[];
  loading: boolean;
  configured: boolean;
  connection: RealtimeStatus;
  error: string | null;
  orderSentMesaId: string | null;
};

const emptyState = (): State => ({
  user: null,
  staff: [],
  restaurant: {
    name: "",
    phone: "",
    address: "",
    cnpj: "",
    instagram: "",
    logo: "",
    serviceChargeEnabled: false,
    serviceChargePercent: 0,
    deliveryFee: 0,
  },
  tables: [],
  categories: [],
  items: [],
  orders: {},
  history: [],
  loading: true,
  configured: supabaseConfigured,
  connection: "reconnecting",
  error: null,
  orderSentMesaId: null,
});

let state = emptyState();
const subs = new Set<() => void>();
let initialized = false;
let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshPromise: Promise<void> | null = null;

type DatabaseRow = Record<string, unknown>;

/** Coluna inexistente no banco (Postgres 42703 / cache de schema do PostgREST). */
function isMissingColumn(error: { code?: string; message?: string }) {
  return error.code === "42703" || error.code === "PGRST204";
}

function asRow(value: unknown): DatabaseRow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("O Supabase retornou um registro em formato inválido.");
  }
  return value as DatabaseRow;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function mapPayments(value: unknown): Payment[] {
  if (!Array.isArray(value)) return [];
  return value.map((payment) => {
    const row = asRow(payment);
    const form = row["forma"];
    if (
      form !== "dinheiro" &&
      form !== "pix" &&
      form !== "credito" &&
      form !== "debito" &&
      form !== "nao_informado"
    ) {
      throw new Error(`Forma de pagamento inválida recebida: ${String(form)}.`);
    }
    return {
      forma: form,
      valor: Number(row["valor"]),
      ...(row["recebido"] == null ? {} : { recebido: Number(row["recebido"]) }),
      ...(row["troco"] == null ? {} : { troco: Number(row["troco"]) }),
    };
  });
}

function publish(next: Partial<State>) {
  state = { ...state, ...next };
  subs.forEach((notify) => notify());
}

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error);
}

const mapTable = (value: unknown): Table => {
  const row = asRow(value);
  const status = row["status"];
  if (status !== "livre" && status !== "ocupada" && status !== "conta") {
    throw new Error(`Status inválido recebido para a mesa ${stringValue(row["id"])}.`);
  }
  return {
    id: stringValue(row["id"]),
    number: Number(row["numero"]),
    seats: Number(row["lugares"]),
    x: Number(row["pos_x"] ?? 0),
    y: Number(row["pos_y"] ?? 0),
    status,
    active: row["ativa"] === true,
  };
};

const mapOrderLine = (value: unknown): OrderLine => {
  const row = asRow(value);
  return {
    id: stringValue(row["id"]),
    itemId: stringValue(row["produto_id"]),
    name: stringValue(row["produto_nome"]),
    qty: Number(row["quantidade"]),
    price: Number(row["valor_unitario"]),
    note: stringValue(row["observacao"]),
    at: new Date(stringValue(row["criado_em"])).getTime(),
    waiter: stringValue(row["garcom_nome"]),
    waiterId: stringValue(row["garcom_id"]) || undefined,
  };
};

const mapSaleLine = (value: unknown): OrderLine => {
  const line = asRow(value);
  const createdAt = stringValue(line["criado_em"]);
  return {
    id: stringValue(line["id"]),
    itemId: stringValue(line["produto_id"] ?? line["itemId"]),
    name: stringValue(line["produto_nome"] ?? line["name"]),
    qty: Number(line["quantidade"] ?? line["qty"]),
    price: Number(line["valor_unitario"] ?? line["price"]),
    note: stringValue(line["observacao"] ?? line["note"]),
    at: createdAt ? new Date(createdAt).getTime() : Number(line["at"] ?? 0),
    waiter: stringValue(line["garcom_nome"] ?? line["waiter"]),
    waiterId: stringValue(line["garcom_id"] ?? line["waiterId"]) || undefined,
  };
};

const mapClosing = (value: unknown): Closing => {
  const row = asRow(value);
  const origin = row["origem"];
  return {
    id: stringValue(row["id"]),
    at: new Date(stringValue(row["fechada_em"])).getTime(),
    table: Number(row["mesa_numero"] ?? 0),
    saleNumber: Number(row["numero"]),
    lines: Array.isArray(row["itens"]) ? row["itens"].map(mapSaleLine) : [],
    subtotal: Number(row["subtotal"]),
    serviceCharge: Number(row["taxa_servico"]),
    total: Number(row["total"]),
    payments: mapPayments(row["pagamentos"]),
    ...(origin === "mesa" || origin === "entrega" || origin === "retirada" || origin === "balcao"
      ? { origin }
      : {}),
    ...(typeof row["cliente_nome"] === "string" ? { customerName: row["cliente_nome"] } : {}),
    ...(typeof row["cliente_telefone"] === "string"
      ? { customerPhone: row["cliente_telefone"] }
      : {}),
    ...(typeof row["cliente_endereco"] === "string"
      ? { customerAddress: row["cliente_endereco"] }
      : {}),
    ...(Number.isFinite(Number(row["taxa_entrega"]))
      ? { deliveryFee: Number(row["taxa_entrega"]) }
      : {}),
    ...(Number.isFinite(Number(row["desconto"])) ? { discount: Number(row["desconto"]) } : {}),
  };
};

async function loadRemoteData() {
  const { data: authData, error: authError } = await supabase.auth.getSession();
  if (authError) throw authError;
  const session = authData.session;
  if (!session) {
    publish({
      ...emptyState(),
      configured: true,
      loading: false,
      connection: "connected",
      error: null,
    });
    return;
  }

  const [
    profileRes,
    staffRes,
    tablesRes,
    categoriesRes,
    productsRes,
    ordersRes,
    salesRes,
    restaurantRes,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id,usuario,nome,papel,ativo")
      .eq("id", session.user.id)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("id,usuario,nome,papel,ativo")
      .eq("papel", "garcom")
      .eq("ativo", true)
      .order("nome"),
    supabase
      .from("mesas")
      .select("id,numero,lugares,status,ativa,pos_x,pos_y")
      .eq("ativa", true)
      .order("numero"),
    supabase.from("categorias").select("id,nome,ordem,setor").order("ordem"),
    supabase
      .from("produtos")
      .select("id,categoria_id,nome,descricao,preco,ativo,ordem")
      .eq("ativo", true)
      .order("ordem"),
    supabase
      .from("itens_pedido")
      .select(
        "id,mesa_id,produto_id,produto_nome,quantidade,valor_unitario,observacao,garcom_id,garcom_nome,criado_em",
      )
      .order("criado_em"),
    supabase
      .from("vendas")
      .select(
        "id,numero,mesa_numero,itens,subtotal,taxa_servico,taxa_entrega,total,pagamentos,garcom_nome,fechado_por,fechado_por_nome,fechada_em,origem,cliente_nome",
      )
      .order("fechada_em", { ascending: false })
      .limit(200),
    supabase
      .from("restaurante")
      .select(
        "id,nome,endereco,telefone,cnpj,instagram,logo_url,taxa_servico_ativa,taxa_servico_percentual,taxa_entrega",
      )
      .eq("id", 1)
      .maybeSingle(),
  ]);

  const failed = [
    profileRes,
    staffRes,
    tablesRes,
    categoriesRes,
    productsRes,
    ordersRes,
    salesRes,
    restaurantRes,
  ].find((result) => result.error);
  if (failed?.error) throw failed.error;

  const profile = profileRes.data ? asRow(profileRes.data) : null;
  if (!profile || profile["ativo"] !== true) {
    throw new Error("O usuário autenticado não possui um perfil ativo em public.profiles.");
  }
  if (
    profile["papel"] !== "caixa" &&
    profile["papel"] !== "garcom" &&
    profile["papel"] !== "cozinha"
  ) {
    throw new Error(`Papel inválido no perfil autenticado: ${String(profile["papel"])}.`);
  }
  if (!restaurantRes.data)
    throw new Error("Não foi encontrado o registro id=1 em public.restaurante.");

  const orders = (ordersRes.data ?? []).reduce<Record<string, OrderLine[]>>(
    (grouped, value: unknown) => {
      const row = asRow(value);
      const tableId = stringValue(row["mesa_id"]);
      (grouped[tableId] ??= []).push(mapOrderLine(row));
      return grouped;
    },
    {},
  );
  const restaurant = asRow(restaurantRes.data);

  publish({
    user: {
      id: session.user.id,
      username: stringValue(profile["usuario"]),
      name: stringValue(profile["nome"]),
      role: profile["papel"],
    },
    staff: (staffRes.data ?? []).map((value: unknown) => {
      const row = asRow(value);
      return {
        id: stringValue(row["id"]),
        name: stringValue(row["nome"]),
        username: stringValue(row["usuario"]),
        role: row["papel"] as "caixa" | "garcom",
        active: row["ativo"] === true,
      };
    }),
    restaurant: {
      name: stringValue(restaurant["nome"]),
      phone: stringValue(restaurant["telefone"]),
      address: stringValue(restaurant["endereco"]),
      cnpj: stringValue(restaurant["cnpj"]),
      instagram: stringValue(restaurant["instagram"]),
      logo: stringValue(restaurant["logo_url"]),
      serviceChargeEnabled: restaurant["taxa_servico_ativa"] === true,
      serviceChargePercent: Number(restaurant["taxa_servico_percentual"]),
      deliveryFee: Number(restaurant["taxa_entrega"] ?? 0),
    },
    tables: (tablesRes.data ?? []).map(mapTable),
    categories: (categoriesRes.data ?? []).map((value: unknown) => {
      const row = asRow(value);
      const name = stringValue(row["nome"]);
      return { id: stringValue(row["id"]), name, sector: parseCategorySector(row["setor"], name) };
    }),
    items: (productsRes.data ?? []).map((value: unknown) => {
      const row = asRow(value);
      return {
        id: stringValue(row["id"]),
        name: stringValue(row["nome"]),
        categoryId: stringValue(row["categoria_id"]),
        price: Number(row["preco"]),
        description: stringValue(row["descricao"]),
        active: row["ativo"] === true,
        order: Number(row["ordem"]),
      };
    }),
    orders,
    history: (salesRes.data ?? []).map(mapClosing),
    loading: false,
    configured: true,
    connection: "connected",
    error: null,
  });
}

export async function refreshData() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = loadRemoteData()
    .catch((error) => {
      publish({
        loading: false,
        configured: true,
        connection: disconnectedStatus(),
        error: errorMessage(error),
      });
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

/** Sem rede no aparelho é "offline"; com rede, mas sem resposta do servidor, é "reconectando". */
function disconnectedStatus(): RealtimeStatus {
  return typeof navigator !== "undefined" && navigator.onLine === false
    ? "offline"
    : "reconnecting";
}

function queueRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void refreshData(), 100);
}

function stopRealtime() {
  if (realtimeChannel) void supabase.removeChannel(realtimeChannel);
  realtimeChannel = null;
}

function startRealtime() {
  if (realtimeChannel) return;
  realtimeChannel = supabase
    .channel("mesari-shared-restaurant-data")
    .on("postgres_changes", { event: "*", schema: "public", table: "mesas" }, queueRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "itens_pedido" }, queueRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "vendas" }, queueRefresh)
    .subscribe((status, error) => {
      if (status === "SUBSCRIBED") {
        publish({ connection: "connected", error: null });
        queueRefresh();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        publish({
          connection: disconnectedStatus(),
          error: error ? errorMessage(error) : `Falha na conexão Realtime do Supabase: ${status}.`,
        });
      }
    });
}

export function initializeStore() {
  if (initialized) return;
  initialized = true;
  if (!supabaseConfigured) {
    publish({
      loading: false,
      configured: false,
      connection: "offline",
      error: "Supabase não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.",
    });
    return;
  }
  if (typeof window !== "undefined") {
    if (navigator.onLine === false) publish({ connection: "offline" });
    window.addEventListener("offline", () => publish({ connection: "offline" }));
    window.addEventListener("online", () => {
      // Volta para "reconectando" até o Realtime confirmar SUBSCRIBED.
      publish({ connection: "reconnecting" });
      void refreshData();
    });
  }
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => {
      if (session) {
        publish({ loading: true, connection: "reconnecting" });
        startRealtime();
        void refreshData();
      } else {
        stopRealtime();
        publish({
          ...emptyState(),
          configured: true,
          loading: false,
          connection: "connected",
          error: null,
        });
      }
    }, 0);
  });
  void supabase.auth
    .getSession()
    .then(({ data: sessionData, error }) => {
      if (error) throw error;
      if (sessionData.session) startRealtime();
      return refreshData();
    })
    .catch((error) =>
      publish({ loading: false, error: errorMessage(error), connection: "reconnecting" }),
    );
}

/** Escuta mudanças do store fora do React (ex.: aplicar o modo demonstração). */
export function onStoreChange(listener: (snapshot: State) => void) {
  const notify = () => listener(state);
  subs.add(notify);
  notify();
  return () => {
    subs.delete(notify);
  };
}

export function useStore<T>(select: (snapshot: State) => T): T {
  return useSyncExternalStore(
    (notify) => {
      subs.add(notify);
      return () => subs.delete(notify);
    },
    () => select(state),
    () => select(state),
  );
}

export const brl = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function tableStatus(snapshot: State, id: string): Status {
  const table = snapshot.tables.find((entry) => entry.id === id);
  if (!table?.status) throw new Error(`O status da mesa ${id} não foi carregado do Supabase.`);
  return table.status;
}

export const total = (lines: OrderLine[] = []) =>
  lines.reduce((sum, line) => sum + line.qty * line.price, 0);
export const count = (lines: OrderLine[] = []) => lines.reduce((sum, line) => sum + line.qty, 0);
export const setStoreError = (error: unknown) => publish({ error: errorMessage(error) });

async function writeRemote<T>(work: () => Promise<T>): Promise<T> {
  try {
    const result = await work();
    publish({ error: null });
    await refreshData();
    return result;
  } catch (error) {
    setStoreError(error);
    throw error;
  }
}

export const actions = {
  async login(username: string, password: string): Promise<"caixa" | "garcom" | "cozinha" | false> {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: usernameEmail(username),
        password,
      });
      if (error) throw error;
      await refreshData();
      if (state.error) throw new Error(state.error);
      if (!state.user)
        throw new Error("O Supabase autenticou o usuário, mas não retornou um perfil ativo.");
      return state.user.role;
    } catch (error) {
      setStoreError(error);
      return false;
    }
  },
  async logout() {
    const { error } = await supabase.auth.signOut();
    if (error) setStoreError(error);
  },
  async addLine(tableId: string, item: MenuItem, qty: number, note: string, print = true) {
    return writeRemote(async () => {
      const { error } = await supabase.rpc("enviar_pedido", {
        p_mesa_id: tableId,
        p_itens: [{ produto_id: item.id, quantidade: qty, observacao: note }],
        p_imprimir: print,
      });
      if (error) throw error;
    });
  },
  async addLines(
    tableId: string,
    entries: { item: MenuItem; qty: number; note: string }[],
    print = true,
  ) {
    if (!entries.length) return;
    return writeRemote(async () => {
      const { error } = await supabase.rpc("enviar_pedido", {
        p_mesa_id: tableId,
        p_itens: entries.map(({ item, qty, note }) => ({
          produto_id: item.id,
          quantidade: qty,
          observacao: note,
        })),
        p_imprimir: print,
      });
      if (error) throw error;
    });
  },
  async setCategorySector(id: string, sector: Category["sector"]) {
    return writeRemote(async () => {
      const { error } = await supabase.from("categorias").update({ setor: sector }).eq("id", id);
      if (error) throw error;
    });
  },
  async cleanKitchenOrders() {
    return writeRemote(async () => {
      const { error } = await supabase.rpc("limpar_pedidos_cozinha");
      if (error) throw error;
    });
  },
  async removeLine(_tableId: string, lineId: string) {
    return writeRemote(async () => {
      const { error } = await supabase.from("itens_pedido").delete().eq("id", lineId);
      if (error) throw error;
    });
  },
  async requestBill(tableId: string) {
    return writeRemote(async () => {
      const { error } = await supabase.rpc("solicitar_conta", { p_mesa_id: tableId });
      if (error) throw error;
    });
  },
  async closeBill(tableId: string, payments: PaymentInput[]): Promise<Closing> {
    return writeRemote(async () => {
      const { data, error } = await supabase.rpc("fechar_conta", {
        p_mesa_id: tableId,
        p_pagamentos: payments.map((payment) => ({
          forma: payment.forma,
          valor: Number((Math.round(payment.valor * 100) / 100).toFixed(2)),
          ...(payment.forma === "dinheiro" && payment.recebido !== undefined
            ? { recebido: Number((Math.round(payment.recebido * 100) / 100).toFixed(2)) }
            : {}),
        })),
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error("A função fechar_conta não retornou a venda fechada.");
      return mapClosing(row);
    });
  },
  async paymentSummary(start: string, end: string): Promise<PaymentSummary[]> {
    const { data, error } = await supabase.rpc("resumo_por_forma", {
      p_inicio: start,
      p_fim: end,
    });
    if (error) throw error;
    if (!Array.isArray(data)) {
      throw new Error("A função resumo_por_forma não retornou uma lista.");
    }
    return data.map((value: unknown) => {
      const row = asRow(value);
      const form = row["forma"];
      if (
        form !== "dinheiro" &&
        form !== "pix" &&
        form !== "credito" &&
        form !== "debito" &&
        form !== "nao_informado"
      ) {
        throw new Error(`Forma de pagamento inválida recebida no resumo: ${String(form)}.`);
      }
      return { forma: form, total: Number(row["total"]), contas: Number(row["contas"]) };
    });
  },
  async originSummary(start: string, end: string): Promise<OriginSummary[]> {
    const totals = new Map<OriginSummary["origem"], { cents: number; count: number }>([
      ["mesa", { cents: 0, count: 0 }],
      ["entrega", { cents: 0, count: 0 }],
      ["retirada", { cents: 0, count: 0 }],
    ]);
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("vendas")
        .select("origem,total")
        .gte("fechada_em", start)
        .lte("fechada_em", end)
        .order("fechada_em", { ascending: true })
        .range(from, from + 499);
      if (error) throw error;
      for (const value of data ?? []) {
        const row = asRow(value);
        if (
          row["origem"] !== "mesa" &&
          row["origem"] !== "entrega" &&
          row["origem"] !== "retirada"
        ) {
          continue;
        }
        const origin = row["origem"];
        const current = totals.get(origin)!;
        current.cents += Math.round(Number(row["total"]) * 100);
        current.count += 1;
      }
      if (!data || data.length < 500) break;
      from += 500;
    }
    return [...totals].map(([origem, value]) => ({
      origem,
      total: value.cents / 100,
      quantidade: value.count,
    }));
  },
  async saveTables(tables: Table[]) {
    return writeRemote(async () => {
      const currentIds = state.tables.map((table) => table.id);
      const nextIds = new Set(tables.map((table) => table.id));
      if (tables.length) {
        const { error } = await supabase.from("mesas").upsert(
          tables.map((table) => ({
            id: table.id,
            numero: table.number,
            lugares: table.seats,
            ativa: true,
            pos_x: table.x,
            pos_y: table.y,
          })),
          { onConflict: "id" },
        );
        if (error) throw error;
      }
      const removedIds = currentIds.filter((id) => !nextIds.has(id));
      if (removedIds.length) {
        const { error } = await supabase
          .from("mesas")
          .update({ ativa: false })
          .in("id", removedIds);
        if (error) throw error;
      }
    });
  },
  async saveItem(item: Omit<MenuItem, "id"> & { id?: string }) {
    return writeRemote(async () => {
      const row = {
        nome: item.name,
        categoria_id: item.categoryId || null,
        preco: item.price,
        descricao: item.description,
        ativo: item.active,
        ordem: item.order ?? state.items.length,
      };
      const query = item.id
        ? supabase.from("produtos").update(row).eq("id", item.id)
        : supabase.from("produtos").insert(row);
      const { error } = await query;
      if (error) throw error;
    });
  },
  async deleteItem(id: string) {
    return writeRemote(async () => {
      const { error } = await supabase.from("produtos").update({ ativo: false }).eq("id", id);
      if (error) throw error;
    });
  },
  async addCategory(name: string, sector: Category["sector"] = "cozinha"): Promise<string> {
    return writeRemote(async () => {
      const { data, error } = await supabase
        .from("categorias")
        .insert({ nome: name, ordem: state.categories.length, setor: sector })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    });
  },
  async saveStaff(member: {
    id?: string;
    name: string;
    username: string;
    password: string;
  }): Promise<void> {
    return writeRemote(async () => {
      const name = member.name.trim();
      const username = member.username.trim().toLowerCase();
      if (member.id) {
        const { error } = await supabase
          .from("profiles")
          .update({ nome: name, usuario: username })
          .eq("id", member.id);
        if (error) throw error;
        if (member.password) {
          throw new Error("Use a opção Redefinir senha para trocar a senha do garçom.");
        }
        return;
      }
      const { error } = await supabase.rpc("criar_usuario", {
        p_usuario: username,
        p_senha: member.password,
        p_nome: name,
        p_papel: "garcom",
      });
      if (error) throw error;
    });
  },
  async resetStaffPassword(username: string, password: string) {
    return writeRemote(async () => {
      const { error } = await supabase.rpc("redefinir_senha", {
        p_usuario: username.trim().toLowerCase(),
        p_senha: password,
      });
      if (error) throw error;
    });
  },
  async deleteStaff(id: string) {
    return writeRemote(async () => {
      const { error } = await supabase.from("profiles").update({ ativo: false }).eq("id", id);
      if (error) throw error;
    });
  },
  markOrderSent(tableId: string) {
    publish({ orderSentMesaId: tableId });
  },
  clearOrderSent() {
    publish({ orderSentMesaId: null });
  },
  /**
   * Comanda única (restaurante.comanda_unica): um envio do garçom vira uma
   * comanda só, com os itens agrupados por setor. Retorna null enquanto a
   * coluna ainda não existe no banco (migração não aplicada).
   */
  async getSingleTicketMode(): Promise<boolean | null> {
    const { data, error } = await supabase
      .from("restaurante")
      .select("comanda_unica")
      .eq("id", 1)
      .maybeSingle();
    if (error) {
      if (isMissingColumn(error)) return null;
      throw error;
    }
    return asRow(data ?? {})["comanda_unica"] !== false;
  },
  async setSingleTicketMode(enabled: boolean) {
    const { error } = await supabase
      .from("restaurante")
      .update({ comanda_unica: enabled })
      .eq("id", 1);
    if (error) throw error;
  },
  async updateRestaurant(restaurant: State["restaurant"]) {
    return writeRemote(async () => {
      const { error } = await supabase
        .from("restaurante")
        .update({
          nome: restaurant.name,
          telefone: restaurant.phone,
          endereco: restaurant.address,
          cnpj: restaurant.cnpj,
          instagram: restaurant.instagram,
          logo_url: restaurant.logo,
          taxa_servico_ativa: restaurant.serviceChargeEnabled,
          taxa_servico_percentual: restaurant.serviceChargePercent,
        })
        .eq("id", 1);
      if (error) throw error;
    });
  },
  clearError() {
    publish({ error: null });
  },
  newId: () => crypto.randomUUID(),
};
