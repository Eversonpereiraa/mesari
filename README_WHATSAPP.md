# WhatsApp com robô (Mesari)

Tela **WhatsApp** no menu do caixa: conversas separadas em **Precisa de você**, **Robô atendendo**,
**Pedido lançado** e **Finalizadas**. O robô (Gemini) lê o pedido, pergunta o que falta, mostra o
resumo com os valores do cardápio e, quando o cliente responde "sim", lança o pedido no **Delivery**
(mesma função `criar_pedido_externo`, então numera, respeita o plano e imprime sozinho).

A IA nunca define preço nem total: item fora do cardápio é descartado e o resumo é montado pelo
sistema (`supabase/functions/_shared/pedido-whatsapp.ts`, testado em `src/test/pedido-whatsapp.test.ts`).

## Etapa 1 — simulador (grátis, sem Meta)

1. **Banco:** Supabase → SQL Editor → cole e rode
   `supabase/migrations/202611250001_whatsapp_atendimento.sql`.
2. **Chave da IA:** crie em https://aistudio.google.com/apikey e salve em
   Supabase → Edge Functions → Secrets como `GEMINI_API_KEY`.
   (Opcional: `GEMINI_MODEL`, padrão `gemini-flash-latest`.)
3. **Publicar a função** (no terminal, na pasta do projeto):
   ```
   npx supabase login
   npx supabase link --project-ref skjsvyvstzabwwxjgywi
   npx supabase functions deploy whatsapp-app
   ```
4. No Mesari: **WhatsApp → Testar como cliente**. Escreva como cliente; use "Escrever como:
   Atendente" para responder você mesmo.

> Pedidos confirmados no simulador entram de verdade no Delivery e imprimem.
> No plano grátis do Gemini o Google pode usar os dados para melhorar os modelos: use para teste.
> Com cliente real, ative o faturamento da chave (custa centavos nesse volume).

## Etapa 2 — número real (API oficial da Meta)

1. developers.facebook.com → criar app (tipo Empresa) → adicionar **WhatsApp**. Use o número de
   teste da Meta primeiro.
2. Secrets no Supabase: `WHATSAPP_VERIFY_TOKEN` (texto que você inventa) e
   `WHATSAPP_APP_SECRET` (App → Configurações → Básico → Chave secreta do app).
3. `npx supabase functions deploy whatsapp-webhook --no-verify-jwt`
4. Na Meta → WhatsApp → Configuração → Webhook:
   URL `https://skjsvyvstzabwwxjgywi.supabase.co/functions/v1/whatsapp-webhook`,
   o mesmo verify token, e assine o campo **messages**.
5. Ligue o número ao restaurante (SQL Editor, troque os valores):
   ```sql
   insert into whatsapp_credenciais (restaurante_id, phone_number_id, access_token)
   values (1, 'ID_DO_NUMERO', 'TOKEN_PERMANENTE');
   ```
   Use um token de **usuário do sistema** (o token temporário do painel expira em 24 h).

Custos da Meta (desde 01/10/2026): mensagens do cliente são grátis; cada número tem 1.000 respostas
grátis por mês, depois cobra por mensagem. Para conectar números de vários restaurantes pelo
próprio Mesari (Embedded Signup) é preciso virar Tech Provider da Meta, o que exige empresa
verificada (CNPJ).
