import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  EXTERNAL_ORDER_BOARD,
  EXTERNAL_ORDER_STATUS,
  isFinishedExternalOrder,
  parseExternalOrderStatus,
  type ExternalOrderStatus,
} from "@/lib/external-order-status";
import {
  supabase,
  supabaseAnonKey,
  supabaseProjectRef,
  supabaseUrl,
  usernameEmail,
} from "@/lib/supabase";

// Restaurante de demonstração para prints e apresentações de venda: "Restaurante
// Sabor do Agreste", em Surubim-PE. Usa só as funções que o app já usa
// (enviar_pedido, fechar_conta, criar_pedido_externo...), como se o caixa e os
// garçons tivessem trabalhado o dia. APAGA o salão e o cardápio atuais, por isso só
// roda no projeto de teste: o ref dele precisa estar em VITE_MESARI_TESTE_REF.

/** Ref do projeto mesari-teste, definido no .env do ambiente de teste. */
const TEST_PROJECT_REF: string = import.meta.env["VITE_MESARI_TESTE_REF"] ?? "";

/** Senha dos garçons de demonstração (só existem no projeto de teste). */
const DEMO_WAITER_PASSWORD = "agreste2026";

export function demoSeedAvailability(
  currentRef = supabaseProjectRef(),
  testRef = TEST_PROJECT_REF,
): { ok: true } | { ok: false; reason: string } {
  if (!testRef) {
    return {
      ok: false,
      reason:
        "Defina VITE_MESARI_TESTE_REF com o ref do projeto mesari-teste para liberar a demonstração.",
    };
  }
  if (currentRef !== testRef) {
    return {
      ok: false,
      reason: `Bloqueado: este app está ligado ao projeto "${currentRef || "desconhecido"}", não ao mesari-teste.`,
    };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ dados */

export const DEMO_RESTAURANT = {
  nome: "Restaurante Sabor do Agreste",
  endereco: "Rua Coronel Pedro Pinto, 215, Centro, Surubim - PE, 55750-000",
  telefone: "81996341234",
  cnpj: "",
  instagram: "",
  taxaEntrega: 6,
  taxaServico: 10,
};

type DemoCategory = { key: string; nome: string; setor: "cozinha" | "bar" };
const CATEGORIES: DemoCategory[] = [
  { key: "pratos", nome: "Pratos regionais", setor: "cozinha" },
  { key: "bebidas", nome: "Bebidas", setor: "bar" },
  { key: "sobremesas", nome: "Sobremesas", setor: "cozinha" },
];

type ProductKey =
  "baiao" | "carne" | "galinha" | "escondidinho" | "cerveja" | "refri" | "caja" | "cartola";
type DemoProduct = {
  key: ProductKey;
  categoria: string;
  nome: string;
  descricao: string;
  preco: number;
};
export const DEMO_PRODUCTS: DemoProduct[] = [
  {
    key: "baiao",
    categoria: "pratos",
    nome: "Baião de dois",
    descricao: "Arroz, feijão-de-corda, queijo coalho e nata. Serve 2.",
    preco: 32,
  },
  {
    key: "carne",
    categoria: "pratos",
    nome: "Carne de sol com macaxeira",
    descricao: "Carne de sol na manteiga de garrafa, macaxeira cozida e vinagrete.",
    preco: 54.9,
  },
  {
    key: "galinha",
    categoria: "pratos",
    nome: "Galinha guisada",
    descricao: "Galinha de capoeira guisada, arroz, feijão e farofa.",
    preco: 39.9,
  },
  {
    key: "escondidinho",
    categoria: "pratos",
    nome: "Escondidinho de charque",
    descricao: "Purê de macaxeira com charque acebolada e queijo gratinado.",
    preco: 36,
  },
  { key: "cerveja", categoria: "bebidas", nome: "Cerveja 600ml", descricao: "", preco: 13 },
  { key: "refri", categoria: "bebidas", nome: "Refrigerante lata", descricao: "", preco: 6 },
  {
    key: "caja",
    categoria: "bebidas",
    nome: "Suco de cajá",
    descricao: "Copo de 500ml.",
    preco: 8,
  },
  {
    key: "cartola",
    categoria: "sobremesas",
    nome: "Cartola",
    descricao: "Banana frita, queijo manteiga, açúcar e canela.",
    preco: 18,
  },
];
const PRICE = Object.fromEntries(
  DEMO_PRODUCTS.map((p) => [p.key, Math.round(p.preco * 100)]),
) as Record<ProductKey, number>;

type DemoWaiter = { key: "joao" | "maria" | "severino"; usuario: string; nome: string };
export const DEMO_WAITERS: DemoWaiter[] = [
  { key: "joao", usuario: "demo.joao", nome: "João Batista" },
  { key: "maria", usuario: "demo.maria", nome: "Maria das Dores" },
  { key: "severino", usuario: "demo.severino", nome: "Severino Lima" },
];

type Line = [ProductKey, number, string?];
type Forma = "pix" | "credito" | "debito" | "dinheiro";

/**
 * Vendas de mesa já fechadas hoje (R$ 1.553,70), no almoço (12h–14h) e no jantar
 * (19h–22h). Com os deliveries concluídos o dia fecha em R$ 1.782,40, a maior
 * parte em Pix. "hora" é o horário de São Paulo em que a conta foi fechada.
 */
export const DEMO_SALES: {
  hora: string;
  mesa: number;
  garcom: DemoWaiter["key"];
  itens: Line[];
  pagamentos: { forma: Forma; valor?: number; recebido?: number }[];
}[] = [
  {
    hora: "12:14",
    mesa: 12,
    garcom: "joao",
    itens: [
      ["carne", 1],
      ["baiao", 1],
      ["cerveja", 3],
    ],
    pagamentos: [{ forma: "pix" }],
  },
  {
    hora: "12:38",
    mesa: 13,
    garcom: "maria",
    itens: [
      ["carne", 2],
      ["cerveja", 4],
      ["refri", 1],
    ],
    pagamentos: [{ forma: "pix" }],
  },
  {
    hora: "13:02",
    mesa: 14,
    garcom: "severino",
    itens: [
      ["galinha", 1],
      ["escondidinho", 1],
      ["caja", 2],
    ],
    pagamentos: [{ forma: "debito" }],
  },
  {
    hora: "13:25",
    mesa: 15,
    garcom: "joao",
    itens: [
      ["carne", 1],
      ["galinha", 1],
      ["baiao", 1],
      ["cerveja", 6],
      ["cartola", 2],
    ],
    pagamentos: [{ forma: "pix" }],
  },
  {
    hora: "13:47",
    mesa: 16,
    garcom: "maria",
    itens: [
      ["escondidinho", 1],
      ["refri", 1],
      ["caja", 1],
    ],
    pagamentos: [{ forma: "dinheiro", recebido: 50 }],
  },
  {
    hora: "19:18",
    mesa: 17,
    garcom: "severino",
    itens: [
      ["baiao", 2],
      ["carne", 1],
      ["cerveja", 5],
    ],
    pagamentos: [{ forma: "credito" }],
  },
  {
    hora: "19:52",
    mesa: 12,
    garcom: "maria",
    itens: [
      ["galinha", 1],
      ["caja", 2],
      ["cartola", 1],
    ],
    pagamentos: [{ forma: "pix" }],
  },
  {
    hora: "20:24",
    mesa: 13,
    garcom: "joao",
    itens: [
      ["carne", 3],
      ["cerveja", 8],
      ["refri", 2],
    ],
    pagamentos: [
      { forma: "pix", valor: 180.7 },
      { forma: "credito", valor: 100 },
    ],
  },
  {
    hora: "20:51",
    mesa: 14,
    garcom: "severino",
    itens: [
      ["baiao", 1],
      ["escondidinho", 1],
      ["cerveja", 4],
    ],
    pagamentos: [{ forma: "debito" }],
  },
  {
    hora: "21:26",
    mesa: 15,
    garcom: "maria",
    itens: [
      ["carne", 1],
      ["galinha", 1],
      ["refri", 3],
      ["cartola", 1],
    ],
    pagamentos: [{ forma: "pix" }],
  },
  {
    hora: "21:44",
    mesa: 16,
    garcom: "joao",
    itens: [
      ["escondidinho", 2],
      ["caja", 2],
    ],
    pagamentos: [{ forma: "dinheiro", recebido: 100 }],
  },
];

/** Mesas abertas no jantar: 6 ocupadas, das quais 2 pedindo a conta. */
export const DEMO_OPEN_TABLES: {
  mesa: number;
  pedidos: { hora: string; garcom: DemoWaiter["key"]; itens: Line[] }[];
  pedindoConta?: boolean;
}[] = [
  {
    mesa: 2,
    pedidos: [
      {
        hora: "21:32",
        garcom: "joao",
        itens: [
          ["carne", 1, "bem passada"],
          ["cerveja", 2],
        ],
      },
    ],
  },
  {
    mesa: 4,
    pedindoConta: true,
    pedidos: [
      {
        hora: "20:41",
        garcom: "maria",
        itens: [
          ["baiao", 1],
          ["galinha", 1],
          ["caja", 3],
        ],
      },
      { hora: "21:18", garcom: "maria", itens: [["cartola", 2]] },
    ],
  },
  {
    mesa: 5,
    pedidos: [
      {
        hora: "21:10",
        garcom: "severino",
        itens: [
          ["escondidinho", 2, "sem cebola"],
          ["refri", 2],
        ],
      },
    ],
  },
  {
    mesa: 7,
    pedidos: [
      { hora: "21:05", garcom: "joao", itens: [["cerveja", 4]] },
      {
        hora: "21:22",
        garcom: "severino",
        itens: [
          ["carne", 1],
          ["baiao", 1],
        ],
      },
    ],
  },
  {
    mesa: 9,
    pedindoConta: true,
    pedidos: [
      {
        hora: "20:35",
        garcom: "maria",
        itens: [
          ["galinha", 2],
          ["refri", 1],
          ["caja", 1, "sem açúcar"],
        ],
      },
    ],
  },
  {
    mesa: 11,
    pedidos: [
      {
        hora: "21:40",
        garcom: "severino",
        itens: [
          ["baiao", 1],
          ["cerveja", 3, "bem gelada"],
        ],
      },
    ],
  },
];

type DeliveryStatus = Exclude<
  ExternalOrderStatus,
  typeof EXTERNAL_ORDER_STATUS.entregue | typeof EXTERNAL_ORDER_STATUS.cancelado
>;
type DemoDelivery = {
  hora: string;
  canal: "whatsapp" | "telefone" | "papel";
  tipo: "entrega" | "retirada";
  cliente: string;
  telefone: string;
  endereco: string;
  observacao: string;
  pagamento: { forma: Forma; pago: boolean; troco_para: number | null };
  itens: Line[];
  entregador?: string;
};

/** Delivery em andamento no jantar: um pedido em cada etapa do quadro. */
export const DEMO_DELIVERIES: (DemoDelivery & { status: DeliveryStatus })[] = [
  {
    status: EXTERNAL_ORDER_STATUS.novo,
    hora: "21:41",
    canal: "whatsapp",
    tipo: "entrega",
    cliente: "Ana Paula Souza",
    telefone: "81996543210",
    endereco: "Rua Severino Pinheiro, 120, Centro",
    observacao: "Casa de portão azul",
    pagamento: { forma: "pix", pago: true, troco_para: null },
    itens: [
      ["baiao", 1],
      ["caja", 2],
    ],
  },
  {
    status: EXTERNAL_ORDER_STATUS.preparo,
    hora: "21:28",
    canal: "telefone",
    tipo: "entrega",
    cliente: "José Cícero Araújo",
    telefone: "81997218844",
    endereco: "Av. Agamenon Magalhães, 455, São José",
    observacao: "",
    pagamento: { forma: "dinheiro", pago: false, troco_para: 100 },
    itens: [
      ["carne", 1],
      ["refri", 2],
    ],
  },
  {
    status: EXTERNAL_ORDER_STATUS.pronto,
    hora: "21:12",
    canal: "whatsapp",
    tipo: "retirada",
    cliente: "Luciana Barbosa",
    telefone: "81988127733",
    endereco: "",
    observacao: "Passa às 21h30",
    pagamento: { forma: "credito", pago: false, troco_para: null },
    itens: [
      ["escondidinho", 2, "um sem cebola"],
      ["cartola", 1],
    ],
  },
  {
    status: EXTERNAL_ORDER_STATUS.saiu,
    hora: "20:58",
    canal: "whatsapp",
    tipo: "entrega",
    cliente: "Família Tavares",
    telefone: "81999051276",
    endereco: "Rua do Rosário, 32, Bairro Novo",
    observacao: "",
    pagamento: { forma: "debito", pago: false, troco_para: null },
    itens: [
      ["galinha", 2],
      ["baiao", 1],
      ["refri", 3],
    ],
    entregador: "Cícero",
  },
];

/** Deliveries já concluídos e recebidos (2 entregas e 1 retirada): R$ 228,70. */
export const DEMO_DELIVERIES_DONE: (DemoDelivery & { recebidoEm: Forma })[] = [
  {
    hora: "12:31",
    canal: "whatsapp",
    tipo: "entrega",
    cliente: "Rafael Nunes",
    telefone: "81998874512",
    endereco: "Rua São Sebastião, 87, Centro",
    observacao: "",
    pagamento: { forma: "pix", pago: true, troco_para: null },
    itens: [
      ["carne", 1],
      ["refri", 2],
    ],
    entregador: "Cícero",
    recebidoEm: "pix",
  },
  {
    hora: "19:36",
    canal: "telefone",
    tipo: "entrega",
    cliente: "Maria do Socorro Lima",
    telefone: "81995532207",
    endereco: "Rua Joaquim Nabuco, 410, Cohab",
    observacao: "",
    pagamento: { forma: "credito", pago: false, troco_para: null },
    itens: [
      ["galinha", 2],
      ["caja", 2],
    ],
    entregador: "Cícero",
    recebidoEm: "credito",
  },
  {
    hora: "20:12",
    canal: "whatsapp",
    tipo: "retirada",
    cliente: "Marcos Vinícius",
    telefone: "81987650934",
    endereco: "",
    observacao: "",
    pagamento: { forma: "pix", pago: false, troco_para: null },
    itens: [
      ["escondidinho", 1],
      ["cartola", 1],
    ],
    recebidoEm: "pix",
  },
];

const TABLE_COUNT = 17;
const TABLE_SEATS = [4, 4, 2, 6, 4, 4, 2, 8, 4, 4, 6, 2, 4, 4, 4, 6, 8];

/** Total em centavos de uma lista de itens. */
export const linesTotalCents = (lines: Line[]) =>
  lines.reduce((sum, [key, qty]) => sum + PRICE[key] * qty, 0);

/** Total do delivery em centavos: itens + taxa de entrega (retirada não paga taxa). */
export const deliveryTotalCents = (order: DemoDelivery) =>
  linesTotalCents(order.itens) +
  (order.tipo === "entrega" ? Math.round(DEMO_RESTAURANT.taxaEntrega * 100) : 0);

/** Data de hoje em São Paulo ("2026-10-19"). */
function saoPauloToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** "13:25" de hoje em São Paulo (UTC-3, sem horário de verão) como ISO. */
export function serviceTime(hora: string, today = saoPauloToday()) {
  return new Date(`${today}T${hora}:00-03:00`).toISOString();
}

/** "20:40" + 35 → "21:15". */
export function addMinutes(hora: string, minutes: number) {
  const [h = 0, m = 0] = hora.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/* ---------------------------------------------------------------- execução */

type Progress = (message: string) => void;

function fail(step: string, error: { message?: string } | null | undefined): never {
  throw new Error(`${step}: ${error?.message ?? "erro desconhecido"}`);
}

async function check<T extends { error: { message?: string } | null }>(
  step: string,
  request: PromiseLike<T>,
) {
  const result = await request;
  if (result.error) fail(step, result.error);
  return result;
}

const rows = (data: unknown) => (Array.isArray(data) ? (data as Record<string, unknown>[]) : []);
const firstRow = (data: unknown) =>
  (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined;

/**
 * Horários: as funções do banco gravam "agora". Depois de criar, o seed tenta
 * mover cada registro para o horário do almoço/jantar. Se a permissão do banco
 * não deixar, a demonstração continua e o aviso aponta o script SQL.
 */
type Retime = { table: string; column: string; id: string; at: string };

async function applyRetimes(retimes: Retime[], warnings: string[]) {
  let blocked = 0;
  for (const item of retimes) {
    const { data, error } = await supabase
      .from(item.table)
      .update({ [item.column]: item.at })
      .eq("id", item.id)
      .select("id");
    if (error || rows(data).length === 0) blocked += 1;
  }
  if (blocked) {
    warnings.push(
      `O banco não deixou ajustar ${blocked} de ${retimes.length} horários (permissão). Para vendas e pedidos aparecerem entre 12h–14h e 19h–22h, rode supabase/scripts/demo-horarios.sql no SQL Editor do Supabase.`,
    );
  }
}

async function seedRestaurant(serviceCharge: boolean) {
  await check(
    "Dados do restaurante",
    supabase
      .from("restaurante")
      .update({
        nome: DEMO_RESTAURANT.nome,
        endereco: DEMO_RESTAURANT.endereco,
        telefone: DEMO_RESTAURANT.telefone,
        cnpj: DEMO_RESTAURANT.cnpj,
        instagram: DEMO_RESTAURANT.instagram,
        taxa_servico_ativa: serviceCharge,
        taxa_servico_percentual: DEMO_RESTAURANT.taxaServico,
      })
      .eq("id", 1),
  );
}

async function seedMenu(warnings: string[]) {
  const { data: existingCategories } = await check(
    "Ler categorias",
    supabase.from("categorias").select("id,nome"),
  );
  const categoryIds = new Map<string, string>();
  for (const [index, category] of CATEGORIES.entries()) {
    const found = rows(existingCategories).find(
      (row) => String(row["nome"]).trim().toLowerCase() === category.nome.toLowerCase(),
    );
    if (found) {
      await check(
        `Categoria ${category.nome}`,
        supabase
          .from("categorias")
          .update({ ordem: index, setor: category.setor })
          .eq("id", String(found["id"])),
      );
      categoryIds.set(category.key, String(found["id"]));
    } else {
      const { data } = await check(
        `Categoria ${category.nome}`,
        supabase
          .from("categorias")
          .insert({ nome: category.nome, ordem: index, setor: category.setor })
          .select("id")
          .single(),
      );
      categoryIds.set(category.key, String((data as Record<string, unknown>)["id"]));
    }
  }

  const { data: existingProducts } = await check(
    "Ler produtos",
    supabase.from("produtos").select("id,nome"),
  );
  const productIds = new Map<ProductKey, string>();
  for (const [index, product] of DEMO_PRODUCTS.entries()) {
    const row = {
      nome: product.nome,
      descricao: product.descricao,
      preco: product.preco,
      categoria_id: categoryIds.get(product.categoria),
      ativo: true,
      ordem: index,
    };
    const found = rows(existingProducts).find(
      (item) => String(item["nome"]).trim().toLowerCase() === product.nome.toLowerCase(),
    );
    if (found) {
      await check(
        `Produto ${product.nome}`,
        supabase.from("produtos").update(row).eq("id", String(found["id"])),
      );
      productIds.set(product.key, String(found["id"]));
    } else {
      const { data } = await check(
        `Produto ${product.nome}`,
        supabase.from("produtos").insert(row).select("id").single(),
      );
      productIds.set(product.key, String((data as Record<string, unknown>)["id"]));
    }
  }

  // Tira do cardápio o que não é da demonstração.
  const keep = new Set(productIds.values());
  const others = rows(existingProducts)
    .map((row) => String(row["id"]))
    .filter((id) => !keep.has(id));
  if (others.length) {
    await check(
      "Desativar produtos antigos",
      supabase.from("produtos").update({ ativo: false }).in("id", others),
    );
  }
  const otherCategories = rows(existingCategories)
    .map((row) => String(row["id"]))
    .filter((id) => ![...categoryIds.values()].includes(id));
  if (otherCategories.length) {
    const { error } = await supabase.from("categorias").delete().in("id", otherCategories);
    if (error) {
      warnings.push(
        `Não deu para apagar ${otherCategories.length} categoria(s) antiga(s) (${error.message}); elas ficam vazias no cardápio.`,
      );
    }
  }
  return productIds;
}

async function seedWaiters(): Promise<Map<DemoWaiter["key"], SupabaseClient>> {
  const clients = new Map<DemoWaiter["key"], SupabaseClient>();
  for (const waiter of DEMO_WAITERS) {
    const created = await supabase.rpc("criar_usuario", {
      p_usuario: waiter.usuario,
      p_senha: DEMO_WAITER_PASSWORD,
      p_nome: waiter.nome,
      p_papel: "garcom",
    });
    if (created.error) {
      // Já existe de uma demonstração anterior: garante a senha e o acesso ativo.
      await check(
        `Senha de ${waiter.usuario}`,
        supabase.rpc("redefinir_senha", {
          p_usuario: waiter.usuario,
          p_senha: DEMO_WAITER_PASSWORD,
        }),
      );
      await check(
        `Reativar ${waiter.usuario}`,
        supabase
          .from("profiles")
          .update({ ativo: true, nome: waiter.nome })
          .eq("usuario", waiter.usuario),
      );
    }
    // Sessão própria do garçom, sem mexer na sessão do caixa neste navegador.
    const client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: `mesari-demo-${waiter.usuario}`,
      },
    });
    await check(
      `Entrar como ${waiter.usuario}`,
      client.auth.signInWithPassword({
        email: usernameEmail(waiter.usuario),
        password: DEMO_WAITER_PASSWORD,
      }),
    );
    clients.set(waiter.key, client);
  }
  return clients;
}

async function seedTables() {
  const { data } = await check("Ler mesas", supabase.from("mesas").select("id,numero,ativa"));
  const existing = rows(data);
  const tableIds = new Map<number, string>();
  const upserts = Array.from({ length: TABLE_COUNT }, (_, index) => {
    const numero = index + 1;
    const found = existing.find((row) => Number(row["numero"]) === numero);
    const id = found ? String(found["id"]) : crypto.randomUUID();
    tableIds.set(numero, id);
    return {
      id,
      numero,
      lugares: TABLE_SEATS[index] ?? 4,
      ativa: true,
      pos_x: 20 + (index % 6) * 150,
      pos_y: 20 + Math.floor(index / 6) * 120,
    };
  });
  // Esvazia o salão antes: itens abertos de qualquer mesa saem.
  const { data: openItems } = await check(
    "Ler itens abertos",
    supabase.from("itens_pedido").select("id"),
  );
  const itemIds = rows(openItems).map((row) => String(row["id"]));
  if (itemIds.length) {
    await check("Limpar itens abertos", supabase.from("itens_pedido").delete().in("id", itemIds));
  }
  await check("Salvar 17 mesas", supabase.from("mesas").upsert(upserts, { onConflict: "id" }));
  const extra = existing
    .filter((row) => row["ativa"] === true && Number(row["numero"]) > TABLE_COUNT)
    .map((row) => String(row["id"]));
  if (extra.length) {
    await check(
      "Desativar mesas extras",
      supabase.from("mesas").update({ ativa: false }).in("id", extra),
    );
  }
  // Mesa que estava "pedindo conta" sem itens volta a ficar livre.
  const { data: statuses } = await check(
    "Ler status das mesas",
    supabase
      .from("mesas")
      .select("id,status")
      .in("id", [...tableIds.values()]),
  );
  const stuck = rows(statuses)
    .filter((row) => row["status"] && row["status"] !== "livre")
    .map((row) => String(row["id"]));
  if (stuck.length) {
    await check(
      "Liberar mesas",
      supabase.from("mesas").update({ status: "livre" }).in("id", stuck),
    );
  }
  return tableIds;
}

async function sendOrder(
  client: SupabaseClient,
  tableId: string,
  lines: Line[],
  productIds: Map<ProductKey, string>,
  step: string,
) {
  await check(
    step,
    client.rpc("enviar_pedido", {
      p_mesa_id: tableId,
      p_itens: lines.map(([key, quantidade, observacao]) => ({
        produto_id: productIds.get(key),
        quantidade,
        observacao: observacao ?? "",
      })),
      p_imprimir: false,
    }),
  );
}

async function tableItemIds(tableId: string) {
  const { data } = await check(
    "Ler itens da mesa",
    supabase.from("itens_pedido").select("id").eq("mesa_id", tableId),
  );
  return rows(data).map((row) => String(row["id"]));
}

async function cancelOpenDeliveries() {
  const { data } = await check(
    "Ler pedidos de delivery",
    supabase.from("pedidos_externos").select("id,status"),
  );
  for (const row of rows(data)) {
    const status = parseExternalOrderStatus(row["status"]);
    if (status && isFinishedExternalOrder(status)) continue;
    await check(
      "Cancelar delivery antigo",
      supabase.rpc("atualizar_status_pedido_externo", {
        p_id: String(row["id"]),
        p_status: EXTERNAL_ORDER_STATUS.cancelado,
        p_entregador: null,
        p_motivo: "Limpeza para a demonstração",
      }),
    );
  }
}

/** Cria o pedido de delivery e avança uma etapa por vez até `status`, como no quadro. */
async function createDelivery(
  order: DemoDelivery,
  status: DeliveryStatus,
  productIds: Map<ProductKey, string>,
) {
  const { data } = await check(
    `Delivery de ${order.cliente}`,
    supabase.rpc("criar_pedido_externo", {
      p_dados: {
        canal: order.canal,
        tipo: order.tipo,
        cliente_nome: order.cliente,
        telefone: order.telefone,
        endereco: order.endereco,
        observacao: order.observacao,
        pagamento_previsto: order.pagamento,
        itens: order.itens.map(([key, quantidade, observacao]) => ({
          produto_id: productIds.get(key),
          quantidade,
          observacao: observacao ?? "",
        })),
      },
      p_imprimir: false,
    }),
  );
  const result = firstRow(data);
  const id = String(result?.["id"] ?? result?.["pedido_id"] ?? "");
  if (!id) throw new Error(`Delivery de ${order.cliente}: o banco não retornou o id do pedido.`);
  for (const next of EXTERNAL_ORDER_BOARD.slice(1, EXTERNAL_ORDER_BOARD.indexOf(status) + 1)) {
    await check(
      `Delivery de ${order.cliente} → ${next}`,
      supabase.rpc("atualizar_status_pedido_externo", {
        p_id: id,
        p_status: next,
        p_entregador: next === EXTERNAL_ORDER_STATUS.saiu ? (order.entregador ?? null) : null,
        p_motivo: null,
      }),
    );
  }
  return id;
}

/**
 * Popula o restaurante de demonstração. Lança erro (com a etapa) se algo falhar;
 * retorna avisos que não impedem a demonstração.
 */
export async function seedDemoRestaurant(onProgress: Progress = () => {}) {
  const availability = demoSeedAvailability();
  if (!availability.ok) throw new Error(availability.reason);
  const warnings: string[] = [];
  const retimes: Retime[] = [];
  let waiters = new Map<DemoWaiter["key"], SupabaseClient>();
  try {
    onProgress("Dados do restaurante");
    // Sem taxa de serviço enquanto fecha as vendas: o pagamento bate com o subtotal.
    await seedRestaurant(false);
    await check(
      "Taxa de entrega",
      supabase.rpc("definir_taxa_entrega", { p_valor: DEMO_RESTAURANT.taxaEntrega }),
    );

    onProgress("Cardápio regional");
    const productIds = await seedMenu(warnings);

    onProgress("Garçons");
    waiters = await seedWaiters();
    const waiter = (key: DemoWaiter["key"]) => waiters.get(key)!;

    onProgress("Salão com 17 mesas");
    const tableIds = await seedTables();
    const table = (numero: number) => tableIds.get(numero)!;

    onProgress("Limpando delivery antigo");
    await cancelOpenDeliveries();

    for (const [index, sale] of DEMO_SALES.entries()) {
      onProgress(`Vendas do dia (${index + 1}/${DEMO_SALES.length})`);
      const tableId = table(sale.mesa);
      await sendOrder(waiter(sale.garcom), tableId, sale.itens, productIds, `Venda ${index + 1}`);
      const totalCents = linesTotalCents(sale.itens);
      const pagamentos = sale.pagamentos.map((payment) => ({
        forma: payment.forma,
        valor: payment.valor ?? totalCents / 100,
        ...(payment.recebido !== undefined ? { recebido: payment.recebido } : {}),
      }));
      const { data } = await check(
        `Fechar venda ${index + 1}`,
        supabase.rpc("fechar_conta", { p_mesa_id: tableId, p_pagamentos: pagamentos }),
      );
      const saleId = firstRow(data)?.["id"];
      if (saleId) {
        retimes.push({
          table: "vendas",
          column: "fechada_em",
          id: String(saleId),
          at: serviceTime(sale.hora),
        });
      }
    }

    onProgress("Deliveries concluídos");
    for (const order of DEMO_DELIVERIES_DONE) {
      const id = await createDelivery(
        order,
        order.tipo === "entrega" ? EXTERNAL_ORDER_STATUS.saiu : EXTERNAL_ORDER_STATUS.pronto,
        productIds,
      );
      await check(
        `Concluir delivery de ${order.cliente}`,
        supabase.rpc("concluir_pedido_externo", {
          p_id: id,
          p_pagamentos: [{ forma: order.recebidoEm, valor: deliveryTotalCents(order) / 100 }],
        }),
      );
      retimes.push({
        table: "pedidos_externos",
        column: "criado_em",
        id,
        at: serviceTime(order.hora),
      });
      // A venda do delivery é gravada pelo banco; acha a mais recente desse cliente.
      const { data: sale } = await check(
        `Venda do delivery de ${order.cliente}`,
        supabase
          .from("vendas")
          .select("id")
          .eq("cliente_nome", order.cliente)
          .order("fechada_em", { ascending: false })
          .limit(1),
      );
      const saleId = firstRow(sale)?.["id"];
      if (saleId) {
        // Recebido uns 35 minutos depois do pedido.
        retimes.push({
          table: "vendas",
          column: "fechada_em",
          id: String(saleId),
          at: serviceTime(addMinutes(order.hora, 35)),
        });
      }
    }

    onProgress("Mesas ocupadas");
    for (const open of DEMO_OPEN_TABLES) {
      let seen = new Set(await tableItemIds(table(open.mesa)));
      for (const order of open.pedidos) {
        await sendOrder(
          waiter(order.garcom),
          table(open.mesa),
          order.itens,
          productIds,
          `Mesa ${open.mesa}`,
        );
        const now = await tableItemIds(table(open.mesa));
        for (const id of now.filter((itemId) => !seen.has(itemId))) {
          retimes.push({
            table: "itens_pedido",
            column: "criado_em",
            id,
            at: serviceTime(order.hora),
          });
        }
        seen = new Set(now);
      }
      if (open.pedindoConta) {
        await check(
          `Conta da mesa ${open.mesa}`,
          supabase.rpc("solicitar_conta", { p_mesa_id: table(open.mesa) }),
        );
      }
    }

    onProgress("Pedidos de delivery");
    for (const order of DEMO_DELIVERIES) {
      const id = await createDelivery(order, order.status, productIds);
      retimes.push({
        table: "pedidos_externos",
        column: "criado_em",
        id,
        at: serviceTime(order.hora),
      });
    }

    onProgress("Horários do dia");
    await applyRetimes(retimes, warnings);

    onProgress("Taxa de serviço");
    await seedRestaurant(true);
  } finally {
    await Promise.all([...waiters.values()].map((client) => client.auth.signOut()));
  }
  return { warnings };
}
