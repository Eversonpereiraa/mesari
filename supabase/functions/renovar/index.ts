// Mesari — renovação paga pelo app (Mercado Pago, Pix/boleto). Só o dono do restaurante.
//
// POST { confirmar }   (Authorization: Bearer <sessão do usuário>)
//   confirmar=false → prévia: plano, ciclo e valor da próxima renovação.
//   confirmar=true  → cria o link de pagamento (Pix, boleto ou cartão) e devolve { url }.
// A renovação usa a troca agendada (plano_proximo/ciclo_proximo), se houver.
// Quem assina no cartão (recorrente) não precisa: a cobrança é automática.
//
// Secrets: MP_ACCESS_TOKEN, MESARI_SITE_URL (opcional).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const DIA = 86_400_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "Método não permitido" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const site = Deno.env.get("MESARI_SITE_URL") ?? "https://mesari-site.vercel.app";

  try {
    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: auth } = await db.auth.getUser(jwt);
    if (!auth?.user) return json({ erro: "Faça login de novo para renovar." }, 401);

    const { data: perfil } = await db.from("profiles").select("restaurante_id, dono, ativo, nome").eq("id", auth.user.id).maybeSingle();
    if (!perfil?.ativo || !perfil.restaurante_id) return json({ erro: "Usuário sem restaurante." }, 403);
    if (!perfil.dono) return json({ erro: "Só o dono da conta pode pagar a renovação." }, 403);
    const rid: number = perfil.restaurante_id;
    const corpo = await req.json().catch(() => ({}));

    const { data: a } = await db.from("assinaturas").select("*").eq("restaurante_id", rid).maybeSingle();
    if (!a || a.gateway !== "mercadopago") {
      // Teste grátis, cortesia ou assinatura antiga: compra pelo checkout da landing.
      const { data: rest } = await db.from("restaurante").select("codigo").eq("id", rid).maybeSingle();
      const url = new URL(site + "/");
      if (a?.plano_id) url.searchParams.set("plano", a.plano_id);
      if (a?.ciclo) url.searchParams.set("ciclo", a.ciclo);
      if (rest?.codigo) url.searchParams.set("restaurante", rest.codigo);
      url.hash = "preco";
      return json({ acao: "checkout", url: url.toString() });
    }

    if (a.renovacao_automatica && a.mp_preapproval_id && a.status !== "expirada") {
      return json({ erro: "Sua assinatura renova sozinha no cartão. Não precisa pagar nada agora." }, 409);
    }
    const planoId: string = a.plano_proximo ?? a.plano_id;
    const ciclo: string = a.ciclo_proximo ?? a.ciclo ?? "mensal";
    const { data: plano } = await db.from("planos").select("*").eq("id", planoId).maybeSingle();
    if (!plano) return json({ erro: "Plano não encontrado." }, 400);
    const valorTeste = Number(Deno.env.get("MESARI_VALOR_TESTE") ?? "");
    const valor = valorTeste > 0 ? valorTeste
      : Number(ciclo === "anual" ? plano.preco_anual : ciclo === "trimestral" ? plano.preco_trimestral : plano.preco_mensal);

    const vence = a.periodo_fim ? new Date(new Date(a.periodo_fim).getTime() - 3 * DIA) : null;
    const resumo = `Renovação do ${plano.nome} ${ciclo}: ${reais(valor)}. ` +
      (vence && vence.getTime() > Date.now()
        ? `O novo período começa em ${vence.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}, sem perder nenhum dia.`
        : "O acesso é liberado assim que o pagamento for aprovado.");
    if (corpo.confirmar !== true) return json({ acao: "previa", plano: plano.id, ciclo, valor, resumo });

    // Link anterior em aberto: substitui.
    await db.from("renovacoes").update({ status: "cancelada", atualizado_em: new Date().toISOString() })
      .eq("restaurante_id", rid).eq("status", "aguardando");

    const { data: renov, error } = await db.from("renovacoes").insert({
      restaurante_id: rid, plano_id: plano.id, ciclo, valor, pedido_por: auth.user.id,
    }).select("id").single();
    if (error) throw error;

    const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("MP_ACCESS_TOKEN") ?? ""}`,
        "X-Idempotency-Key": renov.id,
      },
      body: JSON.stringify({
        items: [{ id: `mesari-${plano.id}-${ciclo}`, title: `Mesari ${plano.nome} (${ciclo}) - renovação`, quantity: 1, unit_price: valor, currency_id: "BRL" }],
        payer: { email: auth.user.email, name: perfil.nome ?? undefined },
        external_reference: `renov:${renov.id}`,
        notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mp-webhook`,
        back_urls: {
          success: `${site}/obrigado/?tipo=renovacao`,
          pending: `${site}/obrigado/?tipo=renovacao&status=pendente`,
          failure: `${site}/obrigado/?tipo=renovacao&status=falhou`,
        },
        auto_return: "approved",
        statement_descriptor: "MESARI",
        payment_methods: { installments: ciclo === "anual" ? 12 : 1 },
        expires: true,
        expiration_date_to: new Date(Date.now() + 5 * DIA).toISOString(),
      }),
    });
    const pref = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("Mercado Pago", res.status, JSON.stringify(pref));
      throw new Error("Não foi possível gerar o pagamento agora. Tente de novo em instantes.");
    }
    await db.from("renovacoes").update({ mp_preference_id: pref.id }).eq("id", renov.id);
    return json({ acao: "pagar", url: pref.init_point, valor });
  } catch (e) {
    console.error("renovar", e);
    return json({ erro: e instanceof Error ? e.message : "Não foi possível renovar agora." }, 400);
  }
});
