// Regras do pedido montado pelo robô do WhatsApp — sem rede e sem Supabase, para dar para testar.
//
// A IA só sugere: quem decide preço, total, o que falta e quando lançar é este código.
// - item fora do cardápio é descartado (a IA não inventa produto nem preço);
// - o resumo com valores é montado aqui, nunca pela IA;
// - o pedido só é lançado depois que o cliente viu o resumo e confirmou.

export type FormaPagamento = "dinheiro" | "pix" | "credito" | "debito";
export type TipoPedido = "entrega" | "retirada";
export type Etapa = "coletando" | "confirmando";
export type AcaoIA = "continuar" | "pedir_confirmacao" | "confirmar" | "chamar_humano";

export type ProdutoCardapio = {
  id: string;
  nome: string;
  preco: number;
  descricao?: string;
  categoria?: string;
};

export type ItemRascunho = { produto_id: string; quantidade: number; observacao: string };

export type Rascunho = {
  tipo: TipoPedido | null;
  cliente_nome: string | null;
  endereco: string | null;
  referencia: string | null;
  pagamento: FormaPagamento | null;
  troco_para: number | null;
  observacao: string | null;
  itens: ItemRascunho[];
};

export const rascunhoVazio = (): Rascunho => ({
  tipo: null,
  cliente_nome: null,
  endereco: null,
  referencia: null,
  pagamento: null,
  troco_para: null,
  observacao: null,
  itens: [],
});

const FORMAS: readonly FormaPagamento[] = ["dinheiro", "pix", "credito", "debito"];
const ACOES: readonly AcaoIA[] = ["continuar", "pedir_confirmacao", "confirmar", "chamar_humano"];

function registro(valor: unknown): Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

function texto(valor: unknown, max = 300): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim().slice(0, max);
  return limpo ? limpo : null;
}

const centavos = (valor: number) => Math.round(valor * 100);

export function brl(valor: number) {
  const fixo = (centavos(valor) / 100).toFixed(2).split(".");
  const inteiro = (fixo[0] ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${inteiro},${fixo[1] ?? "00"}`;
}

/** Converte o que a IA devolveu em um rascunho válido, descartando o que não existe no cardápio. */
export function normalizarRascunho(
  bruto: unknown,
  cardapio: readonly ProdutoCardapio[],
): { rascunho: Rascunho; descartados: string[] } {
  const r = registro(bruto);
  const ids = new Set(cardapio.map((p) => p.id));
  const descartados: string[] = [];
  const porProduto = new Map<string, ItemRascunho>();

  for (const valor of Array.isArray(r["itens"]) ? r["itens"] : []) {
    const item = registro(valor);
    const id = typeof item["produto_id"] === "string" ? item["produto_id"].trim() : "";
    if (!ids.has(id)) {
      descartados.push(id || "(sem id)");
      continue;
    }
    const qtd = Math.trunc(Number(item["quantidade"]));
    if (!Number.isFinite(qtd) || qtd < 1) continue;
    const obs = texto(item["observacao"], 140) ?? "";
    // Mesmo produto com a mesma observação vira uma linha só.
    const chave = `${id}|${obs.toLowerCase()}`;
    const atual = porProduto.get(chave);
    porProduto.set(chave, {
      produto_id: id,
      quantidade: Math.min(99, (atual?.quantidade ?? 0) + qtd),
      observacao: obs,
    });
  }

  const tipo = r["tipo"] === "entrega" || r["tipo"] === "retirada" ? r["tipo"] : null;
  const forma = FORMAS.find((f) => f === r["pagamento"]) ?? null;
  const troco = Number(r["troco_para"]);

  return {
    rascunho: {
      tipo,
      cliente_nome: texto(r["cliente_nome"], 80),
      endereco: tipo === "retirada" ? null : texto(r["endereco"], 200),
      referencia: tipo === "retirada" ? null : texto(r["referencia"], 120),
      pagamento: forma,
      troco_para: forma === "dinheiro" && Number.isFinite(troco) && troco > 0 ? troco : null,
      observacao: texto(r["observacao"], 200),
      itens: [...porProduto.values()].slice(0, 60),
    },
    descartados,
  };
}

export function totais(
  rascunho: Rascunho,
  cardapio: readonly ProdutoCardapio[],
  taxaEntrega: number,
) {
  const precos = new Map(cardapio.map((p) => [p.id, p.preco]));
  const sub = rascunho.itens.reduce(
    (soma, item) => soma + centavos(precos.get(item.produto_id) ?? 0) * item.quantidade,
    0,
  );
  const taxa = rascunho.tipo === "entrega" ? centavos(taxaEntrega) : 0;
  return { subtotal: sub / 100, taxa: taxa / 100, total: (sub + taxa) / 100 };
}

/** O que ainda falta para lançar, em palavras para o cliente. Vazio = pode confirmar. */
export function faltando(rascunho: Rascunho): string[] {
  const falta: string[] = [];
  if (!rascunho.itens.length) falta.push("o que você vai querer");
  if (!rascunho.tipo) falta.push("se é para entrega ou retirada");
  if (!rascunho.cliente_nome) falta.push("seu nome");
  if (rascunho.tipo === "entrega" && !rascunho.endereco) falta.push("o endereço de entrega");
  if (!rascunho.pagamento) falta.push("a forma de pagamento (Pix, dinheiro, crédito ou débito)");
  return falta;
}

const nomeForma: Record<FormaPagamento, string> = {
  dinheiro: "Dinheiro",
  pix: "Pix",
  credito: "Cartão de crédito",
  debito: "Cartão de débito",
};

export function resumo(
  rascunho: Rascunho,
  cardapio: readonly ProdutoCardapio[],
  taxaEntrega: number,
) {
  const produtos = new Map(cardapio.map((p) => [p.id, p]));
  const { subtotal, taxa, total } = totais(rascunho, cardapio, taxaEntrega);
  const linhas = rascunho.itens.map((item) => {
    const p = produtos.get(item.produto_id);
    const obs = item.observacao ? ` (${item.observacao})` : "";
    return `• ${item.quantidade}x ${p?.nome ?? "?"}${obs} — ${brl((p?.preco ?? 0) * item.quantidade)}`;
  });
  const partes = ["*Seu pedido:*", ...linhas, "", `Subtotal: ${brl(subtotal)}`];
  if (rascunho.tipo === "entrega") partes.push(`Entrega: ${brl(taxa)}`);
  partes.push(`*Total: ${brl(total)}*`, "");
  partes.push(
    rascunho.tipo === "entrega" ? `Entrega em: ${rascunho.endereco}` : "Retirada no local",
  );
  if (rascunho.referencia) partes.push(`Referência: ${rascunho.referencia}`);
  if (rascunho.pagamento) {
    const troco =
      rascunho.troco_para && rascunho.troco_para >= total
        ? ` (troco para ${brl(rascunho.troco_para)})`
        : "";
    partes.push(`Pagamento: ${nomeForma[rascunho.pagamento]}${troco}`);
  }
  if (rascunho.cliente_nome) partes.push(`Nome: ${rascunho.cliente_nome}`);
  if (rascunho.observacao) partes.push(`Obs.: ${rascunho.observacao}`);
  partes.push("", "Está tudo certo? Responda *SIM* para confirmar ou me diga o que mudar.");
  return partes.join("\n");
}

const SIM =
  /^\s*(sim|s|ss|isso|isso mesmo|confirmo|confirma|confirmado|pode|pode sim|pode mandar|ok|okay|blz|beleza|fechado|certo|t[aá] certo|manda|bora)\s*[.!👍]*\s*$/i;
export const pareceConfirmacao = (mensagem: string) => SIM.test(mensagem);

function mesmoPedido(a: Rascunho, b: Rascunho) {
  const chave = (r: Rascunho) =>
    JSON.stringify({
      ...r,
      itens: r.itens.map((i) => `${i.produto_id}|${i.quantidade}|${i.observacao}`).sort(),
    });
  return chave(a) === chave(b);
}

export type Decisao =
  | { tipo: "responder"; texto: string; etapa: Etapa }
  | { tipo: "lancar" }
  | { tipo: "humano"; texto: string };

/**
 * Decide o próximo passo a partir da resposta da IA.
 * O pedido lançado é sempre o do resumo que o cliente viu ("anterior"): só lança na etapa
 * "confirmando", com o pedido completo, quando o cliente diz um "sim" claro ou a IA confirma
 * sem ter mudado nada. Se algo mudou, mostra o resumo de novo.
 */
export function decidir(params: {
  acao: unknown;
  respostaIA: unknown;
  etapaAnterior: Etapa;
  anterior: Rascunho;
  atual: Rascunho;
  mensagemCliente: string;
  cardapio: readonly ProdutoCardapio[];
  taxaEntrega: number;
}): Decisao {
  const acao = ACOES.find((a) => a === params.acao) ?? "continuar";
  const resposta = texto(params.respostaIA, 1000);
  const falta = faltando(params.atual);

  if (acao === "chamar_humano") {
    return {
      tipo: "humano",
      texto: resposta ?? "Vou chamar alguém da equipe para te atender, só um instante.",
    };
  }

  if (params.etapaAnterior === "confirmando" && faltando(params.anterior).length === 0) {
    const simClaro = pareceConfirmacao(params.mensagemCliente);
    const iaConfirmouSemMudar = acao === "confirmar" && mesmoPedido(params.anterior, params.atual);
    if (simClaro || iaConfirmouSemMudar) return { tipo: "lancar" };
  }

  const mudouDepoisDoResumo =
    params.etapaAnterior === "confirmando" && !mesmoPedido(params.anterior, params.atual);
  if (
    (acao === "pedir_confirmacao" || acao === "confirmar" || mudouDepoisDoResumo) &&
    falta.length === 0
  ) {
    return {
      tipo: "responder",
      texto: resumo(params.atual, params.cardapio, params.taxaEntrega),
      etapa: "confirmando",
    };
  }

  if (acao !== "continuar" && falta.length > 0) {
    return {
      tipo: "responder",
      texto: `Quase lá! Só preciso de: ${falta.join(", ")}.`,
      etapa: "coletando",
    };
  }

  return {
    tipo: "responder",
    texto: resposta ?? (falta.length ? `Me diz ${falta[0]}?` : "Pode me dizer o que mais deseja?"),
    etapa: "coletando",
  };
}

/** Dados no formato da criar_pedido_externo (mesma função do Delivery). */
export function dadosDoPedido(
  rascunho: Rascunho,
  telefone: string,
  cardapio: readonly ProdutoCardapio[],
  taxaEntrega: number,
) {
  const fone = telefone.replace(/\D/g, "");
  const { total } = totais(rascunho, cardapio, taxaEntrega);
  return {
    canal: "whatsapp",
    tipo: rascunho.tipo,
    cliente_nome: rascunho.cliente_nome,
    // A função do banco aceita DDD + número (10 a 13 dígitos); fora disso vai sem telefone.
    telefone: fone.length >= 10 && fone.length <= 13 ? fone : null,
    endereco: rascunho.tipo === "entrega" ? rascunho.endereco : "",
    referencia: rascunho.referencia ?? "",
    observacao: rascunho.observacao ?? "",
    pagamento_previsto: {
      forma: rascunho.pagamento,
      pago: false,
      troco_para:
        rascunho.pagamento === "dinheiro" && rascunho.troco_para && rascunho.troco_para >= total
          ? rascunho.troco_para
          : null,
    },
    itens: rascunho.itens.map((i) => ({
      produto_id: i.produto_id,
      quantidade: i.quantidade,
      observacao: i.observacao,
    })),
  };
}

/** Instruções do robô. O cardápio vai com os ids para a IA devolver o produto certo. */
export function instrucoesDoRobo(params: {
  restaurante: string;
  cardapio: readonly ProdutoCardapio[];
  taxaEntrega: number;
  instrucoesDono: string;
  rascunho: Rascunho;
  etapa: Etapa;
}) {
  const cardapio = params.cardapio
    .map(
      (p) =>
        `- id=${p.id} | ${p.categoria ? `[${p.categoria}] ` : ""}${p.nome} | ${brl(p.preco)}${p.descricao ? ` | ${p.descricao}` : ""}`,
    )
    .join("\n");
  return `Você é o atendente virtual do restaurante "${params.restaurante}" no WhatsApp. Seu único trabalho é anotar pedidos de delivery ou retirada.

COMO FALAR
- Português do Brasil, simpático e curto (1 a 3 frases), como uma pessoa no WhatsApp.
- Pergunte uma coisa de cada vez. Não repita o pedido inteiro a cada mensagem.
- Nunca diga que é uma IA a menos que perguntem diretamente.

REGRAS DO PEDIDO
- Só existem os produtos do CARDÁPIO abaixo. Use exatamente o id do produto em "itens".
- Se o cliente pedir algo que não está no cardápio, diga que não tem e sugira o mais parecido.
- Se o pedido for ambíguo (ex.: "um cuscuz" e há vários), pergunte qual antes de adicionar.
- Detalhes do item (sem cebola, bem passado, sabor) vão em "observacao" do item.
- Nunca invente preço, prazo de entrega, promoção ou taxa. Taxa de entrega: ${brl(params.taxaEntrega)}.
- "pedido" deve trazer SEMPRE o pedido completo atualizado (não só o que mudou). Mantenha o que já foi informado.
- Para fechar são obrigatórios: itens, entrega ou retirada, nome, endereço (se entrega) e forma de pagamento (dinheiro, pix, credito ou debito). Troco só se for dinheiro.

AÇÕES
- "continuar": ainda falta informação ou o cliente está escolhendo.
- "pedir_confirmacao": tudo obrigatório foi informado. O sistema mostra o resumo com os valores; não escreva o resumo você mesmo.
- "confirmar": SOMENTE se o resumo já foi mostrado (etapa atual = confirmando) e o cliente concordou sem pedir mudanças.
- "chamar_humano": reclamação, problema com pedido anterior, pedido de falar com uma pessoa, ou assunto que não é pedido.
${params.instrucoesDono.trim() ? `\nINSTRUÇÕES DO RESTAURANTE (siga sempre)\n${params.instrucoesDono.trim()}\n` : ""}
CARDÁPIO
${cardapio || "(cardápio vazio — chame um humano)"}

ESTADO ATUAL
etapa: ${params.etapa}
pedido: ${JSON.stringify(params.rascunho)}`;
}

/** Formato de resposta exigido da IA (Gemini responseSchema). */
export const esquemaResposta = {
  type: "OBJECT",
  properties: {
    resposta: { type: "STRING", description: "Mensagem para o cliente" },
    acao: { type: "STRING", enum: [...ACOES] },
    pedido: {
      type: "OBJECT",
      properties: {
        tipo: { type: "STRING", enum: ["entrega", "retirada"], nullable: true },
        cliente_nome: { type: "STRING", nullable: true },
        endereco: { type: "STRING", nullable: true },
        referencia: { type: "STRING", nullable: true },
        pagamento: { type: "STRING", enum: [...FORMAS], nullable: true },
        troco_para: { type: "NUMBER", nullable: true },
        observacao: { type: "STRING", nullable: true },
        itens: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              produto_id: { type: "STRING" },
              quantidade: { type: "INTEGER" },
              observacao: { type: "STRING", nullable: true },
            },
            required: ["produto_id", "quantidade"],
          },
        },
      },
      required: ["itens"],
    },
  },
  required: ["resposta", "acao", "pedido"],
} as const;
