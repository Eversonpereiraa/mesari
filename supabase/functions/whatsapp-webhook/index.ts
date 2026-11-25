// Mesari — WhatsApp: webhook da API oficial da Meta (Cloud API). ETAPA 2.
// Recebe as mensagens dos clientes e passa para o mesmo atendimento do simulador.
//
// Deploy (a Meta não manda o login do Supabase, então sem verificação de JWT):
//   supabase functions deploy whatsapp-webhook --no-verify-jwt
// URL para colocar no painel da Meta (WhatsApp → Configuração → Webhook):
//   https://<projeto>.supabase.co/functions/v1/whatsapp-webhook   (campo: messages)
//
// Secrets:
//   WHATSAPP_VERIFY_TOKEN  texto qualquer, o mesmo digitado no painel da Meta ("Verify token")
//   WHATSAPP_APP_SECRET    "Chave secreta do app" (App → Configurações → Básico). Obrigatória:
//                          sem ela qualquer um poderia mandar pedidos falsos para a impressora.
//   GEMINI_API_KEY         mesma do simulador
//
// Cada restaurante precisa de uma linha em whatsapp_credenciais (phone_number_id + access_token).
import { createClient } from "npm:@supabase/supabase-js@2";
import { processarMensagemCliente } from "../_shared/atendimento.ts";

type Linha = Record<string, unknown>;
const lista = (v: unknown) => (Array.isArray(v) ? (v as Linha[]) : []);
const reg = (v: unknown) => (typeof v === "object" && v !== null ? (v as Linha) : {});

async function assinaturaValida(corpo: string, cabecalho: string | null, segredo: string) {
  if (!cabecalho?.startsWith("sha256=")) return false;
  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const assinatura = new Uint8Array(
    await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(corpo)),
  );
  const esperado = [...assinatura].map((b) => b.toString(16).padStart(2, "0")).join("");
  const recebido = cabecalho.slice(7);
  if (recebido.length !== esperado.length) return false;
  let diferenca = 0;
  for (let i = 0; i < esperado.length; i++)
    diferenca |= esperado.charCodeAt(i) ^ recebido.charCodeAt(i);
  return diferenca === 0;
}

async function processar(corpo: Linha) {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
  for (const entrada of lista(corpo["entry"])) {
    for (const mudanca of lista(entrada["changes"])) {
      const valor = reg(mudanca["value"]);
      const numeroId = String(reg(valor["metadata"])["phone_number_id"] ?? "");
      const { data: cred } = await admin
        .from("whatsapp_credenciais")
        .select("restaurante_id")
        .eq("phone_number_id", numeroId)
        .maybeSingle();
      if (!cred) {
        console.warn("Número sem restaurante:", numeroId);
        continue;
      }
      const nomes = new Map(
        lista(valor["contacts"]).map((c) => [
          String(c["wa_id"] ?? ""),
          String(reg(c["profile"])["name"] ?? ""),
        ]),
      );
      for (const msg of lista(valor["messages"])) {
        const de = String(msg["from"] ?? "");
        const tipo = String(msg["type"] ?? "");
        const texto =
          tipo === "text"
            ? String(reg(msg["text"])["body"] ?? "")
            : tipo === "button"
              ? String(reg(msg["button"])["text"] ?? "")
              : `[${tipo || "mensagem"} recebida — o atendente automático por enquanto só lê texto. Pode escrever o pedido?]`;
        try {
          await processarMensagemCliente(admin, {
            restauranteId: Number(cred.restaurante_id),
            canal: "whatsapp",
            telefone: de,
            nome: nomes.get(de) || null,
            texto,
            metaId: String(msg["id"] ?? "") || undefined,
          });
        } catch (erro) {
          console.error("Falha ao processar mensagem", msg["id"], erro);
        }
      }
    }
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Verificação do webhook (feita uma vez pelo painel da Meta).
  if (req.method === "GET") {
    const ok =
      url.searchParams.get("hub.mode") === "subscribe" &&
      url.searchParams.get("hub.verify_token") === Deno.env.get("WHATSAPP_VERIFY_TOKEN");
    return ok
      ? new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 })
      : new Response("Token inválido", { status: 403 });
  }
  if (req.method !== "POST") return new Response("Método não permitido", { status: 405 });

  const segredo = Deno.env.get("WHATSAPP_APP_SECRET");
  if (!segredo) return new Response("WHATSAPP_APP_SECRET não configurado", { status: 503 });
  const corpo = await req.text();
  if (!(await assinaturaValida(corpo, req.headers.get("x-hub-signature-256"), segredo))) {
    return new Response("Assinatura inválida", { status: 401 });
  }

  let dados: Linha;
  try {
    dados = JSON.parse(corpo) as Linha;
  } catch {
    return new Response("JSON inválido", { status: 400 });
  }

  // Responde 200 na hora (a Meta reenvia se demorar) e processa em segundo plano.
  const trabalho = processar(dados);
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } })
    .EdgeRuntime;
  if (runtime) runtime.waitUntil(trabalho);
  else await trabalho;
  return new Response("ok", { status: 200 });
});
