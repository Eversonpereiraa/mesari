// Mesari — webhook do Asaas.
// Pagamento confirmado → cria a conta do dono (convite por e-mail para definir a senha),
// ativa o plano e estende a validade. Atraso, estorno e cancelamento atualizam a assinatura.
//
// Secrets:
//   ASAAS_API_KEY        obrigatório: confere cada aviso direto na API do Asaas
//   ASAAS_WEBHOOK_TOKEN  opcional: o "Token de autenticação" do webhook (camada extra)
//   ASAAS_BASE_URL       opcional (padrão: sandbox)
//   MESARI_SITE_URL      opcional (padrão: https://mesari-site.vercel.app)
import { createClient } from "npm:@supabase/supabase-js@2";

const ok = () => new Response("ok", { status: 200 });

function iguais(a: string, b: string) {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

function somarPeriodo(dataISO: string, ciclo: string) {
  const d = new Date(`${dataISO}T23:59:59-03:00`);
  if (ciclo === "anual") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  d.setDate(d.getDate() + 3); // 3 dias de folga para o próximo pagamento compensar
  return d.toISOString();
}

const baseAsaas = () => Deno.env.get("ASAAS_BASE_URL") ?? "https://api-sandbox.asaas.com/v3";

async function buscarAsaas(path: string) {
  const res = await fetch(baseAsaas() + path, {
    headers: { access_token: Deno.env.get("ASAAS_API_KEY") ?? "", "User-Agent": "Mesari" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Asaas respondeu ${res.status} em ${path}`);
  return await res.json();
}

const precoDo = (p: Record<string, any>, ciclo: string) => Number(ciclo === "anual" ? p.preco_anual : p.preco_mensal);

/** Diferença da troca de plano foi paga: libera o plano novo e ajusta a assinatura no Asaas. */
async function aplicarTroca(db: any, trocaId: string, pagamento: Record<string, any>) {
  const { data: troca } = await db.from("plano_trocas").select("*").eq("id", trocaId).maybeSingle();
  if (!troca || troca.status !== "aguardando") return;
  if (troca.asaas_cobranca_id && troca.asaas_cobranca_id !== pagamento.id) return;

  const { data: a } = await db.from("assinaturas").select("*").eq("restaurante_id", troca.restaurante_id).maybeSingle();
  const { data: novo } = await db.from("planos").select("*").eq("id", troca.para_plano).maybeSingle();
  if (!a || !novo) return;

  if (a.gateway_assinatura_id) {
    await fetch(`${baseAsaas()}/subscriptions/${a.gateway_assinatura_id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", access_token: Deno.env.get("ASAAS_API_KEY") ?? "", "User-Agent": "Mesari" },
      body: JSON.stringify({
        value: precoDo(novo, troca.ciclo),
        cycle: troca.ciclo === "anual" ? "YEARLY" : "MONTHLY",
        description: `Mesari ${novo.nome} (${troca.ciclo})`,
        updatePendingPayments: true,
      }),
    }).catch((e) => console.warn("Não atualizou o valor da assinatura", e));
  }

  await db.from("assinaturas").update({
    plano_id: troca.para_plano,
    plano_proximo: null,
    ciclo_proximo: troca.ciclo !== a.ciclo ? troca.ciclo : null,
    atualizado_em: new Date().toISOString(),
  }).eq("restaurante_id", troca.restaurante_id);
  await db.from("plano_trocas").update({ status: "pago", atualizado_em: new Date().toISOString() }).eq("id", troca.id);
}

/** Recarrega do Asaas o recurso citado no aviso, para não confiar no corpo recebido. */
async function confirmarNoAsaas(bruto: Record<string, any>) {
  const evento = String(bruto.event);
  if (bruto.payment?.id) {
    const payment = await buscarAsaas(`/payments/${encodeURIComponent(bruto.payment.id)}`);
    if (!payment) return null;
    const pago = ["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"].includes(payment.status);
    if ((evento === "PAYMENT_CONFIRMED" || evento === "PAYMENT_RECEIVED") && !pago) return null;
    if (evento === "PAYMENT_OVERDUE" && payment.status !== "OVERDUE") return null;
    if (evento === "PAYMENT_REFUNDED" && !String(payment.status).includes("REFUND")) return null;
    if (evento === "PAYMENT_CHARGEBACK_REQUESTED" && !String(payment.status).includes("CHARGEBACK")) return null;
    return { id: bruto.id, event: evento, payment };
  }
  if (bruto.subscription?.id) {
    const subscription = await buscarAsaas(`/subscriptions/${encodeURIComponent(bruto.subscription.id)}`);
    if (subscription && !subscription.deleted && subscription.status === "ACTIVE") return null;
    return { id: bruto.id, event: evento, subscription: { id: bruto.subscription.id } };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Método não permitido", { status: 405 });

  // Segurança: se houver token configurado, ele precisa bater. Sem token, o conteúdo do aviso
  // não é usado: a cobrança/assinatura é buscada de novo direto na API do Asaas (fonte confiável).
  const esperado = Deno.env.get("ASAAS_WEBHOOK_TOKEN") ?? "";
  if (esperado && !iguais(req.headers.get("asaas-access-token") ?? "", esperado)) {
    return new Response("Não autorizado", { status: 401 });
  }

  const bruto = await req.json().catch(() => null);
  if (!bruto?.event) return ok();
  let corpo: Record<string, any> | null;
  try {
    corpo = esperado ? bruto : await confirmarNoAsaas(bruto);
  } catch (e) {
    console.error("Não foi possível conferir o aviso no Asaas", e);
    return new Response("Tente de novo", { status: 503 });
  }
  if (!corpo) return ok();

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // Idempotência: o Asaas pode reenviar o mesmo evento.
  if (corpo.id) {
    const { error } = await db.from("webhook_eventos").insert({ id: String(corpo.id), evento: corpo.event });
    if (error?.code === "23505") return ok();
  }

  try {
    const evento: string = corpo.event;
    const pagamento = corpo.payment ?? null;
    const assinaturaAsaas = corpo.subscription ?? null;
    const subId: string | null = pagamento?.subscription ?? assinaturaAsaas?.id ?? null;
    if (!subId) {
      // Cobrança avulsa: só interessa se for a diferença de uma troca de plano feita no app.
      const ref = String(pagamento?.externalReference ?? "");
      if (ref.startsWith("troca:") && (evento === "PAYMENT_CONFIRMED" || evento === "PAYMENT_RECEIVED")) {
        await aplicarTroca(db, ref.slice("troca:".length), pagamento);
      }
      return ok();
    }

    const { data: pedido } = await db
      .from("checkout_pedidos")
      .select("*")
      .eq("asaas_assinatura_id", subId)
      .maybeSingle();
    if (!pedido) {
      console.warn("Assinatura sem pedido no Mesari", subId);
      return ok();
    }

    if (evento === "PAYMENT_CONFIRMED" || evento === "PAYMENT_RECEIVED") {
      let restauranteId: number | null = pedido.restaurante_id;

      // Já tem conta com esse e-mail (fez o teste grátis)? Usa o restaurante dela.
      if (!restauranteId) {
        const { data } = await db.rpc("restaurante_por_email", { p_email: pedido.email });
        restauranteId = data ?? null;
      }

      // Conta nova: convite por e-mail. O gatilho do banco cria o restaurante.
      if (!restauranteId) {
        const site = Deno.env.get("MESARI_SITE_URL") ?? "https://mesari-site.vercel.app";
        const { error } = await db.auth.admin.inviteUserByEmail(pedido.email, {
          data: { nome: pedido.nome, restaurante: pedido.restaurante_nome ?? "Meu restaurante" },
          redirectTo: `${site}/senha/`,
        });
        if (error) throw error;
        const { data } = await db.rpc("restaurante_por_email", { p_email: pedido.email });
        restauranteId = data ?? null;
        if (!restauranteId) throw new Error("Conta criada, mas o restaurante não foi encontrado.");
      }

      const { data: atual } = await db
        .from("assinaturas")
        .select("*")
        .eq("restaurante_id", restauranteId)
        .maybeSingle();

      // Mudou de plano pelo checkout: cancela a assinatura antiga no Asaas.
      if (atual?.gateway === "asaas" && atual.gateway_assinatura_id && atual.gateway_assinatura_id !== subId) {
        await fetch(`${baseAsaas()}/subscriptions/${atual.gateway_assinatura_id}`, {
          method: "DELETE",
          headers: { access_token: Deno.env.get("ASAAS_API_KEY") ?? "", "User-Agent": "Mesari" },
        }).catch((e) => console.warn("Não cancelou a assinatura antiga", e));
      }

      // Renovação da mesma assinatura: vale o plano atual (que pode ter sido trocado no app)
      // ou a troca agendada para esta renovação. Primeira cobrança: vale o que foi comprado.
      const renovacao = atual?.gateway_assinatura_id === subId;
      const planoFinal: string = renovacao ? (atual.plano_proximo ?? atual.plano_id) : pedido.plano_id;
      const cicloFinal: string = renovacao ? (atual.ciclo_proximo ?? atual.ciclo ?? pedido.ciclo) : pedido.ciclo;

      const vencimento = String(pagamento?.dueDate ?? new Date().toISOString().slice(0, 10));
      let periodoFim = somarPeriodo(vencimento, cicloFinal);
      if (atual?.periodo_fim && atual.gateway_assinatura_id === subId && atual.periodo_fim > periodoFim) {
        periodoFim = atual.periodo_fim;
      }

      const { error: erroAssinatura } = await db.from("assinaturas").upsert({
        restaurante_id: restauranteId,
        plano_id: planoFinal,
        plano_proximo: null,
        ciclo_proximo: null,
        status: "ativa",
        ciclo: cicloFinal,
        periodo_fim: periodoFim,
        renovacao_automatica: true,
        gateway: "asaas",
        gateway_cliente_id: pedido.asaas_cliente_id,
        gateway_assinatura_id: subId,
        atualizado_em: new Date().toISOString(),
      });
      if (erroAssinatura) throw erroAssinatura;

      await db
        .from("checkout_pedidos")
        .update({ status: "pago", restaurante_id: restauranteId, atualizado_em: new Date().toISOString() })
        .eq("id", pedido.id);
      if (renovacao && (atual.plano_proximo || atual.ciclo_proximo)) {
        await db.from("plano_trocas").update({ status: "aplicada", atualizado_em: new Date().toISOString() })
          .eq("restaurante_id", restauranteId).eq("status", "agendada");
      }
      return ok();
    }

    if (!pedido.restaurante_id) return ok(); // ainda não pagou a primeira: nada a mudar

    const mudar = async (campos: Record<string, unknown>) => {
      await db
        .from("assinaturas")
        .update({ ...campos, atualizado_em: new Date().toISOString() })
        .eq("restaurante_id", pedido.restaurante_id)
        .eq("gateway_assinatura_id", subId);
    };

    if (evento === "PAYMENT_OVERDUE") await mudar({ status: "atrasada" });
    else if (evento === "PAYMENT_REFUNDED" || evento === "PAYMENT_CHARGEBACK_REQUESTED") {
      await mudar({ status: "expirada", periodo_fim: new Date().toISOString() });
    } else if (evento === "SUBSCRIPTION_DELETED" || evento === "SUBSCRIPTION_INACTIVATED") {
      await mudar({ status: "cancelada", renovacao_automatica: false });
      await db.from("checkout_pedidos").update({ status: "cancelado" }).eq("id", pedido.id);
    }
    return ok();
  } catch (e) {
    console.error("asaas-webhook", corpo?.event, e);
    // Libera o evento para o Asaas reenviar.
    if (corpo.id) await db.from("webhook_eventos").delete().eq("id", String(corpo.id));
    return new Response("Erro ao processar", { status: 500 });
  }
});
