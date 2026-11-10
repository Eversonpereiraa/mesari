// Mesari — checkout da landing page.
// Com MP_ACCESS_TOKEN configurado, usa o Mercado Pago (Checkout Pro: Pix, boleto e cartão).
// Sem ele, continua no Asaas (legado).
// Recebe os dados do formulário, cria cliente + assinatura no Asaas e devolve o link da
// primeira cobrança (o cliente escolhe Pix, boleto ou cartão na página do Asaas).
//
// Secrets (Supabase → Edge Functions → Secrets):
//   ASAAS_API_KEY   chave da API (sandbox ou produção)
//   ASAAS_BASE_URL  opcional. Padrão: https://api-sandbox.asaas.com/v3 (produção: https://api.asaas.com/v3)
//   MESARI_VALOR_TESTE  opcional. Se existir (ex.: 5), TODA cobrança sai com esse valor, para testes.
//                       Apague o secret para voltar aos preços reais dos planos.
import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGENS = [
  "https://mesari-site.vercel.app",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];

function cors(origin: string | null) {
  const permitido = origin && (ORIGENS.includes(origin) || origin.endsWith(".vercel.app"));
  return {
    "Access-Control-Allow-Origin": permitido ? origin! : ORIGENS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

function cpfCnpjValido(doc: string) {
  if (!/^\d{11}$|^\d{14}$/.test(doc) || /^(\d)\1+$/.test(doc)) return false;
  const calc = (base: string, pesos: number[]) => {
    const soma = base.split("").reduce((s, d, i) => s + Number(d) * pesos[i]!, 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  if (doc.length === 11) {
    const p1 = [10, 9, 8, 7, 6, 5, 4, 3, 2];
    const p2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
    return calc(doc.slice(0, 9), p1) === Number(doc[9]) && calc(doc.slice(0, 10), p2) === Number(doc[10]);
  }
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const p2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  return calc(doc.slice(0, 12), p1) === Number(doc[12]) && calc(doc.slice(0, 13), p2) === Number(doc[13]);
}

function hojeSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

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
  if (!res.ok) {
    const msg = body?.errors?.[0]?.description ?? `Asaas respondeu ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

async function mercadoPago(path: string, body: unknown) {
  const res = await fetch("https://api.mercadopago.com" + path, {
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
  const headers = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ erro: "Método não permitido" }, 405, headers);
  const usaMP = Boolean(Deno.env.get("MP_ACCESS_TOKEN"));
  if (!usaMP && !Deno.env.get("ASAAS_API_KEY")) {
    return json({ erro: "Pagamento ainda não configurado. Fale com a gente no WhatsApp." }, 503, headers);
  }

  try {
    const d = await req.json();
    const nome = String(d.nome ?? "").trim().slice(0, 120);
    const email = String(d.email ?? "").trim().toLowerCase().slice(0, 160);
    const telefone = soDigitos(d.telefone).slice(0, 13);
    const cpfCnpj = soDigitos(d.cpfCnpj);
    const restauranteNome = String(d.restaurante ?? "").trim().slice(0, 120);
    const codigo = soDigitos(d.codigo).slice(0, 6) || null;
    const planoId = String(d.plano ?? "");
    const ciclo = d.ciclo === "anual" ? "anual" : "mensal";

    if (nome.length < 3) return json({ erro: "Informe seu nome." }, 400, headers);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ erro: "E-mail inválido." }, 400, headers);
    if (telefone.length < 10) return json({ erro: "Informe o WhatsApp com DDD." }, 400, headers);
    if (!cpfCnpjValido(cpfCnpj)) return json({ erro: "CPF ou CNPJ inválido." }, 400, headers);
    if (!codigo && restauranteNome.length < 2) return json({ erro: "Informe o nome do restaurante." }, 400, headers);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });

    const { data: plano } = await db.from("planos").select("*").eq("id", planoId).maybeSingle();
    if (!plano) return json({ erro: "Plano inválido." }, 400, headers);
    const valorTeste = Number(Deno.env.get("MESARI_VALOR_TESTE") ?? "");
    const valor = valorTeste > 0 ? valorTeste : Number(ciclo === "anual" ? plano.preco_anual : plano.preco_mensal);

    let restauranteId: number | null = null;
    if (codigo) {
      const { data: r } = await db.from("restaurante").select("id").eq("codigo", codigo).maybeSingle();
      if (!r) return json({ erro: "Código do restaurante não encontrado." }, 400, headers);
      restauranteId = r.id;
    }

    const { data: pedido, error: erroPedido } = await db
      .from("checkout_pedidos")
      .insert({
        email, nome, telefone, restaurante_nome: restauranteNome || null, restaurante_codigo: codigo,
        plano_id: plano.id, ciclo, valor, restaurante_id: restauranteId,
        gateway: usaMP ? "mercadopago" : "asaas",
      })
      .select("id")
      .single();
    if (erroPedido) throw erroPedido;

    if (usaMP) {
      const site = Deno.env.get("MESARI_SITE_URL") ?? "https://mesari-site.vercel.app";
      const titulo = `Mesari ${plano.nome} (${ciclo})${restauranteNome ? " - " + restauranteNome : ""}`;
      const [primeiro, ...resto] = nome.split(/\s+/);
      const preferencia = await mercadoPago("/checkout/preferences", {
        items: [{ id: `mesari-${plano.id}-${ciclo}`, title: titulo, quantity: 1, unit_price: valor, currency_id: "BRL" }],
        payer: {
          name: primeiro,
          surname: resto.join(" ") || undefined,
          email,
          identification: { type: cpfCnpj.length === 14 ? "CNPJ" : "CPF", number: cpfCnpj },
        },
        external_reference: `pedido:${pedido.id}`,
        notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mp-webhook`,
        back_urls: {
          success: `${site}/obrigado/`,
          pending: `${site}/obrigado/?status=pendente`,
          failure: `${site}/?pagamento=falhou#preco`,
        },
        auto_return: "approved",
        statement_descriptor: "MESARI",
        payment_methods: { installments: ciclo === "anual" ? 12 : 1 },
        expires: true,
        expiration_date_to: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      });
      await db.from("checkout_pedidos").update({ mp_preference_id: preferencia.id }).eq("id", pedido.id);
      return json({ url: preferencia.init_point }, 200, headers);
    }

    const cliente = await asaas("/customers", {
      method: "POST",
      body: JSON.stringify({ name: nome, email, cpfCnpj, mobilePhone: telefone, externalReference: pedido.id }),
    });

    const assinatura = await asaas("/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        customer: cliente.id,
        billingType: "UNDEFINED",
        value: valor,
        nextDueDate: hojeSaoPaulo(),
        cycle: ciclo === "anual" ? "YEARLY" : "MONTHLY",
        description: `Mesari ${plano.nome} (${ciclo})${restauranteNome ? " - " + restauranteNome : ""}`,
        externalReference: pedido.id,
      }),
    });

    await db
      .from("checkout_pedidos")
      .update({ asaas_cliente_id: cliente.id, asaas_assinatura_id: assinatura.id, atualizado_em: new Date().toISOString() })
      .eq("id", pedido.id);

    const cobrancas = await asaas(`/subscriptions/${assinatura.id}/payments`);
    const link = cobrancas?.data?.[0]?.invoiceUrl;
    if (!link) throw new Error("O Asaas não devolveu o link da cobrança.");

    return json({ url: link }, 200, headers);
  } catch (e) {
    console.error("checkout", e);
    return json({ erro: e instanceof Error ? e.message : "Não foi possível iniciar o pagamento." }, 400, headers);
  }
});
