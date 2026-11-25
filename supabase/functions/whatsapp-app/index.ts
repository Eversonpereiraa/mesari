// Mesari — WhatsApp: chamadas feitas pela tela "WhatsApp" do app (caixa logado).
//
//   { acao: "simular", telefone?, nome?, texto }  mensagem como se fosse um cliente (teste, sem Meta)
//   { acao: "responder", conversa_id, texto }      resposta manual do dono (assume a conversa)
//
// Deploy: supabase functions deploy whatsapp-app
// Secrets: GEMINI_API_KEY (obrigatória), GEMINI_MODEL (opcional)
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  ErroAtendimento,
  processarMensagemCliente,
  responderComoAtendente,
  verificarPlano,
} from "../_shared/atendimento.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "Método não permitido" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    // Quem chama precisa ser o caixa de um restaurante.
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) throw new ErroAtendimento("Entre novamente no Mesari.", 401);
    const { data: perfil, error: perfilError } = await admin
      .from("profiles")
      .select("restaurante_id,papel,ativo")
      .eq("id", auth.user.id)
      .maybeSingle();
    if (perfilError) throw perfilError;
    if (!perfil?.ativo || perfil.papel !== "caixa") {
      throw new ErroAtendimento("Só o caixa pode usar o WhatsApp do restaurante.", 403);
    }
    const restauranteId = Number(perfil.restaurante_id);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const texto = typeof body["texto"] === "string" ? body["texto"] : "";

    if (body["acao"] === "simular") {
      await verificarPlano(admin, restauranteId);
      const telefone =
        String(body["telefone"] ?? "")
          .replace(/\D/g, "")
          .slice(0, 15) || "5500000000000";
      const nome =
        typeof body["nome"] === "string" && body["nome"].trim()
          ? body["nome"].trim().slice(0, 80)
          : null;
      return json(
        await processarMensagemCliente(admin, {
          restauranteId,
          canal: "simulador",
          telefone,
          nome,
          texto,
        }),
      );
    }

    if (body["acao"] === "responder") {
      const conversaId = typeof body["conversa_id"] === "string" ? body["conversa_id"] : "";
      return json(await responderComoAtendente(admin, { restauranteId, conversaId, texto }));
    }

    return json({ erro: "Ação inválida" }, 400);
  } catch (erro) {
    const status = erro instanceof ErroAtendimento ? erro.status : 500;
    const mensagem =
      erro instanceof Error
        ? erro.message
        : String((erro as { message?: string })?.message ?? erro);
    if (status === 500) console.error(erro);
    return json({ erro: mensagem }, status);
  }
});
