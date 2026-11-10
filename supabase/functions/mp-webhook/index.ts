// Mesari — webhook do Mercado Pago.
// O corpo do aviso não é usado como verdade: o recurso é buscado de novo na API do Mercado Pago.
//
// Pagamentos avulsos (Pix, boleto, Checkout Pro) — external_reference decide:
//   pedido:<uuid>  compra pela landing → cria a conta do dono e ativa o plano
//   renov:<uuid>   renovação paga pelo app → estende a validade (aplica troca agendada)
//   troca:<uuid>   diferença de upgrade paga pelo app → libera o plano novo
// Assinatura no cartão (preapproval) — tópicos subscription_authorized_payment / subscription_preapproval:
//   1ª cobrança aprovada → ativa o pedido; próximas → renovam sozinhas; recusa → avisa a página / atrasa.
// Estorno/contestação → assinatura expirada.
//
// No painel do Mercado Pago (Suas integrações → Mesari → Webhooks) ative os eventos
// "Pagamentos" e "Planos e assinaturas" com a URL desta função.
//
// Secrets: MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET (opcional), MESARI_SITE_URL (opcional)
import { createClient } from "npm:@supabase/supabase-js@2";

const ok = () => new Response("ok", { status: 200 });
const DIA = 86_400_000;
const FOLGA = 3 * DIA; // dias de folga após o vencimento para pagar a renovação
const MESES: Record<string, number> = { mensal: 1, trimestral: 3, anual: 12 };

const RECUSA: Record<string, string> = {
  cc_rejected_insufficient_amount: "O cartão não tem limite suficiente. Tente outro cartão ou pague com Pix.",
  cc_rejected_bad_filled_security_code: "O código de segurança (CVV) está errado. Confira e tente de novo.",
  cc_rejected_bad_filled_date: "A validade do cartão está errada. Confira e tente de novo.",
  cc_rejected_bad_filled_card_number: "O número do cartão está errado. Confira e tente de novo.",
  cc_rejected_bad_filled_other: "Algum dado do cartão está errado. Confira e tente de novo.",
  cc_rejected_call_for_authorize: "O banco pediu autorização. Libere a compra no app do seu banco e tente de novo.",
  cc_rejected_card_disabled: "O cartão está bloqueado ou inativo. Ative no app do banco ou use outro cartão.",
  cc_rejected_duplicated_payment: "Já existe um pagamento igual a este. Aguarde alguns minutos antes de tentar de novo.",
  cc_rejected_high_risk: "O pagamento foi recusado pela análise de segurança. Tente outro cartão ou pague com Pix.",
  cc_rejected_max_attempts: "Muitas tentativas com este cartão. Use outro cartão ou pague com Pix.",
};
const motivoRecusa = (detalhe?: string) =>
  RECUSA[detalhe ?? ""] ?? "O banco recusou o pagamento. Tente outro cartão ou pague com Pix.";

function somarCiclo(base: Date, ciclo: string) {
  const d = new Date(base);
  d.setMonth(d.getMonth() + (MESES[ciclo] ?? 1));
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

async function buscar(path: string) {
  const res = await fetch("https://api.mercadopago.com" + path, {
    headers: { Authorization: `Bearer ${Deno.env.get("MP_ACCESS_TOKEN") ?? ""}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Mercado Pago respondeu ${res.status} em ${path}`);
  return await res.json();
}

async function cancelarPreapproval(id: string) {
  await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("MP_ACCESS_TOKEN") ?? ""}` },
    body: JSON.stringify({ status: "cancelled" }),
  }).catch((e) => console.warn("Não cancelou a assinatura no MP", id, e));
}

const valorConfere = (pago: number, esperado: number) => Number(pago) + 0.01 >= Number(esperado);
const agoraISO = () => new Date().toISOString();

async function ativarPedido(db: any, pedidoId: string, p: Record<string, any>, preapprovalId: string | null = null) {
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
  // Já tinha assinatura recorrente em outro cartão: cancela a antiga para não cobrar duas vezes.
  if (atual?.mp_preapproval_id && atual.mp_preapproval_id !== preapprovalId) await cancelarPreapproval(atual.mp_preapproval_id);

  const { error: erroAssinatura } = await db.from("assinaturas").upsert({
    restaurante_id: restauranteId,
    plano_id: pedido.plano_id,
    plano_proximo: null,
    ciclo_proximo: null,
    status: "ativa",
    ciclo: pedido.ciclo,
    periodo_fim: novaValidade(atual, pedido.ciclo, p.date_approved),
    renovacao_automatica: Boolean(preapprovalId),
    gateway: "mercadopago",
    gateway_cliente_id: p.payer?.id ? String(p.payer.id) : null,
    gateway_assinatura_id: null,
    mp_preapproval_id: preapprovalId,
    atualizado_em: agoraISO(),
  });
  if (erroAssinatura) throw erroAssinatura;

  await db.from("checkout_pedidos").update({
    status: "pago", restaurante_id: restauranteId, mp_payment_id: String(p.id), motivo_recusa: null, atualizado_em: agoraISO(),
  }).eq("id", pedido.id);
  await db.from("plano_trocas").update({ status: "cancelada", atualizado_em: agoraISO() })
    .eq("restaurante_id", restauranteId).in("status", ["agendada", "aguardando"]);
}

/** Cobrança da assinatura no cartão (1ª ou renovação). */
async function pagamentoDeAssinatura(db: any, preapprovalId: string, p: Record<string, any>) {
  const { data: pedido } = await db.from("checkout_pedidos").select("*").eq("mp_preapproval_id", preapprovalId).maybeSingle();

  if (p.status === "approved") {
    if (pedido && pedido.status !== "pago") return await ativarPedido(db, pedido.id, p, preapprovalId);
    const { data: a } = await db.from("assinaturas").select("*").eq("mp_preapproval_id", preapprovalId).maybeSingle();
    if (!a) return console.warn("Cobrança de assinatura sem restaurante", preapprovalId);
    const { error } = await db.from("assinaturas").update({
      plano_id: a.plano_proximo ?? a.plano_id,
      plano_proximo: null,
      status: "ativa",
      renovacao_automatica: true,
      periodo_fim: novaValidade(a, a.ciclo, p.date_approved),
      atualizado_em: agoraISO(),
    }).eq("restaurante_id", a.restaurante_id);
    if (error) throw error;
    await db.from("plano_trocas").update({ status: "aplicada", atualizado_em: agoraISO() })
      .eq("restaurante_id", a.restaurante_id).eq("status", "agendada");
    return;
  }

  if (p.status === "rejected") {
    if (pedido && pedido.status === "aguardando") {
      // Primeira cobrança recusada: a página mostra o motivo e a assinatura é cancelada (não fica tentando).
      await db.from("checkout_pedidos").update({
        status: "recusado", motivo_recusa: motivoRecusa(p.status_detail), atualizado_em: agoraISO(),
      }).eq("id", pedido.id);
      await cancelarPreapproval(preapprovalId);
      return;
    }
    // Renovação recusada: o Mercado Pago tenta de novo nos próximos dias; marcamos como atrasada.
    await db.from("assinaturas").update({ status: "atrasada", atualizado_em: agoraISO() })
      .eq("mp_preapproval_id", preapprovalId).eq("status", "ativa");
  }
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
  // Cartão recorrente: as próximas cobranças passam a ser do plano novo.
  if (a.mp_preapproval_id && a.renovacao_automatica) {
    const { data: novo } = await db.from("planos").select("*").eq("id", troca.para_plano).maybeSingle();
    const ciclo = a.ciclo ?? "mensal";
    const valor = Number(ciclo === "anual" ? novo?.preco_anual : ciclo === "trimestral" ? novo?.preco_trimestral : novo?.preco_mensal);
    if (valor > 0) {
      await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(a.mp_preapproval_id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("MP_ACCESS_TOKEN") ?? ""}` },
        body: JSON.stringify({ auto_recurring: { transaction_amount: valor, currency_id: "BRL" } }),
      }).catch((e) => console.warn("Não atualizou o valor da assinatura", e));
    }
  }
}

/** Estorno ou contestação: encerra o acesso que aquele pagamento liberou. */
async function estornar(db: any, ref: string, p: Record<string, any>, preapprovalId: string | null) {
  let restauranteId: number | null = null;
  if (preapprovalId) {
    const { data } = await db.from("assinaturas").select("restaurante_id").eq("mp_preapproval_id", preapprovalId).maybeSingle();
    restauranteId = data?.restaurante_id ?? null;
    await cancelarPreapproval(preapprovalId);
  } else if (ref.startsWith("pedido:")) {
    const { data } = await db.from("checkout_pedidos").select("restaurante_id").eq("id", ref.slice(7)).maybeSingle();
    restauranteId = data?.restaurante_id ?? null;
    await db.from("checkout_pedidos").update({ status: "cancelado", atualizado_em: agoraISO() }).eq("id", ref.slice(7));
  } else if (ref.startsWith("renov:")) {
    const { data } = await db.from("renovacoes").select("restaurante_id").eq("id", ref.slice(6)).maybeSingle();
    restauranteId = data?.restaurante_id ?? null;
    await db.from("renovacoes").update({ status: "cancelada", atualizado_em: agoraISO() }).eq("id", ref.slice(6));
  } else if (ref.startsWith("troca:")) {
    console.warn("Troca de plano estornada", ref, p.id);
    return;
  }
  if (!restauranteId) return;
  await db.from("assinaturas").update({
    status: "expirada", periodo_fim: agoraISO(), renovacao_automatica: false, atualizado_em: agoraISO(),
  }).eq("restaurante_id", restauranteId).eq("gateway", "mercadopago");
}

async function processarPagamento(db: any, p: Record<string, any>, preapprovalDoAviso: string | null) {
  const ref = String(p.external_reference ?? "");
  const preapprovalId: string | null = preapprovalDoAviso ??
    (p.metadata?.preapproval_id ? String(p.metadata.preapproval_id) : null) ??
    (p.point_of_interaction?.transaction_data?.subscription_id ? String(p.point_of_interaction.transaction_data.subscription_id) : null);

  // Pagamento da assinatura no cartão: o external_reference pode vir copiado da preapproval ("pedido:...").
  let assinaturaId = preapprovalId;
  if (!assinaturaId && ref.startsWith("pedido:") && p.payment_type_id === "credit_card") {
    const { data } = await db.from("checkout_pedidos").select("mp_preapproval_id").eq("id", ref.slice(7)).maybeSingle();
    assinaturaId = data?.mp_preapproval_id ?? null;
  }

  if (!["approved", "rejected", "refunded", "charged_back"].includes(p.status)) return;
  const chave = `mp:${p.id}:${p.status}`;
  const { error: dup } = await db.from("webhook_eventos").insert({ id: chave, evento: `mp.payment.${p.status}` });
  if (dup?.code === "23505") return;

  try {
    if (p.status === "refunded" || p.status === "charged_back") return await estornar(db, ref, p, assinaturaId);
    if (assinaturaId) return await pagamentoDeAssinatura(db, assinaturaId, p);
    if (p.status !== "approved") return;
    if (ref.startsWith("pedido:")) await ativarPedido(db, ref.slice(7), p);
    else if (ref.startsWith("renov:")) await aplicarRenovacao(db, ref.slice(6), p);
    else if (ref.startsWith("troca:")) await aplicarTroca(db, ref.slice(6), p);
  } catch (e) {
    await db.from("webhook_eventos").delete().eq("id", chave);
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Método não permitido", { status: 405 });

  const url = new URL(req.url);
  const bruto = await req.json().catch(() => ({}));
  const tipo = String(bruto?.type ?? bruto?.topic ?? url.searchParams.get("type") ?? url.searchParams.get("topic") ?? "");
  const dataId = String(bruto?.data?.id ?? url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? "");
  if (!dataId || !/^[\w-]{1,64}$/.test(dataId)) return ok();
  if (!["payment", "subscription_authorized_payment", "authorized_payment", "subscription_preapproval", "preapproval"].includes(tipo)) return ok();

  if (!(await assinaturaValida(req, url.searchParams.get("data.id") ?? dataId))) {
    return new Response("Assinatura inválida", { status: 401 });
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  try {
    if (tipo === "payment") {
      const p = await buscar(`/v1/payments/${encodeURIComponent(dataId)}`);
      if (p) await processarPagamento(db, p, null);
      return ok();
    }

    if (tipo === "subscription_authorized_payment" || tipo === "authorized_payment") {
      const fatura = await buscar(`/authorized_payments/${encodeURIComponent(dataId)}`);
      const pagamentoId = fatura?.payment?.id;
      if (!fatura?.preapproval_id || !pagamentoId) return ok();
      const p = await buscar(`/v1/payments/${encodeURIComponent(String(pagamentoId))}`);
      if (p) await processarPagamento(db, p, String(fatura.preapproval_id));
      return ok();
    }

    // Mudança na assinatura (cancelada/pausada pelo cliente no Mercado Pago, por exemplo).
    const pre = await buscar(`/preapproval/${encodeURIComponent(dataId)}`);
    if (pre && ["cancelled", "paused"].includes(pre.status)) {
      await db.from("assinaturas").update({ renovacao_automatica: false, atualizado_em: agoraISO() })
        .eq("mp_preapproval_id", pre.id);
    }
    return ok();
  } catch (e) {
    console.error("mp-webhook", tipo, dataId, e);
    return new Response("Erro ao processar", { status: 500 });
  }
});
