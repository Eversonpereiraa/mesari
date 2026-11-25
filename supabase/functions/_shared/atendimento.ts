// Atendimento do WhatsApp: recebe a mensagem do cliente, pergunta à IA, aplica as regras de
// pedido-whatsapp.ts, grava tudo e responde (no simulador só grava; no WhatsApp envia pela Meta).
//
// Secrets (Supabase → Edge Functions → Secrets):
//   GEMINI_API_KEY   chave do Google AI Studio (aistudio.google.com/apikey) — obrigatória
//   GEMINI_MODEL     opcional. Padrão: gemini-flash-latest
//   WHATSAPP_GRAPH_VERSION  opcional. Padrão: v23.0
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  dadosDoPedido,
  decidir,
  esquemaResposta,
  instrucoesDoRobo,
  normalizarRascunho,
  rascunhoVazio,
  type Etapa,
  type ProdutoCardapio,
  type Rascunho,
} from "./pedido-whatsapp.ts";

export type Canal = "simulador" | "whatsapp";
type Linha = Record<string, unknown>;

export class ErroAtendimento extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Restaurante pode usar? (mesma regra do Delivery: plano com delivery e assinatura em dia) */
export async function verificarPlano(admin: SupabaseClient, restauranteId: number) {
  const [plano, ativa] = await Promise.all([
    admin.rpc("plano_do_restaurante", { p_restaurante: restauranteId }),
    admin.rpc("assinatura_ativa", { p_restaurante: restauranteId }),
  ]);
  if (plano.error) throw plano.error;
  if (ativa.error) throw ativa.error;
  const p = (Array.isArray(plano.data) ? plano.data[0] : plano.data) as Linha | null;
  if (ativa.data !== true) {
    throw new ErroAtendimento('A assinatura do Mesari venceu. Renove em "Meu plano".', 402);
  }
  if (p?.["delivery"] !== true) {
    throw new ErroAtendimento(
      "O WhatsApp com atendente automático está disponível a partir do plano Profissional.",
      402,
    );
  }
}

async function carregarContexto(admin: SupabaseClient, restauranteId: number) {
  const [rest, prods, cats, conf] = await Promise.all([
    admin.from("restaurante").select("nome,taxa_entrega").eq("id", restauranteId).maybeSingle(),
    admin
      .from("produtos")
      .select("id,nome,preco,descricao,categoria_id")
      .eq("restaurante_id", restauranteId)
      .eq("ativo", true)
      .order("ordem")
      .limit(400),
    admin.from("categorias").select("id,nome").eq("restaurante_id", restauranteId),
    admin
      .from("whatsapp_config")
      .select("robo_ativo,instrucoes")
      .eq("restaurante_id", restauranteId)
      .maybeSingle(),
  ]);
  for (const r of [rest, prods, cats, conf]) if (r.error) throw r.error;
  const categorias = new Map((cats.data ?? []).map((c: Linha) => [str(c["id"]), str(c["nome"])]));
  const cardapio: ProdutoCardapio[] = (prods.data ?? []).map((p: Linha) => ({
    id: str(p["id"]),
    nome: str(p["nome"]),
    preco: Number(p["preco"] ?? 0),
    descricao: str(p["descricao"]),
    categoria: categorias.get(str(p["categoria_id"])) ?? "",
  }));
  const r = (rest.data ?? {}) as Linha;
  const c = (conf.data ?? {}) as Linha;
  return {
    restaurante: str(r["nome"]) || "nosso restaurante",
    taxaEntrega: Number(r["taxa_entrega"] ?? 0),
    cardapio,
    roboAtivo: c["robo_ativo"] !== false,
    instrucoes: str(c["instrucoes"]),
  };
}

async function obterConversa(
  admin: SupabaseClient,
  restauranteId: number,
  canal: Canal,
  telefone: string,
  nome: string | null,
) {
  const { data, error } = await admin
    .from("whatsapp_conversas")
    .select("*")
    .eq("restaurante_id", restauranteId)
    .eq("canal", canal)
    .eq("telefone", telefone)
    .maybeSingle();
  if (error) throw error;
  if (data) return data as Linha;
  const novo = await admin
    .from("whatsapp_conversas")
    .insert({ restaurante_id: restauranteId, canal, telefone, cliente_nome: nome })
    .select("*")
    .single();
  // Duas mensagens ao mesmo tempo do mesmo cliente: a outra criou primeiro.
  if (novo.error?.code === "23505")
    return obterConversa(admin, restauranteId, canal, telefone, nome);
  if (novo.error) throw novo.error;
  return novo.data as Linha;
}

async function registrar(
  admin: SupabaseClient,
  conversa: Linha,
  autor: "cliente" | "bot" | "atendente" | "sistema",
  texto: string,
  extras: { metaId?: string; erroEnvio?: string } = {},
) {
  const { data, error } = await admin
    .from("whatsapp_mensagens")
    .insert({
      restaurante_id: conversa["restaurante_id"],
      conversa_id: conversa["id"],
      autor,
      texto,
      meta_id: extras.metaId ?? null,
      erro_envio: extras.erroEnvio ?? null,
    })
    .select("id")
    .single();
  if (error?.code === "23505") return null; // a Meta reenviou a mesma mensagem
  if (error) throw error;
  return data;
}

async function historico(admin: SupabaseClient, conversaId: string) {
  const { data, error } = await admin
    .from("whatsapp_mensagens")
    .select("autor,texto")
    .eq("conversa_id", conversaId)
    .order("criado_em", { ascending: false })
    .limit(24);
  if (error) throw error;
  return ((data ?? []) as Linha[]).reverse();
}

/** Mensagens no formato do Gemini: começa no cliente e junta falas seguidas do mesmo lado. */
function conteudosGemini(mensagens: Linha[]) {
  const conteudos: { role: "user" | "model"; parts: { text: string }[] }[] = [];
  for (const m of mensagens) {
    const autor = str(m["autor"]);
    if (autor === "sistema") continue;
    const role = autor === "cliente" ? "user" : "model";
    if (!conteudos.length && role === "model") continue;
    const ultimo = conteudos.at(-1);
    if (ultimo?.role === role) ultimo.parts.push({ text: str(m["texto"]) });
    else conteudos.push({ role, parts: [{ text: str(m["texto"]) }] });
  }
  return conteudos;
}

async function perguntarIA(instrucoes: string, mensagens: Linha[]) {
  const chave = Deno.env.get("GEMINI_API_KEY");
  if (!chave)
    throw new ErroAtendimento("GEMINI_API_KEY não configurada nas Secrets do Supabase.", 503);
  const modelo = Deno.env.get("GEMINI_MODEL") || "gemini-flash-latest";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": chave },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: instrucoes }] },
        contents: conteudosGemini(mensagens),
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: esquemaResposta,
        },
      }),
      signal: AbortSignal.timeout(25_000),
    },
  );
  const corpo = (await res.json().catch(() => ({}))) as Linha;
  if (!res.ok) {
    const msg = str((corpo["error"] as Linha | undefined)?.["message"]) || `HTTP ${res.status}`;
    throw new Error(`IA indisponível: ${msg}`);
  }
  const candidato = (corpo["candidates"] as Linha[] | undefined)?.[0];
  const partes =
    ((candidato?.["content"] as Linha | undefined)?.["parts"] as Linha[] | undefined) ?? [];
  const texto = partes.map((p) => str(p["text"])).join("");
  try {
    return JSON.parse(texto) as Linha;
  } catch {
    throw new Error("A IA respondeu fora do formato esperado.");
  }
}

/** Envia texto pela API oficial (Cloud API). Sem credencial, devolve o motivo em vez de lançar. */
export async function enviarWhatsApp(
  admin: SupabaseClient,
  restauranteId: number,
  para: string,
  texto: string,
) {
  const { data, error } = await admin
    .from("whatsapp_credenciais")
    .select("phone_number_id,access_token")
    .eq("restaurante_id", restauranteId)
    .maybeSingle();
  if (error) return `Credencial: ${error.message}`;
  if (!data) return "Número do WhatsApp não conectado a este restaurante.";
  const versao = Deno.env.get("WHATSAPP_GRAPH_VERSION") || "v23.0";
  const res = await fetch(`https://graph.facebook.com/${versao}/${data.phone_number_id}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.access_token}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: para,
      type: "text",
      text: { body: texto.slice(0, 4096), preview_url: false },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.ok) return null;
  const corpo = (await res.json().catch(() => ({}))) as Linha;
  return str((corpo["error"] as Linha | undefined)?.["message"]) || `Meta respondeu ${res.status}`;
}

async function responder(
  admin: SupabaseClient,
  conversa: Linha,
  autor: "bot" | "atendente" | "sistema",
  texto: string,
) {
  let erroEnvio: string | null = null;
  if (conversa["canal"] === "whatsapp") {
    erroEnvio = await enviarWhatsApp(
      admin,
      Number(conversa["restaurante_id"]),
      str(conversa["telefone"]),
      texto,
    ).catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
  }
  await registrar(admin, conversa, autor, texto, erroEnvio ? { erroEnvio } : {});
}

async function atualizarConversa(admin: SupabaseClient, id: unknown, campos: Linha) {
  const { error } = await admin.from("whatsapp_conversas").update(campos).eq("id", id);
  if (error) throw error;
}

/** Mensagem nova do cliente (simulador ou WhatsApp real). */
export async function processarMensagemCliente(
  admin: SupabaseClient,
  params: {
    restauranteId: number;
    canal: Canal;
    telefone: string;
    nome: string | null;
    texto: string;
    metaId?: string;
  },
) {
  const texto = params.texto.trim().slice(0, 2000);
  if (!texto) throw new ErroAtendimento("Mensagem vazia.");
  const conversa = await obterConversa(
    admin,
    params.restauranteId,
    params.canal,
    params.telefone,
    params.nome,
  );
  const gravada = await registrar(
    admin,
    conversa,
    "cliente",
    texto,
    params.metaId ? { metaId: params.metaId } : {},
  );
  if (!gravada) return { conversaId: conversa["id"], duplicada: true };

  // Pedido lançado ou conversa encerrada + cliente voltou a falar = atendimento novo.
  const status = str(conversa["status"]);
  const novoAtendimento = status === "pedido" || status === "finalizado";
  const statusAtual = novoAtendimento ? "bot" : status;
  await atualizarConversa(admin, conversa["id"], {
    ultima_mensagem: texto.slice(0, 160),
    ultima_em: new Date().toISOString(),
    nao_lidas: Number(conversa["nao_lidas"] ?? 0) + 1,
    ...(params.nome && !conversa["cliente_nome"] ? { cliente_nome: params.nome } : {}),
    ...(novoAtendimento ? { status: "bot", etapa: "coletando", rascunho: {} } : {}),
  });

  // Dono assumiu a conversa: o robô fica quieto.
  if (statusAtual === "humano") return { conversaId: conversa["id"], robo: false };

  const ctx = await carregarContexto(admin, params.restauranteId);
  if (!ctx.roboAtivo) {
    await atualizarConversa(admin, conversa["id"], { status: "humano" });
    return { conversaId: conversa["id"], robo: false };
  }

  const etapa: Etapa =
    !novoAtendimento && conversa["etapa"] === "confirmando" ? "confirmando" : "coletando";
  const anterior: Rascunho = novoAtendimento
    ? rascunhoVazio()
    : normalizarRascunho(conversa["rascunho"], ctx.cardapio).rascunho;

  let ia: Linha;
  try {
    ia = await perguntarIA(
      instrucoesDoRobo({
        restaurante: ctx.restaurante,
        cardapio: ctx.cardapio,
        taxaEntrega: ctx.taxaEntrega,
        instrucoesDono: ctx.instrucoes,
        rascunho: anterior,
        etapa,
      }),
      await historico(admin, str(conversa["id"])),
    );
  } catch (erro) {
    // Sem IA o cliente não fica sem resposta: passa para o dono e avisa no painel.
    const motivo = erro instanceof Error ? erro.message : String(erro);
    await registrar(
      admin,
      conversa,
      "sistema",
      `Robô não respondeu (${motivo}). Responda manualmente.`,
    );
    await atualizarConversa(admin, conversa["id"], { status: "humano" });
    return { conversaId: conversa["id"], robo: false, erro: motivo };
  }

  const { rascunho: atual } = normalizarRascunho(ia["pedido"], ctx.cardapio);
  const decisao = decidir({
    acao: ia["acao"],
    respostaIA: ia["resposta"],
    etapaAnterior: etapa,
    anterior,
    atual,
    mensagemCliente: texto,
    cardapio: ctx.cardapio,
    taxaEntrega: ctx.taxaEntrega,
  });

  if (decisao.tipo === "humano") {
    await atualizarConversa(admin, conversa["id"], { status: "humano", rascunho: atual });
    await responder(admin, conversa, "bot", decisao.texto);
    return { conversaId: conversa["id"], robo: true, status: "humano" };
  }

  if (decisao.tipo === "responder") {
    await atualizarConversa(admin, conversa["id"], { rascunho: atual, etapa: decisao.etapa });
    await responder(admin, conversa, "bot", decisao.texto);
    return { conversaId: conversa["id"], robo: true, status: "bot" };
  }

  // Lançar: mesma função do Delivery, em nome do dono; imprime sozinho se a impressão estiver ligada.
  const { data: pedido, error } = await admin.rpc("whatsapp_lancar_pedido", {
    p_conversa_id: conversa["id"],
    p_dados: dadosDoPedido(anterior, params.telefone, ctx.cardapio, ctx.taxaEntrega),
  });
  if (error) {
    await registrar(admin, conversa, "sistema", `Pedido não foi lançado: ${error.message}`);
    await atualizarConversa(admin, conversa["id"], { status: "humano", rascunho: anterior });
    await responder(
      admin,
      conversa,
      "bot",
      "Recebi seu pedido! Alguém da equipe vai conferir e já te responde, tá?",
    );
    return { conversaId: conversa["id"], robo: true, status: "humano", erro: error.message };
  }
  const linha = (Array.isArray(pedido) ? pedido[0] : pedido) as Linha;
  const numero = Number(linha?.["numero_dia"] ?? 0);
  await responder(
    admin,
    conversa,
    "bot",
    `Pedido${numero ? ` #${numero}` : ""} confirmado! ✅ Já foi para a cozinha. Obrigado, ${anterior.cliente_nome ?? ""}!`.replace(
      ", !",
      "!",
    ),
  );
  return { conversaId: conversa["id"], robo: true, status: "pedido", pedidoNumero: numero };
}

/** Resposta digitada pelo dono no painel. */
export async function responderComoAtendente(
  admin: SupabaseClient,
  params: { restauranteId: number; conversaId: string; texto: string },
) {
  const texto = params.texto.trim().slice(0, 4000);
  if (!texto) throw new ErroAtendimento("Mensagem vazia.");
  const { data: conversa, error } = await admin
    .from("whatsapp_conversas")
    .select("*")
    .eq("id", params.conversaId)
    .eq("restaurante_id", params.restauranteId)
    .maybeSingle();
  if (error) throw error;
  if (!conversa) throw new ErroAtendimento("Conversa não encontrada.", 404);
  await responder(admin, conversa as Linha, "atendente", texto);
  // Quem responde manualmente assume a conversa (o robô para de responder nela).
  await atualizarConversa(admin, params.conversaId, {
    status: conversa["status"] === "pedido" ? "pedido" : "humano",
    ultima_mensagem: texto.slice(0, 160),
    ultima_em: new Date().toISOString(),
    nao_lidas: 0,
  });
  return { conversaId: params.conversaId };
}
