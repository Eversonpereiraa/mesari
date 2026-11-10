// Mesari — troca de plano dentro do app (só o dono do restaurante).
//
// POST { plano, ciclo, confirmar }   (Authorization: Bearer <sessão do usuário>)
//   confirmar=false → só calcula e devolve a prévia (nada muda).
//   confirmar=true  → executa.
//
// Regras:
//   • Sem assinatura paga (teste grátis, cortesia, vencida) → devolve o link do checkout da landing.
//   • Subir de plano → libera na hora; cobra a diferença proporcional aos dias que faltam no período.
//     Diferença abaixo de R$ 5 → libera sem cobrar.
//   • Descer de plano ou trocar o ciclo → vale na próxima renovação.
//   • Cartão recorrente (Mercado Pago preapproval): o valor das próximas cobranças é atualizado;
//     trocar o ciclo (mensal/trimestral/anual) no cartão é feito pelo suporte.
//
// Secrets: MP_ACCESS_TOKEN | ASAAS_API_KEY, ASAAS_BASE_URL (opcional), MESARI_SITE_URL (opcional).
import { createClient } from "npm:@supabase/supabase-js@2";

type Ciclo = "mensal" | "trimestral" | "anual";
type Plano = {
  id: string;
  nome: string;
  preco_mensal: number | string;
  preco_anual: number | string;
  preco_trimestral: number | string;
  ordem: number;
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MINIMO_ASAAS = 5;
const GRACA_DIAS = 3; // o webhook soma 3 dias de folga ao fim do período
const DIA = 86_400_000;

const preco = (p: Plano, c: Ciclo) =>
  Number(c === "anual" ? p.preco_anual : c === "trimestral" ? p.preco_trimestral : p.preco_mensal);
const lerCiclo = (v: unknown): Ciclo => (v === "anual" ? "anual" : v === "trimestral" ? "trimestral" : "mensal");
const porPeriodo = (c: Ciclo) => (c === "anual" ? "ano" : c === "trimestral" ? "trimestre" : "mês");

/** Assinatura recorrente no cartão: muda o valor das próximas cobranças. */
async function valorDaAssinaturaMP(preapprovalId: string, valor: number) {
  const res = await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(preapprovalId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("MP_ACCESS_TOKEN") ?? ""}` },
    body: JSON.stringify({ auto_recurring: { transaction_amount: valor, currency_id: "BRL" } }),
  });
  if (!res.ok) {
    console.error("Não atualizou a assinatura no MP", res.status, await res.text().catch(() => ""));
    throw new Error("Não foi possível atualizar a cobrança no cartão agora. Tente de novo em instantes.");
  }
}
const cicloAsaas = (c: Ciclo) => (c === "anual" ? "YEARLY" : "MONTHLY");
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const hojeSP = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

async function asaas(path: string, init: RequestInit = {}) {
  const base = Deno.env.get("ASAAS_BASE_URL") ?? "https://api-sandbox.asaas.com/v3";
  const res = await fetch(base + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mesari",
      access_token: Deno.env.get("ASAAS_API_KEY") ?? "",
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.errors?.[0]?.description ?? `Asaas respondeu ${res.status}`);
  return body;
}

async function preferenciaMP(body: unknown) {
  const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("MP_ACCESS_TOKEN") ?? ""}`,
      "X-Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("Mercado Pago", res.status, JSON.stringify(data));
    throw new Error(data?.message ? `Mercado Pago: ${data.message}` : `Mercado Pago respondeu ${res.status}`);
  }
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "Método não permitido" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  try {
    // ---------- quem está pedindo ----------
    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: auth } = await db.auth.getUser(jwt);
    if (!auth?.user) return json({ erro: "Faça login de novo para trocar de plano." }, 401);

    const { data: perfil } = await db
      .from("profiles")
      .select("restaurante_id, dono, ativo")
      .eq("id", auth.user.id)
      .maybeSingle();
    if (!perfil?.ativo || !perfil.restaurante_id) return json({ erro: "Usuário sem restaurante." }, 403);
    if (!perfil.dono) return json({ erro: "Só o dono da conta pode trocar de plano." }, 403);
    const rid: number = perfil.restaurante_id;

    const corpo = await req.json().catch(() => ({}));
    const cicloPedido: Ciclo = lerCiclo(corpo.ciclo);
    const confirmar = corpo.confirmar === true;

    const { data: planos } = await db.from("planos").select("*");
    const porId = new Map((planos ?? []).map((p: Plano) => [p.id, p]));
    const novo = porId.get(String(corpo.plano ?? ""));
    if (!novo) return json({ erro: "Plano inválido." }, 400);

    const { data: a } = await db.from("assinaturas").select("*").eq("restaurante_id", rid).maybeSingle();
    const { data: rest } = await db.from("restaurante").select("codigo").eq("id", rid).maybeSingle();

    // ---------- sem assinatura paga: vai para o checkout da landing ----------
    const ehMP = a?.gateway === "mercadopago";
    const ehAsaas = a?.gateway === "asaas" && Boolean(a?.gateway_assinatura_id);
    const pagaOnline = (ehMP || ehAsaas) && ["ativa", "atrasada"].includes(a?.status);
    if (!pagaOnline) {
      const site = Deno.env.get("MESARI_SITE_URL") ?? "https://mesari-site.vercel.app";
      const url = new URL(site + "/");
      url.searchParams.set("plano", novo.id);
      url.searchParams.set("ciclo", cicloPedido);
      if (rest?.codigo) url.searchParams.set("restaurante", rest.codigo);
      return json({ acao: "checkout", url: url.toString() });
    }
    if (a.status === "atrasada") {
      return json({ erro: "Há uma mensalidade em aberto. Pague a renovação pendente antes de trocar de plano." }, 409);
    }

    const atual = porId.get(a.plano_id)!;
    const cicloAtual: Ciclo = lerCiclo(a.ciclo);
    const recorrenteMP: string | null = ehMP && a.renovacao_automatica && a.mp_preapproval_id ? a.mp_preapproval_id : null;
    if (recorrenteMP && cicloPedido !== cicloAtual) {
      return json({
        erro: `Sua assinatura é cobrada no cartão a cada ${porPeriodo(cicloAtual)}. Para mudar para ${cicloPedido}, fale com a gente no WhatsApp que fazemos a troca sem perder nenhum dia.`,
      }, 409);
    }
    const fimPeriodo = new Date(a.periodo_fim).getTime() - GRACA_DIAS * DIA;
    const renovaEm = new Date(fimPeriodo).toISOString();

    // ---------- mesmo plano e mesmo ciclo: desfaz troca agendada, se houver ----------
    if (novo.id === atual.id && cicloPedido === cicloAtual) {
      if (!a.plano_proximo && !a.ciclo_proximo) return json({ erro: "Este já é o seu plano atual." }, 400);
      if (!confirmar) {
        return json({ acao: "manter", resumo: `Cancelar a troca agendada e continuar no ${atual.nome} ${cicloAtual}.` });
      }
      if (ehAsaas) await asaas(`/subscriptions/${a.gateway_assinatura_id}`, {
        method: "PUT",
        body: JSON.stringify({
          value: preco(atual, cicloAtual),
          cycle: cicloAsaas(cicloAtual),
          description: `Mesari ${atual.nome} (${cicloAtual})`,
          updatePendingPayments: true,
        }),
      });
      if (recorrenteMP) await valorDaAssinaturaMP(recorrenteMP, preco(atual, cicloAtual));
      await db.from("assinaturas").update({ plano_proximo: null, ciclo_proximo: null, atualizado_em: new Date().toISOString() }).eq("restaurante_id", rid);
      await db.from("plano_trocas").update({ status: "cancelada", atualizado_em: new Date().toISOString() }).eq("restaurante_id", rid).eq("status", "agendada");
      return json({ acao: "mantido" });
    }

    const sobe = novo.ordem > atual.ordem;

    // ---------- SUBIR DE PLANO: na hora, cobrando a diferença proporcional ----------
    if (sobe) {
      const total = cicloAtual === "anual" ? 365 : cicloAtual === "trimestral" ? 91 : 30;
      const restantes = Math.max(0, Math.min(total, Math.ceil((fimPeriodo - Date.now()) / DIA)));
      const diferenca = Math.round((preco(novo, cicloAtual) - preco(atual, cicloAtual)) * (restantes / total) * 100) / 100;
      const cicloFinal = cicloPedido;
      const recorrente = preco(novo, cicloFinal);
      const resumo =
        diferenca >= MINIMO_ASAAS
          ? `Você paga agora ${reais(diferenca)}, referente aos ${restantes} dias que faltam neste período, e o ${novo.nome} é liberado assim que o pagamento cair. Depois, a mensalidade passa para ${reais(recorrente)} por ${porPeriodo(cicloFinal)}.`
          : `O ${novo.nome} é liberado agora, sem cobrança extra neste período. A partir da próxima renovação você paga ${reais(recorrente)} por ${porPeriodo(cicloFinal)}.`;

      if (!confirmar) {
        return json({ acao: "upgrade", valor: diferenca >= MINIMO_ASAAS ? diferenca : 0, dias: restantes, recorrente, resumo });
      }

      // Cancela cobrança de troca anterior que ficou em aberto (o cliente desistiu e pediu outra).
      const { data: abertas } = await db.from("plano_trocas").select("id, asaas_cobranca_id").eq("restaurante_id", rid).eq("status", "aguardando");
      for (const t of abertas ?? []) {
        if (ehAsaas && t.asaas_cobranca_id) await asaas(`/payments/${t.asaas_cobranca_id}`, { method: "DELETE" }).catch(() => null);
        await db.from("plano_trocas").update({ status: "cancelada", atualizado_em: new Date().toISOString() }).eq("id", t.id);
      }

      const { data: troca, error: erroTroca } = await db
        .from("plano_trocas")
        .insert({
          restaurante_id: rid, de_plano: atual.id, para_plano: novo.id, ciclo: cicloFinal,
          tipo: "upgrade", valor: diferenca >= MINIMO_ASAAS ? diferenca : 0, pedido_por: auth.user.id,
        })
        .select("id")
        .single();
      if (erroTroca) throw erroTroca;

      if (diferenca < MINIMO_ASAAS) {
        // Diferença pequena: libera direto.
        if (ehAsaas) await asaas(`/subscriptions/${a.gateway_assinatura_id}`, {
          method: "PUT",
          body: JSON.stringify({ value: recorrente, cycle: cicloAsaas(cicloFinal), description: `Mesari ${novo.nome} (${cicloFinal})`, updatePendingPayments: true }),
        });
        if (recorrenteMP) await valorDaAssinaturaMP(recorrenteMP, recorrente);
        await db.from("assinaturas").update({
          plano_id: novo.id, plano_proximo: null,
          ciclo_proximo: cicloFinal !== cicloAtual ? cicloFinal : null,
          atualizado_em: new Date().toISOString(),
        }).eq("restaurante_id", rid);
        await db.from("plano_trocas").update({ status: "aplicada", atualizado_em: new Date().toISOString() }).eq("id", troca.id);
        return json({ acao: "liberado" });
      }

      if (ehMP) {
        const site = Deno.env.get("MESARI_SITE_URL") ?? "https://mesari-site.vercel.app";
        const { data: dono } = await db.from("profiles").select("nome").eq("id", auth.user.id).maybeSingle();
        const pref = await preferenciaMP({
          items: [{
            id: `mesari-troca-${novo.id}`,
            title: `Mesari: troca do ${atual.nome} para o ${novo.nome} (${restantes} dias restantes)`,
            quantity: 1, unit_price: diferenca, currency_id: "BRL",
          }],
          payer: { email: auth.user.email, name: dono?.nome ?? undefined },
          external_reference: `troca:${troca.id}`,
          notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mp-webhook`,
          back_urls: { success: `${site}/obrigado/?tipo=troca`, pending: `${site}/obrigado/?tipo=troca&status=pendente`, failure: `${site}/obrigado/?tipo=troca&status=falhou` },
          auto_return: "approved",
          statement_descriptor: "MESARI",
          expires: true,
          expiration_date_to: new Date(Date.now() + 3 * DIA).toISOString(),
        });
        return json({ acao: "pagar", url: pref.init_point, valor: diferenca });
      }

      const cobranca = await asaas("/payments", {
        method: "POST",
        body: JSON.stringify({
          customer: a.gateway_cliente_id,
          billingType: "UNDEFINED",
          value: diferenca,
          dueDate: hojeSP(),
          description: `Mesari: troca do ${atual.nome} para o ${novo.nome} (${restantes} dias restantes)`,
          externalReference: `troca:${troca.id}`,
        }),
      });
      await db.from("plano_trocas").update({ asaas_cobranca_id: cobranca.id }).eq("id", troca.id);
      return json({ acao: "pagar", url: cobranca.invoiceUrl, valor: diferenca });
    }

    // ---------- DESCER DE PLANO ou só trocar o ciclo: vale na renovação ----------
    if (novo.id !== atual.id) {
      const { data: excedentes } = await db.rpc("limites_excedidos", { p_restaurante: rid, p_plano: novo.id });
      if (excedentes?.length) {
        return json({ erro: `Para mudar para o ${novo.nome}, ajuste antes:`, excedentes }, 409);
      }
    }
    const recorrente = preco(novo, cicloPedido);
    const resumo = `Você continua no ${atual.nome} até ${new Date(fimPeriodo).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}. A partir daí passa para o ${novo.nome} ${cicloPedido}, por ${reais(recorrente)} por ${porPeriodo(cicloPedido)}. Nada é cobrado agora.`;
    if (!confirmar) return json({ acao: "agendar", renovaEm, recorrente, resumo });

    if (ehAsaas) await asaas(`/subscriptions/${a.gateway_assinatura_id}`, {
      method: "PUT",
      body: JSON.stringify({
        value: recorrente,
        cycle: cicloAsaas(cicloPedido),
        description: `Mesari ${novo.nome} (${cicloPedido})`,
        updatePendingPayments: true,
      }),
    });
    if (recorrenteMP) await valorDaAssinaturaMP(recorrenteMP, recorrente);
    await db.from("assinaturas").update({
      plano_proximo: novo.id !== atual.id ? novo.id : null,
      ciclo_proximo: cicloPedido !== cicloAtual ? cicloPedido : null,
      atualizado_em: new Date().toISOString(),
    }).eq("restaurante_id", rid);
    await db.from("plano_trocas").update({ status: "cancelada", atualizado_em: new Date().toISOString() }).eq("restaurante_id", rid).eq("status", "agendada");
    await db.from("plano_trocas").insert({
      restaurante_id: rid, de_plano: atual.id, para_plano: novo.id, ciclo: cicloPedido,
      tipo: "agendada", status: "agendada", pedido_por: auth.user.id,
    });
    return json({ acao: "agendado", renovaEm });
  } catch (e) {
    console.error("trocar-plano", e);
    return json({ erro: e instanceof Error ? e.message : "Não foi possível trocar de plano agora." }, 400);
  }
});
