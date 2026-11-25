import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/store";

/** Coluna do quadro: robô atendendo, precisa do dono, pedido lançado, encerrada. */
export type ConversaStatus = "bot" | "humano" | "pedido" | "finalizado";
export type Autor = "cliente" | "bot" | "atendente" | "sistema";

export type ItemRascunho = { produtoId: string; quantidade: number; observacao: string };
export type Conversa = {
  id: string;
  canal: "simulador" | "whatsapp";
  telefone: string;
  nome: string;
  status: ConversaStatus;
  etapa: "coletando" | "confirmando";
  itens: ItemRascunho[];
  tipo: "entrega" | "retirada" | null;
  pedidoId: string | null;
  naoLidas: number;
  ultimaMensagem: string;
  ultimaEm: number;
};
export type Mensagem = {
  id: string;
  conversaId: string;
  autor: Autor;
  texto: string;
  erroEnvio: string;
  em: number;
};

export const MIGRATION_WHATSAPP = "202611250001_whatsapp_atendimento.sql";

export const statusInfo: Record<ConversaStatus, { label: string; curto: string }> = {
  bot: { label: "Robô atendendo", curto: "Robô" },
  humano: { label: "Precisa de você", curto: "Você" },
  pedido: { label: "Pedido lançado", curto: "Pedido" },
  finalizado: { label: "Finalizadas", curto: "Finalizada" },
};

const reg = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown) => (typeof v === "string" ? v : "");

export function mapConversa(value: unknown): Conversa {
  const row = reg(value);
  const rascunho = reg(row["rascunho"]);
  const status = row["status"];
  const tipo = rascunho["tipo"];
  return {
    id: str(row["id"]),
    canal: row["canal"] === "whatsapp" ? "whatsapp" : "simulador",
    telefone: str(row["telefone"]),
    nome: str(row["cliente_nome"]) || str(rascunho["cliente_nome"]),
    status: status === "humano" || status === "pedido" || status === "finalizado" ? status : "bot",
    etapa: row["etapa"] === "confirmando" ? "confirmando" : "coletando",
    itens: (Array.isArray(rascunho["itens"]) ? rascunho["itens"] : []).map((i) => {
      const item = reg(i);
      return {
        produtoId: str(item["produto_id"]),
        quantidade: Number(item["quantidade"] ?? 1),
        observacao: str(item["observacao"]),
      };
    }),
    tipo: tipo === "entrega" || tipo === "retirada" ? tipo : null,
    pedidoId: str(row["pedido_id"]) || null,
    naoLidas: Number(row["nao_lidas"] ?? 0),
    ultimaMensagem: str(row["ultima_mensagem"]),
    ultimaEm: new Date(str(row["ultima_em"])).getTime(),
  };
}

export function mapMensagem(value: unknown): Mensagem {
  const row = reg(value);
  const autor = row["autor"];
  return {
    id: str(row["id"]),
    conversaId: str(row["conversa_id"]),
    autor: autor === "cliente" || autor === "atendente" || autor === "sistema" ? autor : "bot",
    texto: str(row["texto"]),
    erroEnvio: str(row["erro_envio"]),
    em: new Date(str(row["criado_em"])).getTime(),
  };
}

/** Tabela ainda não criada no Supabase → mensagem dizendo qual migration aplicar. */
export function erroWhatsapp(error: unknown) {
  const msg = errorMessage(error);
  if (
    /whatsapp_(conversas|mensagens|config)/.test(msg) &&
    /(does not exist|schema cache|not find)/i.test(msg)
  ) {
    return `O banco ainda não tem as tabelas do WhatsApp. Aplique a migration ${MIGRATION_WHATSAPP} no Supabase e recarregue.`;
  }
  return msg;
}

export async function listarConversas() {
  const { data, error } = await supabase
    .from("whatsapp_conversas")
    .select("*")
    .order("ultima_em", { ascending: false })
    .limit(200);
  if (error) throw new Error(erroWhatsapp(error));
  return (data ?? []).map(mapConversa);
}

export async function listarMensagens(conversaId: string) {
  const { data, error } = await supabase
    .from("whatsapp_mensagens")
    .select("id,conversa_id,autor,texto,erro_envio,criado_em")
    .eq("conversa_id", conversaId)
    .order("criado_em", { ascending: true })
    .limit(300);
  if (error) throw new Error(erroWhatsapp(error));
  return (data ?? []).map(mapMensagem);
}

export async function mudarStatus(conversaId: string, status: ConversaStatus) {
  const { error } = await supabase
    .from("whatsapp_conversas")
    .update({ status })
    .eq("id", conversaId);
  if (error) throw new Error(erroWhatsapp(error));
}

export async function marcarLida(conversaId: string) {
  const { error } = await supabase
    .from("whatsapp_conversas")
    .update({ nao_lidas: 0 })
    .eq("id", conversaId);
  if (error) throw new Error(erroWhatsapp(error));
}

export type ConfigWhatsapp = { roboAtivo: boolean; instrucoes: string };

export async function lerConfig(): Promise<ConfigWhatsapp> {
  const { data, error } = await supabase
    .from("whatsapp_config")
    .select("robo_ativo,instrucoes")
    .maybeSingle();
  if (error) throw new Error(erroWhatsapp(error));
  const row = reg(data);
  return { roboAtivo: row["robo_ativo"] !== false, instrucoes: str(row["instrucoes"]) };
}

export async function salvarConfig(config: ConfigWhatsapp) {
  const campos = { robo_ativo: config.roboAtivo, instrucoes: config.instrucoes.slice(0, 2000) };
  const { data, error } = await supabase
    .from("whatsapp_config")
    .update({ ...campos, atualizado_em: new Date().toISOString() })
    .not("restaurante_id", "is", null)
    .select("restaurante_id");
  if (error) throw new Error(erroWhatsapp(error));
  if (data?.length) return;
  // Primeira vez: cria a linha (restaurante_id vem do usuário logado).
  const inserted = await supabase.from("whatsapp_config").insert(campos);
  if (inserted.error) throw new Error(erroWhatsapp(inserted.error));
}

/** Chama a Edge Function whatsapp-app e devolve a mensagem de erro dela, em português. */
async function chamar(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("whatsapp-app", { body });
  if (error) {
    const contexto = (error as { context?: unknown }).context;
    let mensagem = "";
    if (contexto instanceof Response) {
      mensagem = str(
        reg(
          await contexto
            .clone()
            .json()
            .catch(() => ({})),
        )["erro"],
      );
    }
    if (!mensagem && /Failed to send|not found|404/i.test(errorMessage(error))) {
      mensagem =
        "A função whatsapp-app ainda não foi publicada no Supabase (supabase functions deploy whatsapp-app).";
    }
    throw new Error(mensagem || errorMessage(error));
  }
  return reg(data);
}

export const simularCliente = (p: { telefone: string; nome: string; texto: string }) =>
  chamar({ acao: "simular", ...p });

export const responderCliente = (conversaId: string, texto: string) =>
  chamar({ acao: "responder", conversa_id: conversaId, texto });

/** Telefone legível: 5581999990000 → (81) 99999-0000 */
export function telefoneLegivel(telefone: string) {
  const d = telefone.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return telefone;
}
