import { useSyncExternalStore } from "react";
import { supabase, supabaseConfigured, usernameEmail } from "@/lib/supabase";
import {
  requireRestaurantId,
  saveRestaurantCode,
  savedRestaurantCode,
  setRestaurantId,
} from "@/lib/tenant";
import {
  dataUrlToBlob,
  isDataUrl,
  removeLogo,
  uploadLogo,
  uploadPrintLogo,
} from "@/lib/logo-storage";
import { money } from "@/lib/printing/format";

export type Status = "livre" | "ocupada" | "conta";
export type RealtimeStatus = "connected" | "reconnecting" | "offline";
export type TableShape = "round" | "square" | "rect";
export type Table = {
  id: string;
  number: number;
  seats: number;
  /** Posição no mapa do salão, em unidades de grade; null quando ainda não foi posicionada. */
  x: number | null;
  y: number | null;
  shape: TableShape;
  rotation: 0 | 1;
  /** Área do salão onde a mesa está (null antes da migration de áreas). */
  areaId: string | null;
  /** Quando a nota de consumo foi impressa pela última vez (null = ainda não). */
  billPrintedAt?: number | null;
  status?: Status;
  active: boolean;
};
export type AreaKind = "interna" | "externa";
/** Retângulo do salão (Salão, Varanda, Calçada...), em unidades de grade. */
export type FloorArea = {
  id: string;
  name: string;
  kind: AreaKind;
  x: number;
  y: number;
  width: number;
  depth: number;
  order: number;
};
export type ElementKind = "balcao" | "porta" | "janela" | "caixa" | "cozinha";
/** Balcão, porta, janela, caixa ou cozinha. Porta/janela: rotation 0 = parede do fundo, 1 = esquerda. */
export type FloorElement = {
  id: string;
  areaId: string;
  kind: ElementKind;
  x: number;
  y: number;
  width: number;
  depth: number;
  rotation: 0 | 1;
};
export type Category = { id: string; name: string; sector: "cozinha" | "bar" | "nenhum" };
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
  waiterId?: string;
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

/** Plano e assinatura do restaurante (função minha_assinatura no banco). */
export type PlanLimits = {
  id: "essencial" | "profissional" | "completo";
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  maxTables: number | null;
  maxWaiters: number | null;
  maxCashiers: number | null;
  maxPrinters: number | null;
  maxAreas: number | null;
  delivery: boolean;
  printLogo: boolean;
  historyDays: number | null;
  export: boolean;
  support: string;
};
export type SubscriptionStatus = "teste" | "ativa" | "atrasada" | "cancelada" | "expirada";
export type PlanInfo = {
  plan: PlanLimits;
  status: SubscriptionStatus;
  cycle: "mensal" | "anual" | null;
  periodEnd: number | null;
  autoRenew: boolean;
  active: boolean;
  restaurantCode: string;
  usage: { tables: number; waiters: number; cashiers: number; areas: number };
  /** Assinatura paga no Asaas: a troca de plano acontece dentro do app. */
  onlinePayment: boolean;
  /** Onde a assinatura é paga: "mercadopago" (renovação paga pelo app), "asaas" (legado) ou null. */
  gateway: string | null;
  /** O usuário logado é o dono da conta (só ele troca de plano). */
  owner: boolean;
  /** Troca agendada para a próxima renovação (descer de plano ou trocar mensal/anual). */
  nextPlan: PlanLimits | null;
  nextCycle: "mensal" | "anual" | null;
  /** Subida de plano esperando o pagamento da diferença. */
  pendingUpgrade: { planId: string; amount: number } | null;
};

export function mapPlan(value: unknown): PlanLimits {
  const row = (value ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: (row["id"] as PlanLimits["id"]) ?? "essencial",
    name: String(row["nome"] ?? ""),
    monthlyPrice: Number(row["preco_mensal"] ?? 0),
    yearlyPrice: Number(row["preco_anual"] ?? 0),
    maxTables: num(row["max_mesas"]),
    maxWaiters: num(row["max_garcons"]),
    maxCashiers: num(row["max_caixas"]),
    maxPrinters: num(row["max_impressoras"]),
    maxAreas: num(row["max_areas"]),
    delivery: row["delivery"] === true,
    printLogo: row["logo_comanda"] === true,
    historyDays: num(row["historico_dias"]),
    export: row["exportar"] === true,
    support: String(row["suporte"] ?? ""),
  };
}

function mapPlanInfo(value: unknown): PlanInfo {
  const row = (value ?? {}) as Record<string, unknown>;
  const usage = (row["uso"] ?? {}) as Record<string, unknown>;
  return {
    plan: mapPlan(row["plano"]),
    status: (row["status"] as SubscriptionStatus) ?? "expirada",
    cycle: (row["ciclo"] as PlanInfo["cycle"]) ?? null,
    periodEnd: row["periodo_fim"] ? Date.parse(String(row["periodo_fim"])) : null,
    autoRenew: row["renovacao_automatica"] === true,
    active: row["ativa"] === true,
    restaurantCode: String(row["codigo"] ?? ""),
    usage: {
      tables: Number(usage["mesas"] ?? 0),
      waiters: Number(usage["garcons"] ?? 0),
      cashiers: Number(usage["caixas"] ?? 0),
      areas: Number(usage["areas"] ?? 0),
    },
    onlinePayment: row["pagamento_online"] === true,
    gateway: row["gateway"] ? String(row["gateway"]) : null,
    owner: row["dono"] === true,
    nextPlan: row["plano_proximo"] ? mapPlan(row["plano_proximo"]) : null,
    nextCycle: (row["ciclo_proximo"] as PlanInfo["nextCycle"]) ?? null,
    pendingUpgrade: (() => {
      const pending = row["troca_aguardando"] as Record<string, unknown> | null | undefined;
      return pending
        ? { planId: String(pending["para_plano"] ?? ""), amount: Number(pending["valor"] ?? 0) }
        : null;
    })(),
  };
}

export type State = {
  user: {
    id: string;
    username: string;
    name: string;
    role: "caixa" | "garcom" | "cozinha";
  } | null;
  staff: StaffMember[];
  /** Plano e assinatura (null antes do login). */
  plan: PlanInfo | null;
  restaurant: {
    name: string;
    phone: string;
    address: string;
    cnpj: string;
    instagram: string;
    logo: string;
    /** Logo preto e branco para impressão (PNG processado no upload). */
    printLogo: string;
    /** Imprimir a logo na conta e na comanda de delivery. */
    printLogoEnabled: boolean;
    /** Rodapé da conta (uma linha por quebra de linha). */
    receiptFooter: string;
    /** false enquanto a migration da logo de impressão não foi aplicada. */
    printSettingsAvailable: boolean;
    serviceChargeEnabled: boolean;
    serviceChargePercent: number;
    deliveryFee: number;
  };
  tables: Table[];
  areas: FloorArea[];
  elements: FloorElement[];
  /** false enquanto a migration de áreas (salao_areas) não foi aplicada. */
  areasAvailable: boolean;
  /** false enquanto a migration da nota de consumo (nota_impressa_em) não foi aplicada. */
  billPrintAvailable: boolean;
  categories: Category[];
  items: MenuItem[];
  orders: Record<string, OrderLine[]>;
  /** Sobe a cada venda nova (Realtime). O histórico não fica no store: cada tela busca o seu. */
  salesVersion: number;
  loading: boolean;
  configured: boolean;
  connection: RealtimeStatus;
  error: string | null;
  orderSentMesaId: string | null;
};

const emptyState = (): State => ({
  user: null,
  staff: [],
  plan: null,
  restaurant: {
    name: "",
    phone: "",
    address: "",
    cnpj: "",
    instagram: "",
    logo: "",
    printLogo: "",
    printLogoEnabled: false,
    receiptFooter: "",
    printSettingsAvailable: false,
    serviceChargeEnabled: false,
    serviceChargePercent: 0,
    deliveryFee: 0,
  },
  tables: [],
  areas: [],
  elements: [],
  areasAvailable: false,
  billPrintAvailable: false,
  categories: [],
  items: [],
  orders: {},
  salesVersion: 0,
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
let layoutChannel: ReturnType<typeof supabase.channel> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshPromise: Promise<void> | null = null;

type DatabaseRow = Record<string, unknown>;

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
    const form = row.forma;
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
      valor: Number(row.valor),
      ...(row.recebido == null ? {} : { recebido: Number(row.recebido) }),
      ...(row.troco == null ? {} : { troco: Number(row.troco) }),
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
  const status = row.status;
  if (status !== "livre" && status !== "ocupada" && status !== "conta") {
    throw new Error(`Status inválido recebido para a mesa ${stringValue(row.id)}.`);
  }
  const shape = row["shape"];
  return {
    id: stringValue(row.id),
    number: Number(row.numero),
    seats: Number(row.lugares),
    x: row["pos_x"] == null ? null : Number(row["pos_x"]),
    y: row["pos_y"] == null ? null : Number(row["pos_y"]),
    shape: shape === "round" || shape === "rect" ? shape : "square",
    rotation: Number(row["rotation"]) === 1 ? 1 : 0,
    areaId: typeof row["area_id"] === "string" ? row["area_id"] : null,
    billPrintedAt:
      typeof row["nota_impressa_em"] === "string"
        ? new Date(row["nota_impressa_em"]).getTime()
        : null,
    status,
    active: row.ativa === true,
  };
};

const mapArea = (value: unknown): FloorArea => {
  const row = asRow(value);
  return {
    id: stringValue(row["id"]),
    name: stringValue(row["nome"]),
    kind: row["tipo"] === "externa" ? "externa" : "interna",
    x: Number(row["pos_x"]),
    y: Number(row["pos_y"]),
    width: Number(row["largura"]),
    depth: Number(row["profundidade"]),
    order: Number(row["ordem"] ?? 0),
  };
};

const elementKinds: ElementKind[] = ["balcao", "porta", "janela", "caixa", "cozinha"];
const mapElement = (value: unknown): FloorElement | null => {
  const row = asRow(value);
  const kind = elementKinds.find((k) => k === row["tipo"]);
  if (!kind) return null;
  return {
    id: stringValue(row["id"]),
    areaId: stringValue(row["area_id"]),
    kind,
    x: Number(row["pos_x"]),
    y: Number(row["pos_y"]),
    width: Number(row["largura"]),
    depth: Number(row["profundidade"]),
    rotation: Number(row["rotation"]) === 1 ? 1 : 0,
  };
};

const areaRow = (area: FloorArea) => ({
  id: area.id,
  nome: area.name,
  tipo: area.kind,
  pos_x: area.x,
  pos_y: area.y,
  largura: area.width,
  profundidade: area.depth,
  ordem: area.order,
});

const elementRow = (element: FloorElement) => ({
  id: element.id,
  area_id: element.areaId,
  tipo: element.kind,
  pos_x: element.x,
  pos_y: element.y,
  largura: element.width,
  profundidade: element.depth,
  rotation: element.rotation,
});

const MISSING_MAP_COLUMNS =
  "O banco ainda não tem as colunas do mapa do salão. Aplique a migration 202611030001_mapa_salao.sql no Supabase e recarregue a página.";
const MISSING_AREAS =
  "O banco ainda não tem as áreas do salão. Aplique a migration 202611030002_salao_areas.sql no Supabase e recarregue a página.";

function layoutError(error: { message: string }) {
  if (/'(shape|rotation)' column|type integer/.test(error.message)) {
    return new Error(MISSING_MAP_COLUMNS);
  }
  if (/salao_areas|salao_elementos|'area_id' column/.test(error.message)) {
    return new Error(MISSING_AREAS);
  }
  return error;
}

const tableRow = (table: Table) => ({
  id: table.id,
  numero: table.number,
  lugares: table.seats,
  ativa: true,
  pos_x: table.x,
  pos_y: table.y,
  shape: table.shape,
  rotation: table.rotation,
  // Só envia a área quando o banco já tem áreas de verdade (não a área provisória do app).
  ...(state.areasAvailable && table.areaId && state.areas.some((a) => a.id === table.areaId)
    ? { area_id: table.areaId }
    : {}),
});

const mapOrderLine = (value: unknown): OrderLine => {
  const row = asRow(value);
  return {
    id: stringValue(row.id),
    itemId: stringValue(row.produto_id),
    name: stringValue(row.produto_nome),
    qty: Number(row.quantidade),
    price: Number(row.valor_unitario),
    note: stringValue(row.observacao),
    at: new Date(stringValue(row.criado_em)).getTime(),
    waiter: stringValue(row.garcom_nome),
    waiterId: stringValue(row.garcom_id) || undefined,
  };
};

// fechar_conta e concluir_pedido_externo gravam produto/quantidade/valor_unitario/observacao/garcom.
const mapSaleLine = (value: unknown): OrderLine => {
  const line = asRow(value);
  const createdAt = stringValue(line.criado_em);
  return {
    id: stringValue(line.id),
    itemId: stringValue(line.produto_id ?? line.itemId),
    name: stringValue(line.produto ?? line.produto_nome ?? line.name),
    qty: Number(line.quantidade ?? line.qty),
    price: Number(line.valor_unitario ?? line.price),
    note: stringValue(line.observacao ?? line.note),
    at: createdAt ? new Date(createdAt).getTime() : Number(line.at ?? 0),
    waiter: stringValue(line.garcom ?? line.garcom_nome ?? line.waiter),
    waiterId: stringValue(line.garcom_id ?? line.waiterId) || undefined,
  };
};

const mapClosing = (value: unknown): Closing => {
  const row = asRow(value);
  const origin = row["origem"];
  return {
    id: stringValue(row.id),
    at: new Date(stringValue(row.fechada_em)).getTime(),
    table: Number(row.mesa_numero ?? 0),
    saleNumber: Number(row.numero),
    lines: Array.isArray(row.itens) ? row.itens.map(mapSaleLine) : [],
    subtotal: Number(row.subtotal),
    serviceCharge: Number(row.taxa_servico),
    total: Number(row.total),
    payments: mapPayments(row.pagamentos),
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

/** Partes do estado que recarregam separadamente: cada evento busca só a parte que mudou. */
export type RefreshPart = "base" | "logo" | "tables" | "orders" | "layout";
const ALL_PARTS: readonly RefreshPart[] = ["base", "logo", "tables", "orders", "layout"];
/** Reconexão do Realtime: tudo menos o logo, que só muda quando o caixa salva o restaurante. */
const LIVE_PARTS: readonly RefreshPart[] = ["base", "tables", "orders", "layout"];
/** Cardápio, equipe e restaurante não estão no Realtime: vão junto de um evento a cada 5 min. */
const BASE_MAX_AGE = 5 * 60 * 1000;
let lastBaseAt = 0;
let pendingParts = new Set<RefreshPart>();
let queuedParts = new Set<RefreshPart>();

/** Colunas da venda usadas pela tela Vendas e pela nota (sem select("*") em tabela que cresce). */
const SALE_COLUMNS =
  "id,numero,mesa_numero,itens,subtotal,taxa_servico,taxa_entrega,desconto,total,pagamentos,garcom_nome,fechado_por,fechado_por_nome,fechada_em,origem,cliente_nome";

function sameShallow(a: object, b: object) {
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.is(left[key], right[key]))
  );
}

/** Mantém os objetos que não mudaram (e a lista inteira, se nada mudou) para não re-renderizar à toa. */
function reuseList<T extends { id: string }>(previous: T[], next: T[]): T[] {
  const byId = new Map(previous.map((entry) => [entry.id, entry]));
  let changed = previous.length !== next.length;
  const merged = next.map((entry, index) => {
    const old = byId.get(entry.id);
    if (old && sameShallow(old, entry)) {
      if (previous[index] !== old) changed = true;
      return old;
    }
    changed = true;
    return entry;
  });
  return changed ? merged : previous;
}

function reuseOrders(previous: State["orders"], next: State["orders"]): State["orders"] {
  const entries = Object.entries(next);
  let changed = entries.length !== Object.keys(previous).length;
  const merged: State["orders"] = {};
  for (const [id, lines] of entries) {
    const kept = reuseList(previous[id] ?? [], lines);
    if (kept !== previous[id]) changed = true;
    merged[id] = kept;
  }
  return changed ? merged : previous;
}

/** Perfil, equipe, cardápio e dados do restaurante (sem o logo). */
async function loadBase(userId: string) {
  const [profileRes, staffRes, categoriesRes, productsRes, restaurantRes, planRes] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id,usuario,nome,papel,ativo,restaurante_id")
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("id,usuario,nome,papel,ativo")
        .eq("papel", "garcom")
        .eq("ativo", true)
        .order("nome"),
      supabase.from("categorias").select("id,nome,ordem,setor").order("ordem"),
      supabase
        .from("produtos")
        .select("id,categoria_id,nome,descricao,preco,ativo,ordem")
        .eq("ativo", true)
        .order("ordem"),
      supabase
        .from("restaurante")
        .select(
          "id,nome,endereco,telefone,cnpj,instagram,taxa_servico_ativa,taxa_servico_percentual,taxa_entrega",
        )
        // A RLS só devolve o restaurante do usuário logado.
        .limit(1)
        .maybeSingle(),
      supabase.rpc("minha_assinatura"),
    ]);

  const failed = [profileRes, staffRes, categoriesRes, productsRes, restaurantRes].find(
    (result) => result.error,
  );
  if (failed?.error) throw failed.error;

  const profile = profileRes.data ? asRow(profileRes.data) : null;
  if (!profile || profile.ativo !== true) {
    throw new Error("O usuário autenticado não possui um perfil ativo em public.profiles.");
  }
  if (profile.papel !== "caixa" && profile.papel !== "garcom" && profile.papel !== "cozinha") {
    throw new Error(`Papel inválido no perfil autenticado: ${String(profile.papel)}.`);
  }
  if (!restaurantRes.data) throw new Error("O restaurante deste usuário não foi encontrado.");
  const restaurant = asRow(restaurantRes.data);
  setRestaurantId(Number(profile["restaurante_id"] ?? restaurant["id"]));
  const plan = planRes.error ? null : mapPlanInfo(planRes.data);
  if (plan?.restaurantCode) saveRestaurantCode(plan.restaurantCode);

  const user: NonNullable<State["user"]> = {
    id: userId,
    username: stringValue(profile.usuario),
    name: stringValue(profile.nome),
    role: profile.papel,
  };
  return {
    user: state.user && sameShallow(state.user, user) ? state.user : user,
    plan,
    staff: reuseList(
      state.staff,
      (staffRes.data ?? []).map((value: unknown): StaffMember => {
        const row = asRow(value);
        return {
          id: stringValue(row.id),
          name: stringValue(row.nome),
          username: stringValue(row.usuario),
          role: row.papel as "caixa" | "garcom",
          active: row.ativo === true,
        };
      }),
    ),
    restaurant: {
      name: stringValue(restaurant.nome),
      phone: stringValue(restaurant.telefone),
      address: stringValue(restaurant.endereco),
      cnpj: stringValue(restaurant.cnpj),
      instagram: stringValue(restaurant.instagram),
      serviceChargeEnabled: restaurant.taxa_servico_ativa === true,
      serviceChargePercent: Number(restaurant.taxa_servico_percentual),
      deliveryFee: Number(restaurant["taxa_entrega"] ?? 0),
    },
    categories: reuseList(
      state.categories,
      (categoriesRes.data ?? []).map((value: unknown): Category => {
        const row = asRow(value);
        const sector = row.setor ?? "nenhum";
        if (sector !== "cozinha" && sector !== "bar" && sector !== "nenhum") {
          throw new Error(`Setor inválido recebido para a categoria ${stringValue(row.nome)}.`);
        }
        return { id: stringValue(row.id), name: stringValue(row.nome), sector };
      }),
    ),
    items: reuseList(
      state.items,
      (productsRes.data ?? []).map((value: unknown): MenuItem => {
        const row = asRow(value);
        return {
          id: stringValue(row.id),
          name: stringValue(row.nome),
          categoryId: stringValue(row.categoria_id),
          price: Number(row.preco),
          description: stringValue(row.descricao),
          active: row.ativo === true,
          order: Number(row.ordem),
        };
      }),
    ),
  };
}

/** O logo fica separado: só muda quando o caixa salva o restaurante (base64 antigo pode ser grande). */
async function loadLogo() {
  // "*" mantém o app funcionando antes da migration da logo de impressão.
  const { data, error } = await supabase.from("restaurante").select("*").limit(1).maybeSingle();
  if (error) throw error;
  const row = data ? asRow(data) : {};
  return {
    logo: stringValue(row["logo_url"]),
    printLogo: stringValue(row["logo_impressao_url"]),
    printLogoEnabled: row["imprimir_logo"] === true,
    receiptFooter: stringValue(row["rodape_conta"]),
    printSettingsAvailable: "logo_impressao_url" in row,
  };
}

async function loadTables() {
  // "*" mantém o app funcionando mesmo antes da migration do mapa (shape/rotation) ser aplicada.
  const { data, error } = await supabase
    .from("mesas")
    .select("*")
    .eq("ativa", true)
    .order("numero");
  if (error) throw error;
  const rows = data ?? [];
  return {
    tables: reuseList(state.tables, rows.map(mapTable)),
    billPrintAvailable: rows.some(
      (value: unknown) =>
        typeof value === "object" && value !== null && "nota_impressa_em" in value,
    ),
  };
}

/** itens_pedido só guarda pedidos em aberto (fechar_conta apaga), então a tabela é sempre pequena. */
async function loadOrders() {
  const { data, error } = await supabase
    .from("itens_pedido")
    .select(
      "id,mesa_id,produto_id,produto_nome,quantidade,valor_unitario,observacao,garcom_id,garcom_nome,criado_em",
    )
    .order("criado_em");
  if (error) throw error;
  const orders = (data ?? []).reduce<Record<string, OrderLine[]>>((grouped, value: unknown) => {
    const row = asRow(value);
    const tableId = stringValue(row.mesa_id);
    (grouped[tableId] ??= []).push(mapOrderLine(row));
    return grouped;
  }, {});
  return { orders: reuseOrders(state.orders, orders) };
}

async function loadLayout() {
  // Áreas e elementos ficam fora da checagem de erro: antes da migration o app segue com a
  // área provisória "Salão" 12 x 9.
  const [areasRes, elementsRes] = await Promise.all([
    supabase.from("salao_areas").select("*").order("ordem"),
    supabase.from("salao_elementos").select("*"),
  ]);
  const areasAvailable = !areasRes.error && !elementsRes.error;
  if (areasAvailable) startLayoutRealtime();
  return {
    areasAvailable,
    areas: areasAvailable ? reuseList(state.areas, (areasRes.data ?? []).map(mapArea)) : [],
    elements: areasAvailable
      ? reuseList(
          state.elements,
          (elementsRes.data ?? []).map(mapElement).filter((e): e is FloorElement => e !== null),
        )
      : [],
  };
}

async function loadRemoteData(parts: ReadonlySet<RefreshPart>) {
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

  const [base, logo, tables, orders, layout] = await Promise.all([
    parts.has("base") ? loadBase(session.user.id) : null,
    parts.has("logo") ? loadLogo() : null,
    parts.has("tables") ? loadTables() : null,
    parts.has("orders") ? loadOrders() : null,
    parts.has("layout") ? loadLayout() : null,
  ]);
  if (base) lastBaseAt = Date.now();

  const restaurant = {
    ...state.restaurant,
    ...(base?.restaurant ?? {}),
    ...(logo === null ? {} : logo),
  };
  publish({
    ...(base
      ? {
          user: base.user,
          plan: base.plan,
          staff: base.staff,
          categories: base.categories,
          items: base.items,
        }
      : {}),
    ...(tables ?? {}),
    ...(orders ?? {}),
    ...(layout ?? {}),
    restaurant: sameShallow(restaurant, state.restaurant) ? state.restaurant : restaurant,
    loading: false,
    configured: true,
    connection: "connected",
    error: null,
  });
}

/** Recarrega as partes pedidas; pedidos feitos durante uma carga entram na próxima rodada. */
export function refreshData(parts: readonly RefreshPart[] = ALL_PARTS): Promise<void> {
  parts.forEach((part) => pendingParts.add(part));
  if (!refreshPromise && pendingParts.size) {
    refreshPromise = (async () => {
      while (pendingParts.size) {
        const batch = pendingParts;
        pendingParts = new Set();
        try {
          await loadRemoteData(batch);
        } catch (error) {
          publish({
            loading: false,
            configured: true,
            connection: "reconnecting",
            error: errorMessage(error),
          });
        }
      }
      refreshPromise = null;
    })();
  }
  return refreshPromise ?? Promise.resolve();
}

function queueRefresh(parts: readonly RefreshPart[]) {
  parts.forEach((part) => queuedParts.add(part));
  if (Date.now() - lastBaseAt > BASE_MAX_AGE) queuedParts.add("base");
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    const batch = [...queuedParts];
    queuedParts = new Set();
    void refreshData(batch);
  }, 100);
}

function stopRealtime() {
  if (realtimeChannel) void supabase.removeChannel(realtimeChannel);
  realtimeChannel = null;
  if (layoutChannel) void supabase.removeChannel(layoutChannel);
  layoutChannel = null;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  queuedParts = new Set();
}

/** Canal separado: se as tabelas de áreas não existirem, não derruba o canal principal. */
function startLayoutRealtime() {
  if (layoutChannel) return;
  const refreshLayout = () => queueRefresh(["layout"]);
  layoutChannel = supabase
    .channel("mesari-salao-layout")
    .on("postgres_changes", { event: "*", schema: "public", table: "salao_areas" }, refreshLayout)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "salao_elementos" },
      refreshLayout,
    )
    .subscribe();
}

function startRealtime() {
  if (realtimeChannel) return;
  realtimeChannel = supabase
    .channel("mesari-shared-restaurant-data")
    .on("postgres_changes", { event: "*", schema: "public", table: "mesas" }, () =>
      queueRefresh(["tables"]),
    )
    .on("postgres_changes", { event: "*", schema: "public", table: "itens_pedido" }, () =>
      queueRefresh(["orders"]),
    )
    // Venda nova não baixa nada aqui: só avisa quem mostra vendas (tela Vendas) para recarregar.
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "vendas" }, () =>
      publish({ salesVersion: state.salesVersion + 1 }),
    )
    .subscribe((status, error) => {
      if (status === "SUBSCRIBED") {
        publish({ connection: "connected", error: null });
        queueRefresh(LIVE_PARTS);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        publish({
          connection: "reconnecting",
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

/** "R$ 1.234,56": o mesmo formato da tela e da impressão. */
export const brl = (value: number) => money(value);

export function tableStatus(snapshot: Pick<State, "tables">, id: string): Status {
  const table = snapshot.tables.find((entry) => entry.id === id);
  if (!table?.status) throw new Error(`O status da mesa ${id} não foi carregado do Supabase.`);
  return table.status;
}

export const total = (lines: OrderLine[] = []) =>
  lines.reduce((sum, line) => sum + line.qty * line.price, 0);

/**
 * Valores da conta em centavos (subtotal, taxa de serviço e total). Mesma conta usada no
 * fechamento, no mapa, no painel e na nota de consumo.
 */
export function billTotals(lines: OrderLine[] = [], restaurant: State["restaurant"]) {
  const subtotalCents = Math.round(total(lines) * 100);
  const serviceChargeCents = restaurant.serviceChargeEnabled
    ? Math.round((subtotalCents * restaurant.serviceChargePercent) / 100)
    : 0;
  return { subtotalCents, serviceChargeCents, totalCents: subtotalCents + serviceChargeCents };
}
export const count = (lines: OrderLine[] = []) => lines.reduce((sum, line) => sum + line.qty, 0);
export const setStoreError = (error: unknown) => publish({ error: errorMessage(error) });

/** Conversão do logo base64 antigo para o Storage (uma por sessão). */
let logoMigration: Promise<void> | null = null;
let migratedLogo: { from: string; to: string } | null = null;

/** Logo em base64 vai para o Storage; URL (ou vazio) passa direto. */
async function storeLogo(logo: string) {
  if (!isDataUrl(logo)) return { url: logo, uploaded: null };
  const url = await uploadLogo(await dataUrlToBlob(logo));
  return { url, uploaded: url };
}

/**
 * Grava logo_url (e os outros campos, se vierem) e só então apaga o arquivo anterior do
 * bucket. Se a gravação falhar, o arquivo recém-enviado é que sai.
 */
async function saveLogo(logo: string, fields: Record<string, unknown> = {}) {
  const previous = state.restaurant.logo;
  const { url, uploaded } = await storeLogo(logo);
  const { error } = await supabase
    .from("restaurante")
    .update({ ...fields, logo_url: url })
    .eq("id", requireRestaurantId());
  if (error) {
    if (uploaded) await removeLogo(uploaded).catch(() => undefined);
    throw error;
  }
  // O logo novo já está salvo: falha ao apagar o antigo só deixa um arquivo sobrando.
  if (previous !== url) {
    await removeLogo(previous).catch((cause: unknown) =>
      console.warn("Logo antigo não foi apagado do Storage:", cause),
    );
  }
  return url;
}

/** Logo de impressão, ligar/desligar e rodapé (só depois da migration). */
async function savePrintSettings(restaurant: State["restaurant"]) {
  const previous = state.restaurant.printLogo;
  const next = restaurant.printLogo;
  const url = isDataUrl(next) ? await uploadPrintLogo(await dataUrlToBlob(next)) : next;
  const { error } = await supabase
    .from("restaurante")
    .update({
      logo_impressao_url: url,
      imprimir_logo: restaurant.printLogoEnabled && Boolean(url),
      rodape_conta: restaurant.receiptFooter,
    })
    .eq("id", requireRestaurantId());
  if (error) {
    if (url !== next) await removeLogo(url).catch(() => undefined);
    throw error;
  }
  if (previous && previous !== url) {
    await removeLogo(previous).catch((cause: unknown) =>
      console.warn("Logo de impressão antiga não foi apagada do Storage:", cause),
    );
  }
}

/** Grava e recarrega só as partes que a gravação pode ter mudado. */
async function writeRemote<T>(parts: readonly RefreshPart[], work: () => Promise<T>): Promise<T> {
  try {
    const result = await work();
    publish({ error: null });
    await refreshData(parts);
    return result;
  } catch (error) {
    setStoreError(error);
    throw error;
  }
}

export const actions = {
  async login(
    username: string,
    password: string,
    restaurantCode = savedRestaurantCode(),
  ): Promise<"caixa" | "garcom" | "cozinha" | false> {
    try {
      const isEmail = username.includes("@");
      const code = restaurantCode.trim();
      if (!isEmail && !/^\d{6}$/.test(code)) {
        throw new Error("Informe o código do restaurante (6 números).");
      }
      const { error } = await supabase.auth.signInWithPassword({
        email: usernameEmail(username, code),
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
    setRestaurantId(null);
    const { error } = await supabase.auth.signOut();
    if (error) setStoreError(error);
  },
  async addLine(tableId: string, item: MenuItem, qty: number, note: string, print = true) {
    return writeRemote(["orders", "tables"], async () => {
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
    return writeRemote(["orders", "tables"], async () => {
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
    return writeRemote(["base"], async () => {
      const { error } = await supabase.from("categorias").update({ setor: sector }).eq("id", id);
      if (error) throw error;
    });
  },
  async cleanKitchenOrders() {
    return writeRemote([], async () => {
      const { error } = await supabase.rpc("limpar_pedidos_cozinha");
      if (error) throw error;
    });
  },
  async removeLine(_tableId: string, lineId: string) {
    return writeRemote(["orders", "tables"], async () => {
      const { error } = await supabase.from("itens_pedido").delete().eq("id", lineId);
      if (error) throw error;
    });
  },
  /** Reserva a impressão da nota no banco; false = outro caixa já imprimiu ou não está pendente. */
  async reserveBillPrint(tableId: string): Promise<boolean> {
    const { data, error } = await supabase.rpc("reservar_nota_conta", { p_mesa_id: tableId });
    if (error) throw error;
    return data === true;
  },
  /** Pede uma nova impressão da nota: a estação de impressão do caixa imprime de novo. */
  async requestBillReprint(tableId: string) {
    return writeRemote(["tables"], async () => {
      const { error } = await supabase
        .from("mesas")
        .update({ nota_impressa_em: null })
        .eq("id", tableId);
      if (error) throw error;
    });
  },
  async requestBill(tableId: string) {
    return writeRemote(["tables"], async () => {
      const { error } = await supabase.rpc("solicitar_conta", { p_mesa_id: tableId });
      if (error) throw error;
    });
  },
  async closeBill(tableId: string, payments: PaymentInput[]): Promise<Closing> {
    return writeRemote(["orders", "tables"], async () => {
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
      const form = row.forma;
      if (
        form !== "dinheiro" &&
        form !== "pix" &&
        form !== "credito" &&
        form !== "debito" &&
        form !== "nao_informado"
      ) {
        throw new Error(`Forma de pagamento inválida recebida no resumo: ${String(form)}.`);
      }
      return { forma: form, total: Number(row.total), contas: Number(row.contas) };
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
  /** Uma página de vendas do período (mais recentes primeiro), já filtrada pela forma de pagamento. */
  async listSales(
    start: string,
    end: string,
    form: PaymentMethod | "todas",
    offset: number,
    pageSize = 50,
  ): Promise<{ sales: Closing[]; hasMore: boolean }> {
    let query = supabase
      .from("vendas")
      .select(SALE_COLUMNS)
      .gte("fechada_em", start)
      .lte("fechada_em", end);
    if (form === "nao_informado") query = query.eq("pagamentos", "[]");
    else if (form !== "todas") query = query.contains("pagamentos", [{ forma: form }]);
    // Pede um a mais só para saber se existe próxima página.
    const { data, error } = await query
      .order("fechada_em", { ascending: false })
      .range(offset, offset + pageSize);
    if (error) throw error;
    const sales = (data ?? []).map(mapClosing);
    return { sales: sales.slice(0, pageSize), hasMore: sales.length > pageSize };
  },
  /** Grava posição, formato, lugares e número das mesas informadas (cria as que forem novas). */
  async saveTableLayout(tables: Table[]) {
    if (!tables.length) return;
    return writeRemote(["tables"], async () => {
      const { error } = await supabase
        .from("mesas")
        .upsert(tables.map(tableRow), { onConflict: "id" });
      if (error) throw layoutError(error);
    });
  },
  /** Grava áreas, elementos e mesas do editor (nessa ordem, por causa das chaves estrangeiras). */
  async saveSalaoLayout(change: { tables: Table[]; areas: FloorArea[]; elements: FloorElement[] }) {
    if (!change.tables.length && !change.areas.length && !change.elements.length) return;
    if ((change.areas.length || change.elements.length) && !state.areasAvailable) {
      throw new Error(MISSING_AREAS);
    }
    return writeRemote(["layout", "tables"], async () => {
      if (change.areas.length) {
        const { error } = await supabase
          .from("salao_areas")
          .upsert(change.areas.map(areaRow), { onConflict: "id" });
        if (error) throw layoutError(error);
        // Áreas novas entram no estado antes de as mesas apontarem para elas (tableRow).
        const ids = new Set(state.areas.map((a) => a.id));
        publish({ areas: [...state.areas, ...change.areas.filter((a) => !ids.has(a.id))] });
      }
      if (change.elements.length) {
        const { error } = await supabase
          .from("salao_elementos")
          .upsert(change.elements.map(elementRow), { onConflict: "id" });
        if (error) throw layoutError(error);
      }
      if (change.tables.length) {
        const { error } = await supabase
          .from("mesas")
          .upsert(change.tables.map(tableRow), { onConflict: "id" });
        if (error) throw layoutError(error);
      }
    });
  },
  /** Exclui a área; o banco recusa se ainda houver mesa ativa dentro. Elementos vão junto. */
  async deleteArea(areaId: string) {
    if (state.areas.length <= 1) throw new Error("O salão precisa ter pelo menos uma área.");
    return writeRemote(["layout", "tables"], async () => {
      const { error } = await supabase.from("salao_areas").delete().eq("id", areaId);
      if (error) throw layoutError(error);
    });
  },
  async deleteElement(elementId: string) {
    return writeRemote(["layout"], async () => {
      const { error } = await supabase.from("salao_elementos").delete().eq("id", elementId);
      if (error) throw layoutError(error);
    });
  },
  /** Exclusão lógica (ativa = false), como antes; o banco recusa se houver pedido em aberto. */
  async deactivateTable(tableId: string) {
    if (state.orders[tableId]?.length) {
      const table = state.tables.find((entry) => entry.id === tableId);
      throw new Error(
        `A mesa ${String(table?.number ?? "").padStart(2, "0")} tem pedido em aberto. Feche a conta antes de excluir.`,
      );
    }
    return writeRemote(["tables"], async () => {
      const { error } = await supabase.from("mesas").update({ ativa: false }).eq("id", tableId);
      if (error) throw error;
    });
  },
  /** Próximo número livre, considerando também mesas desativadas (numero é único no banco). */
  async nextTableNumber() {
    const { data, error } = await supabase
      .from("mesas")
      .select("numero")
      .order("numero", { ascending: false })
      .limit(1);
    if (error) throw error;
    const highest = Array.isArray(data) && data[0] ? Number(asRow(data[0])["numero"]) : 0;
    return Math.max(highest, ...state.tables.map((table) => table.number)) + 1;
  },
  async saveItem(item: Omit<MenuItem, "id"> & { id?: string }) {
    return writeRemote(["base"], async () => {
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
    return writeRemote(["base"], async () => {
      const { error } = await supabase.from("produtos").update({ ativo: false }).eq("id", id);
      if (error) throw error;
    });
  },
  async addCategory(name: string): Promise<string> {
    return writeRemote(["base"], async () => {
      const { data, error } = await supabase
        .from("categorias")
        .insert({ nome: name, ordem: state.categories.length, setor: "nenhum" })
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
    return writeRemote(["base"], async () => {
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
    return writeRemote([], async () => {
      const { error } = await supabase.rpc("redefinir_senha", {
        p_usuario: username.trim().toLowerCase(),
        p_senha: password,
      });
      if (error) throw error;
    });
  },
  async deleteStaff(id: string) {
    return writeRemote(["base"], async () => {
      const { error } = await supabase.from("profiles").update({ ativo: false }).eq("id", id);
      if (error) throw error;
    });
  },
  /** Recarrega plano e uso (tela "Meu plano"). */
  async refreshPlan() {
    const { data, error } = await supabase.rpc("minha_assinatura");
    if (error) throw error;
    const plan = mapPlanInfo(data);
    publish({ plan });
    return plan;
  },
  markOrderSent(tableId: string) {
    publish({ orderSentMesaId: tableId });
  },
  clearOrderSent() {
    publish({ orderSentMesaId: null });
  },
  async updateRestaurant(restaurant: State["restaurant"]) {
    // Salvar durante a conversão do logo antigo: espera e usa a URL nova em vez do base64.
    await logoMigration?.catch(() => undefined);
    const logo = migratedLogo?.from === restaurant.logo ? migratedLogo.to : restaurant.logo;
    return writeRemote(["base", "logo"], async () => {
      await saveLogo(logo, {
        nome: restaurant.name,
        telefone: restaurant.phone,
        endereco: restaurant.address,
        cnpj: restaurant.cnpj,
        instagram: restaurant.instagram,
        taxa_servico_ativa: restaurant.serviceChargeEnabled,
        taxa_servico_percentual: restaurant.serviceChargePercent,
      });
      if (state.restaurant.printSettingsAvailable) await savePrintSettings(restaurant);
    });
  },
  /** Logo antigo em base64 no banco: comprime, envia ao Storage e grava só a URL. */
  migrateLogo() {
    const from = state.restaurant.logo;
    if (state.user?.role !== "caixa" || !isDataUrl(from)) return Promise.resolve();
    logoMigration ??= writeRemote(["logo"], async () => {
      migratedLogo = { from, to: await saveLogo(from) };
    }).finally(() => {
      logoMigration = null;
    });
    return logoMigration;
  },
  clearError() {
    publish({ error: null });
  },
  newId: () => crypto.randomUUID(),
};
