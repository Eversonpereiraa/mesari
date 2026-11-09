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
    if (!subId) return ok(); // cobrança avulsa: não é do Mesari

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

      const vencimento = String(pagamento?.dueDate ?? new Date().toISOString().slice(0, 10));
      let periodoFim = somarPeriodo(vencimento, pedido.ciclo);
      if (atual?.periodo_fim && atual.gateway_assinatura_id === subId && atual.periodo_fim > periodoFim) {
        periodoFim = atual.periodo_fim;
      }

      const { error: erroAssinatura } = await db.from("assinaturas").upsert({
        restaurante_id: restauranteId,
        plano_id: pedido.plano_id,
        status: "ativa",
        ciclo: pedido.ciclo,
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
