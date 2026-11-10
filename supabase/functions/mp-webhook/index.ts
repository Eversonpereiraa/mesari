// Mesari — webhook do Mercado Pago (Checkout Pro).
// O corpo do aviso não é usado como verdade: o pagamento é buscado de novo na API do Mercado Pago.
// external_reference decide o que fazer:
//   pedido:<uuid>  compra pela landing → cria a conta do dono e ativa o plano
//   renov:<uuid>   renovação paga pelo app → estende a validade (aplica troca agendada)
//   troca:<uuid>   diferença de upgrade paga pelo app → libera o plano novo
// Estorno/contestação → assinatura expirada.
//
// Secrets:
//   MP_ACCESS_TOKEN    obrigatório
//   MP_WEBHOOK_SECRET  opcional: "assinatura secreta" do webhook (confere o x-signature)
//   MESARI_SITE_URL    opcional (padrão: https://mesari-site.vercel.app)
import { createClient } from "npm:@supabase/supabase-js@2";

const ok = () => new Response("ok", { status: 200 });
const DIA = 86_400_000;
const FOLGA = 3 * DIA; // dias de folga após o vencimento para pagar a renovação

function somarCiclo(base: Date, ciclo: string) {
  const d = new Date(base);
  if (ciclo === "anual") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

/** Nova validade: a partir do fim do período atual (se ainda vale) ou de agora, + ciclo + folga. */
function novaValidade(atual: Record<string, any> | null, ciclo: string, aprovadoEm: string) {
  const agora = new Date(aprovadoEm || Date.now());
  let base = agora;
  if (atual?.periodo_fim && ["ativa", "atrasada"].includes(atual.status) && atual.gateway === "mercadopago") {
    const fimSemFolga = new Date(new Date(atual.periodo_fim).getTime() - FOLGA);
    if (fimSemFolga > agora) base = fimSemFolga;
  }
  return new Date(somarCiclo(base, ciclo).getTime() + FOLGA).toISOString();
}

function iguais(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function assinaturaValida(req: Request, dataId: string) {
  const segredo = Deno.env.get("MP_WEBHOOK_SECRET") ?? "";
  if (!segredo) return true;
  const partes = Object.fromEntries(
    (req.headers.get("x-signature") ?? "").split(",").map((p) => p.trim().split("=") as [string, string]),
  );
  if (!partes.ts || !partes.v1) return false;
  const manifesto = `id:${dataId.toLowerCase()};request-id:${req.headers.get("x-request-id") ?? ""};ts:${partes.ts};`;
  const chave = await crypto.subtle.importKey("raw", new TextEncoder().encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(manifesto)));
  const hex = Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
  return iguais(hex, partes.v1);
}

async function buscarPagamento(id: string) {
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${Deno.env.get("MP_ACCESS_TOKEN") ?? ""}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Mercado Pago respondeu ${res.status} ao buscar o pagamento ${id}`);
  return await res.json();
}

const valorConfere = (pago: number, esperado: number) => Number(pago) + 0.01 >= Number(esperado);
const agoraISO = () => new Date().toISOString();

async function ativarPedido(db: any, pedidoId: string, p: Record<string, any>) {
  const { data: pedido } = await db.from("checkout_pedidos").select("*").eq("id", pedidoId).maybeSingle();
  if (!pedido) return console.warn("Pagamento sem pedido no Mesari", pedidoId);
  if (pedido.status === "pago") return;
  if (!valorConfere(p.transaction_amount, pedido.valor)) {
    return console.error("Valor pago menor que o do pedido", pedidoId, p.transaction_amount, pedido.valor);
  }

  let restauranteId: number | null = pedido.restaurante_id;
  if (!restauranteId) {
    const { data } = await db.rpc("restaurante_por_email", { p_email: pedido.email });
    restauranteId = data ?? null;
  }

  if (!restauranteId) {
    const site = Deno.env.get("MESARI_SITE_URL") ?? "https://mesari-site.vercel.app";
    const { error } = await db.auth.admin.inviteUserByEmail(pedido.email, {
      data: { nome: pedido.nome, restaurante: pedido.restaurante_nome ?? "Meu restaurante" },
      redirectTo: `${site}/senha/`,
    });
    if (error && !/already|registered|exists/i.test(error.message)) throw error;
    if (error) {
      const { data: rid, error: erroProv } = await db.rpc("provisionar_dono", {
        p_email: pedido.email,
        p_nome: pedido.nome,
        p_restaurante: pedido.restaurante_nome ?? "Meu restaurante",
      });
      if (erroProv) throw erroProv;
      restauranteId = rid ?? null;
      const { error: erroEmail } = await db.auth.resetPasswordForEmail(pedido.email, { redirectTo: `${site}/senha/` });
      if (erroEmail) console.warn("Não enviou o e-mail de senha", erroEmail.message);
    } else {
      const { data } = await db.rpc("restaurante_por_email", { p_email: pedido.email });
      restauranteId = data ?? null;
    }
    if (!restauranteId) throw new Error("Conta criada, mas o restaurante não foi encontrado.");
  }

  const { data: atual } = await db.from("assinaturas").select("*").eq("restaurante_id", restauranteId).maybeSingle();
  const { error: erroAssinatura } = await db.from("assinaturas").upsert({
    restaurante_id: restauranteId,
    plano_id: pedido.plano_id,
    plano_proximo: null,
    ciclo_proximo: null,
    status: "ativa",
    ciclo: pedido.ciclo,
    periodo_fim: novaValidade(atual, pedido.ciclo, p.date_approved),
    renovacao_automatica: false,
    gateway: "mercadopago",
    gateway_cliente_id: p.payer?.id ? String(p.payer.id) : null,
    gateway_assinatura_id: null,
    atualizado_em: agoraISO(),
  });
  if (erroAssinatura) throw erroAssinatura;

  await db.from("checkout_pedidos").update({
    status: "pago", restaurante_id: restauranteId, mp_payment_id: String(p.id), atualizado_em: agoraISO(),
  }).eq("id", pedido.id);
  await db.from("plano_trocas").update({ status: "cancelada", atualizado_em: agoraISO() })
    .eq("restaurante_id", restauranteId).in("status", ["agendada", "aguardando"]);
}

async function aplicarRenovacao(db: any, renovId: string, p: Record<string, any>) {
  const { data: r } = await db.from("renovacoes").select("*").eq("id", renovId).maybeSingle();
  if (!r || r.status === "pago") return;
  if (!valorConfere(p.transaction_amount, r.valor)) {
    return console.error("Valor pago menor que o da renovação", renovId, p.transaction_amount, r.valor);
  }
  const { data: atual } = await db.from("assinaturas").select("*").eq("restaurante_id", r.restaurante_id).maybeSingle();
  const { error } = await db.from("assinaturas").update({
    plano_id: r.plano_id,
    ciclo: r.ciclo,
    plano_proximo: null,
    ciclo_proximo: null,
    status: "ativa",
    gateway: "mercadopago",
    periodo_fim: novaValidade(atual, r.ciclo, p.date_approved),
    atualizado_em: agoraISO(),
  }).eq("restaurante_id", r.restaurante_id);
  if (error) throw error;
  await db.from("renovacoes").update({ status: "pago", mp_payment_id: String(p.id), atualizado_em: agoraISO() }).eq("id", r.id);
  await db.from("plano_trocas").update({ status: "aplicada", atualizado_em: agoraISO() })
    .eq("restaurante_id", r.restaurante_id).eq("status", "agendada");
}

async function aplicarTroca(db: any, trocaId: string, p: Record<string, any>) {
  const { data: troca } = await db.from("plano_trocas").select("*").eq("id", trocaId).maybeSingle();
  if (!troca || troca.status !== "aguardando") return;
  if (!valorConfere(p.transaction_amount, troca.valor)) {
    return console.error("Valor pago menor que o da troca", trocaId, p.transaction_amount, troca.valor);
  }
  const { data: a } = await db.from("assinaturas").select("*").eq("restaurante_id", troca.restaurante_id).maybeSingle();
  if (!a) return;
  await db.from("assinaturas").update({
    plano_id: troca.para_plano,
    plano_proximo: null,
    ciclo_proximo: troca.ciclo !== a.ciclo ? troca.ciclo : null,
    atualizado_em: agoraISO(),
  }).eq("restaurante_id", troca.restaurante_id);
  await db.from("plano_trocas").update({ status: "pago", mp_payment_id: String(p.id), atualizado_em: agoraISO() }).eq("id", troca.id);
}

/** Estorno ou contestação: encerra o acesso que aquele pagamento liberou. */
async function estornar(db: any, ref: string, p: Record<string, any>) {
  let restauranteId: number | null = null;
  if (ref.startsWith("pedido:")) {
    const { data } = await db.from("checkout_pedidos").select("restaurante_id").eq("id", ref.slice(7)).maybeSingle();
    restauranteId = data?.restaurante_id ?? null;
    await db.from("checkout_pedidos").update({ status: "cancelado", atualizado_em: agoraISO() }).eq("id", ref.slice(7));
  } else if (ref.startsWith("renov:")) {
    const { data } = await db.from("renovacoes").select("restaurante_id").eq("id", ref.slice(6)).maybeSingle();
    restauranteId = data?.restaurante_id ?? null;
    await db.from("renovacoes").update({ status: "cancelada", atualizado_em: agoraISO() }).eq("id", ref.slice(6));
  } else if (ref.startsWith("troca:")) {
    // Diferença de upgrade devolvida: só registra; o plano volta na próxima renovação manualmente.
    console.warn("Troca de plano estornada", ref, p.id);
    return;
  }
  if (!restauranteId) return;
  await db.from("assinaturas").update({ status: "expirada", periodo_fim: agoraISO(), atualizado_em: agoraISO() })
    .eq("restaurante_id", restauranteId).eq("gateway", "mercadopago");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Método não permitido", { status: 405 });

  const url = new URL(req.url);
  const bruto = await req.json().catch(() => ({}));
  const tipo = String(bruto?.type ?? bruto?.topic ?? url.searchParams.get("type") ?? url.searchParams.get("topic") ?? "");
  const dataId = String(bruto?.data?.id ?? url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? "");
  if (tipo !== "payment" || !dataId || !/^\d+$/.test(dataId)) return ok(); // merchant_order etc.: ignorado

  if (!(await assinaturaValida(req, url.searchParams.get("data.id") ?? dataId))) {
    return new Response("Assinatura inválida", { status: 401 });
  }

  let p: Record<string, any> | null;
  try {
    p = await buscarPagamento(dataId);
  } catch (e) {
    console.error("Não foi possível conferir o pagamento no Mercado Pago", e);
    return new Response("Tente de novo", { status: 503 });
  }
  if (!p) return ok();

  const ref = String(p.external_reference ?? "");
  const relevante = ["approved", "refunded", "charged_back"].includes(p.status);
  if (!relevante || !/^(pedido|renov|troca):/.test(ref)) return ok();

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // Idempotência: o Mercado Pago reenvia o mesmo aviso várias vezes.
  const chave = `mp:${p.id}:${p.status}`;
  const { error: dup } = await db.from("webhook_eventos").insert({ id: chave, evento: `mp.payment.${p.status}` });
  if (dup?.code === "23505") return ok();

  try {
    if (p.status === "approved") {
      if (ref.startsWith("pedido:")) await ativarPedido(db, ref.slice(7), p);
      else if (ref.startsWith("renov:")) await aplicarRenovacao(db, ref.slice(6), p);
      else if (ref.startsWith("troca:")) await aplicarTroca(db, ref.slice(6), p);
    } else {
      await estornar(db, ref, p);
    }
    return ok();
  } catch (e) {
    console.error("mp-webhook", chave, e);
    await db.from("webhook_eventos").delete().eq("id", chave);
    return new Response("Erro ao processar", { status: 500 });
  }
});
