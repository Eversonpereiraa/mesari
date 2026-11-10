// Mesari — checkout próprio da landing (Mercado Pago).
//
// POST { acao: "criar", nome, email, telefone, cpfCnpj, restaurante, codigo, plano, ciclo }
//   → valida, grava o pedido e devolve { pedido, valor, plano, ciclo }.
// POST { acao: "pagar", pedido, metodo: "cartao"|"pix"|"boleto", dados }   (dados = formData do Payment Brick)
//   cartão → assinatura recorrente (preapproval): cobra agora e renova sozinha a cada ciclo.
//   pix    → pagamento avulso; devolve QR Code e copia-e-cola.
//   boleto → pagamento avulso; devolve link e linha digitável.
// POST { acao: "status", pedido } → { status, motivo }   (a página consulta até o pagamento cair)
// POST { acao: "pagina", pedido } → link do Checkout Pro (plano B: pagar na página do Mercado Pago)
// Sem "acao": fluxo antigo (cria o pedido e devolve o link do Checkout Pro).
//
// Secrets: MP_ACCESS_TOKEN, MESARI_SITE_URL (opcional),
//          MESARI_VALOR_TESTE (opcional: todo pedido sai com esse valor, para testes).
import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGENS = ["https://mesari-site.vercel.app", "http://localhost:5500", "http://127.0.0.1:5500"];
type Ciclo = "mensal" | "trimestral" | "anual";
const MESES: Record<Ciclo, number> = { mensal: 1, trimestral: 3, anual: 12 };
const NOME_CICLO: Record<Ciclo, string> = { mensal: "mensal", trimestral: "trimestral", anual: "anual" };

// Previews da Vercel do próprio projeto (mesari-site-*.vercel.app) também podem chamar.
const origemPermitida = (o: string | null) =>
  Boolean(o && (ORIGENS.includes(o) || /^https:\/\/mesari-site(-[a-z0-9-]+)?\.vercel\.app$/.test(o)));

// Limites anti-abuso (por IP). Protegem contra robôs testando cartões roubados ("carding"),
// que podem fazer o Mercado Pago bloquear a conta.
const LIMITES: Record<string, { max: number; minutos: number }> = {
  criar: { max: 15, minutos: 60 },
  cartao: { max: 5, minutos: 60 },
  pix: { max: 10, minutos: 60 },
  boleto: { max: 5, minutos: 60 },
};
const MAX_CARTAO_POR_PEDIDO = 3;

function ipDe(req: Request) {
  return (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0] ?? "").trim().slice(0, 64) || "desconhecido";
}

/** Registra a tentativa e diz se o IP passou do limite. */
async function excedeuLimite(db: any, ip: string, tipo: string) {
  const lim = LIMITES[tipo];
  if (!lim) return false;
  const desde = new Date(Date.now() - lim.minutos * 60_000).toISOString();
  const { count } = await db.from("checkout_tentativas").select("id", { count: "exact", head: true })
    .eq("ip", ip).eq("tipo", tipo).gte("criado_em", desde);
  if ((count ?? 0) >= lim.max) return true;
  await db.from("checkout_tentativas").insert({ ip, tipo });
  return false;
}

function cors(origin: string | null) {
  const permitido = origemPermitida(origin);
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
const site = () => Deno.env.get("MESARI_SITE_URL") ?? "https://mesari-site.vercel.app";
const avisoUrl = () => `${Deno.env.get("SUPABASE_URL")}/functions/v1/mp-webhook`;
const lerCiclo = (v: unknown): Ciclo => (v === "anual" ? "anual" : v === "trimestral" ? "trimestral" : "mensal");

function cpfCnpjValido(doc: string) {
  if (!/^\d{11}$|^\d{14}$/.test(doc) || /^(\d)\1+$/.test(doc)) return false;
  const calc = (base: string, pesos: number[]) => {
    const soma = base.split("").reduce((s, d, i) => s + Number(d) * pesos[i]!, 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  if (doc.length === 11) {
    return calc(doc.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(doc[9]) &&
      calc(doc.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(doc[10]);
  }
  return calc(doc.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(doc[12]) &&
    calc(doc.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(doc[13]);
}

async function mp(path: string, body: unknown, chave?: string) {
  const res = await fetch("https://api.mercadopago.com" + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("MP_ACCESS_TOKEN") ?? ""}`,
      "X-Idempotency-Key": chave ?? crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("Mercado Pago", path, res.status, JSON.stringify(data));
    const err = new Error(String(data?.message ?? `Mercado Pago respondeu ${res.status}`));
    (err as Error & { mp?: unknown }).mp = data;
    throw err;
  }
  return data;
}

function nomeSobrenome(nome: string) {
  const [primeiro, ...resto] = nome.trim().split(/\s+/);
  return { first_name: primeiro ?? nome, last_name: resto.join(" ") || primeiro || nome };
}

Deno.serve(async (req) => {
  const headers = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ erro: "Método não permitido" }, 405, headers);
  if (!Deno.env.get("MP_ACCESS_TOKEN")) {
    return json({ erro: "Pagamento ainda não configurado. Fale com a gente no WhatsApp." }, 503, headers);
  }

  // Navegador de outro site não pode usar o checkout (o CORS já bloqueia a leitura; isto bloqueia a ação).
  const origem = req.headers.get("origin");
  if (origem && !origemPermitida(origem)) return json({ erro: "Origem não permitida." }, 403, headers);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const ip = ipDe(req);
  const muitas = () => json({ erro: "Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo, ou fale com a gente no WhatsApp." }, 429, headers);

  try {
    const d = await req.json().catch(() => ({}));
    const acao = String(d.acao ?? "");
    if (!/^(|criar|pagar|status|pagina)$/.test(acao)) return json({ erro: "Ação inválida." }, 400, headers);
    if (acao === "status" && !/^[0-9a-f-]{36}$/i.test(String(d.pedido ?? ""))) return json({ erro: "Pedido inválido." }, 400, headers);

    // ---------- status do pedido (a página consulta enquanto espera) ----------
    if (acao === "status") {
      const { data: p } = await db.from("checkout_pedidos").select("status, metodo, motivo_recusa").eq("id", String(d.pedido ?? "")).maybeSingle();
      if (!p) return json({ erro: "Pedido não encontrado." }, 404, headers);
      return json({ status: p.status, metodo: p.metodo, motivo: p.motivo_recusa }, 200, headers);
    }

    // ---------- pagar um pedido já criado ----------
    if (acao === "pagar" || acao === "pagina") {
      if (!/^[0-9a-f-]{36}$/i.test(String(d.pedido ?? ""))) return json({ erro: "Pedido inválido." }, 400, headers);
      const { data: pedido } = await db.from("checkout_pedidos").select("*").eq("id", String(d.pedido ?? "")).maybeSingle();
      if (!pedido) return json({ erro: "Pedido não encontrado. Recarregue a página." }, 404, headers);
      if (pedido.status === "pago") return json({ status: "pago" }, 200, headers);
      if (Date.now() - Date.parse(pedido.criado_em) > 2 * 86_400_000) {
        return json({ erro: "Este pedido expirou. Recarregue a página para começar de novo." }, 410, headers);
      }
      const { data: plano } = await db.from("planos").select("*").eq("id", pedido.plano_id).maybeSingle();
      const ciclo = lerCiclo(pedido.ciclo);
      const titulo = `Mesari ${plano?.nome ?? pedido.plano_id} (${NOME_CICLO[ciclo]})`;
      const ref = `pedido:${pedido.id}`;
      const valor = Number(pedido.valor);
      const doc = soDigitos(pedido.cpf_cnpj ?? "");

      if (acao === "pagina") {
        const pref = await mp("/checkout/preferences", {
          items: [{ id: `mesari-${pedido.plano_id}-${ciclo}`, title: titulo, quantity: 1, unit_price: valor, currency_id: "BRL" }],
          payer: { ...nomeSobrenome(pedido.nome), email: pedido.email },
          external_reference: ref,
          notification_url: avisoUrl(),
          back_urls: { success: `${site()}/obrigado/`, pending: `${site()}/obrigado/?status=pendente`, failure: `${site()}/assinar/?plano=${pedido.plano_id}&ciclo=${ciclo}` },
          auto_return: "approved",
          statement_descriptor: "MESARI",
          payment_methods: { installments: ciclo === "anual" ? 12 : 1 },
        });
        await db.from("checkout_pedidos").update({ mp_preference_id: pref.id, metodo: "pagina" }).eq("id", pedido.id);
        return json({ url: pref.init_point }, 200, headers);
      }

      const metodo = String(d.metodo ?? "");
      const dados = (d.dados ?? {}) as Record<string, any>;
      const payerBrick = (dados.payer ?? {}) as Record<string, any>;
      const identificacao = payerBrick.identification?.number
        ? { type: payerBrick.identification.type, number: soDigitos(payerBrick.identification.number) }
        : doc ? { type: doc.length === 14 ? "CNPJ" : "CPF", number: doc } : undefined;

      if (["cartao", "pix", "boleto"].includes(metodo) && await excedeuLimite(db, ip, metodo)) return muitas();

      if (metodo === "cartao") {
        if (!dados.token || typeof dados.token !== "string") return json({ erro: "Preencha os dados do cartão." }, 400, headers);
        if (Number(pedido.tentativas_cartao ?? 0) >= MAX_CARTAO_POR_PEDIDO) {
          return json({ erro: "Este pedido teve muitas tentativas no cartão. Pague com Pix ou recarregue a página e tente com outro cartão mais tarde." }, 429, headers);
        }
        await db.from("checkout_pedidos").update({ tentativas_cartao: Number(pedido.tentativas_cartao ?? 0) + 1 }).eq("id", pedido.id);
        let assinatura;
        try {
          assinatura = await mp("/preapproval", {
            reason: titulo,
            external_reference: ref,
            payer_email: pedido.email,
            card_token_id: dados.token,
            auto_recurring: {
              frequency: MESES[ciclo],
              frequency_type: "months",
              transaction_amount: valor,
              currency_id: "BRL",
            },
            back_url: `${site()}/obrigado/`,
            status: "authorized",
          }, `assinatura-${pedido.id}-${String(dados.token).slice(-12)}`);
        } catch (e) {
          const mpErro = (e as { mp?: Record<string, any> }).mp ?? {};
          console.error("preapproval recusada", JSON.stringify(mpErro));
          return json({
            erro: /card|token|cart/i.test(String(mpErro.message ?? ""))
              ? "Não foi possível usar este cartão. Confira os dados ou pague com Pix."
              : "Não foi possível criar a assinatura no cartão agora. Tente de novo ou pague com Pix.",
          }, 400, headers);
        }
        await db.from("checkout_pedidos").update({
          mp_preapproval_id: assinatura.id, metodo: "cartao", status: "aguardando", motivo_recusa: null,
          atualizado_em: new Date().toISOString(),
        }).eq("id", pedido.id);
        return json({ status: "processando", pedido: pedido.id }, 200, headers);
      }

      if (metodo === "pix" || metodo === "boleto") {
        const nomes = nomeSobrenome(pedido.nome);
        const payer: Record<string, unknown> = {
          email: pedido.email,
          first_name: payerBrick.first_name || nomes.first_name,
          last_name: payerBrick.last_name || nomes.last_name,
          identification: identificacao,
        };
        if (metodo === "boleto") payer.address = payerBrick.address;
        const pagamento = await mp("/v1/payments", {
          transaction_amount: valor,
          description: titulo,
          payment_method_id: metodo === "pix" ? "pix" : (dados.payment_method_id || "bolbradesco"),
          payer,
          external_reference: ref,
          notification_url: avisoUrl(),
          statement_descriptor: "MESARI",
          ...(metodo === "pix" ? { date_of_expiration: new Date(Date.now() + 30 * 60_000).toISOString() } : {}),
        }, `${metodo}-${pedido.id}-${Math.floor(Date.now() / 600_000)}`);
        await db.from("checkout_pedidos").update({
          mp_payment_id: String(pagamento.id), metodo, atualizado_em: new Date().toISOString(),
        }).eq("id", pedido.id);
        if (metodo === "pix") {
          const t = pagamento.point_of_interaction?.transaction_data ?? {};
          return json({
            status: "pix", pedido: pedido.id, valor, qr_code: t.qr_code, qr_code_base64: t.qr_code_base64,
            link: t.ticket_url, expira: pagamento.date_of_expiration,
          }, 200, headers);
        }
        return json({
          status: "boleto", pedido: pedido.id, valor,
          link: pagamento.transaction_details?.external_resource_url,
          codigo: pagamento.barcode?.content ?? null, vence: pagamento.date_of_expiration,
        }, 200, headers);
      }
      return json({ erro: "Escolha uma forma de pagamento." }, 400, headers);
    }

    // ---------- criar o pedido (acao "criar" ou fluxo antigo) ----------
    if (await excedeuLimite(db, ip, "criar")) return muitas();
    const nome = String(d.nome ?? "").trim().slice(0, 120);
    const email = String(d.email ?? "").trim().toLowerCase().slice(0, 160);
    const telefone = soDigitos(d.telefone).slice(0, 13);
    const cpfCnpj = soDigitos(d.cpfCnpj);
    const restauranteNome = String(d.restaurante ?? "").trim().slice(0, 120);
    const codigo = soDigitos(d.codigo).slice(0, 6) || null;
    const ciclo = lerCiclo(d.ciclo);

    if (nome.length < 3 || !/\s/.test(nome)) return json({ erro: "Informe seu nome e sobrenome.", campo: "nome" }, 400, headers);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ erro: "E-mail inválido.", campo: "email" }, 400, headers);
    if (telefone.length < 10) return json({ erro: "Informe o WhatsApp com DDD.", campo: "telefone" }, 400, headers);
    if (!cpfCnpjValido(cpfCnpj)) return json({ erro: "CPF ou CNPJ inválido.", campo: "cpfCnpj" }, 400, headers);
    if (!codigo && restauranteNome.length < 2) return json({ erro: "Informe o nome do restaurante.", campo: "restaurante" }, 400, headers);

    const { data: plano } = await db.from("planos").select("*").eq("id", String(d.plano ?? "")).maybeSingle();
    if (!plano) return json({ erro: "Plano inválido." }, 400, headers);
    const preco = Number(ciclo === "anual" ? plano.preco_anual : ciclo === "trimestral" ? plano.preco_trimestral : plano.preco_mensal);
    const valorTeste = Number(Deno.env.get("MESARI_VALOR_TESTE") ?? "");
    const valor = valorTeste > 0 ? valorTeste : preco;

    let restauranteId: number | null = null;
    if (codigo) {
      const { data: r } = await db.from("restaurante").select("id").eq("codigo", codigo).maybeSingle();
      if (!r) return json({ erro: "Código do restaurante não encontrado.", campo: "codigo" }, 400, headers);
      restauranteId = r.id;
    }

    const { data: pedido, error: erroPedido } = await db.from("checkout_pedidos").insert({
      email, nome, telefone, restaurante_nome: restauranteNome || null, restaurante_codigo: codigo,
      plano_id: plano.id, ciclo, valor, restaurante_id: restauranteId, gateway: "mercadopago", cpf_cnpj: cpfCnpj, ip,
    }).select("id").single();
    if (erroPedido) throw erroPedido;

    if (acao === "criar") {
      return json({ pedido: pedido.id, valor, preco, plano: plano.nome, ciclo }, 200, headers);
    }

    // Fluxo antigo: link do Checkout Pro.
    const pref = await mp("/checkout/preferences", {
      items: [{ id: `mesari-${plano.id}-${ciclo}`, title: `Mesari ${plano.nome} (${NOME_CICLO[ciclo]})`, quantity: 1, unit_price: valor, currency_id: "BRL" }],
      payer: { ...nomeSobrenome(nome), email, identification: { type: cpfCnpj.length === 14 ? "CNPJ" : "CPF", number: cpfCnpj } },
      external_reference: `pedido:${pedido.id}`,
      notification_url: avisoUrl(),
      back_urls: { success: `${site()}/obrigado/`, pending: `${site()}/obrigado/?status=pendente`, failure: `${site()}/?pagamento=falhou#preco` },
      auto_return: "approved",
      statement_descriptor: "MESARI",
      payment_methods: { installments: ciclo === "anual" ? 12 : 1 },
    });
    await db.from("checkout_pedidos").update({ mp_preference_id: pref.id, metodo: "pagina" }).eq("id", pedido.id);
    return json({ url: pref.init_point }, 200, headers);
  } catch (e) {
    console.error("checkout", e);
    return json({ erro: "Não foi possível processar o pagamento agora. Tente de novo em instantes." }, 400, headers);
  }
});
