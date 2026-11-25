-- =============================================================================================
-- WhatsApp com atendente de IA (etapa 1: simulador; etapa 2: número real pela API da Meta)
--
-- whatsapp_conversas   uma conversa por cliente (telefone) e canal, com o status do quadro:
--                      bot (robô atendendo) → humano (precisa do dono) → pedido (lançado) → finalizado
-- whatsapp_mensagens   histórico da conversa (cliente, robô, atendente, sistema)
-- whatsapp_config      liga/desliga o robô e instruções extras do dono (ex.: "não entregamos no Centro")
-- whatsapp_credenciais número da Meta de cada restaurante; só o servidor lê (sem política de acesso)
--
-- Quem grava mensagens é a Edge Function (chave de serviço). O caixa só lê e muda o status.
-- =============================================================================================

create table if not exists public.whatsapp_conversas (
  id              uuid primary key default gen_random_uuid(),
  restaurante_id  integer not null default public.meu_restaurante() references public.restaurante(id) on delete cascade,
  canal           text not null default 'simulador' check (canal in ('simulador', 'whatsapp')),
  telefone        text not null,
  cliente_nome    text,
  status          text not null default 'bot' check (status in ('bot', 'humano', 'pedido', 'finalizado')),
  etapa           text not null default 'coletando' check (etapa in ('coletando', 'confirmando')),
  rascunho        jsonb not null default '{}'::jsonb,
  pedido_id       uuid references public.pedidos_externos(id) on delete set null,
  nao_lidas       integer not null default 0,
  ultima_mensagem text,
  ultima_em       timestamptz not null default now(),
  criado_em       timestamptz not null default now(),
  unique (restaurante_id, canal, telefone)
);

create index if not exists idx_whatsapp_conversas_lista
  on public.whatsapp_conversas (restaurante_id, ultima_em desc);

create table if not exists public.whatsapp_mensagens (
  id              uuid primary key default gen_random_uuid(),
  restaurante_id  integer not null references public.restaurante(id) on delete cascade,
  conversa_id     uuid not null references public.whatsapp_conversas(id) on delete cascade,
  autor           text not null check (autor in ('cliente', 'bot', 'atendente', 'sistema')),
  texto           text not null,
  -- id da mensagem na Meta: evita processar duas vezes quando a Meta reenvia o webhook.
  meta_id         text unique,
  erro_envio      text,
  criado_em       timestamptz not null default now()
);

create index if not exists idx_whatsapp_mensagens_conversa
  on public.whatsapp_mensagens (conversa_id, criado_em);

create table if not exists public.whatsapp_config (
  restaurante_id  integer primary key default public.meu_restaurante() references public.restaurante(id) on delete cascade,
  robo_ativo      boolean not null default true,
  instrucoes      text not null default '' check (length(instrucoes) <= 2000),
  atualizado_em   timestamptz not null default now()
);

create table if not exists public.whatsapp_credenciais (
  restaurante_id  integer primary key references public.restaurante(id) on delete cascade,
  phone_number_id text not null unique,
  access_token    text not null,
  criado_em       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- Acesso: caixa do próprio restaurante lê; muda só status/não lidas da conversa e a configuração.
-- ---------------------------------------------------------------------------------------------
alter table public.whatsapp_conversas enable row level security;
alter table public.whatsapp_mensagens enable row level security;
alter table public.whatsapp_config enable row level security;
alter table public.whatsapp_credenciais enable row level security;

revoke all on public.whatsapp_conversas, public.whatsapp_mensagens, public.whatsapp_config,
              public.whatsapp_credenciais from anon, authenticated;
grant select on public.whatsapp_conversas, public.whatsapp_mensagens, public.whatsapp_config to authenticated;
grant update (status, nao_lidas) on public.whatsapp_conversas to authenticated;
grant insert (robo_ativo, instrucoes), update (robo_ativo, instrucoes, atualizado_em)
  on public.whatsapp_config to authenticated;

drop policy if exists whatsapp_conversas_select on public.whatsapp_conversas;
create policy whatsapp_conversas_select on public.whatsapp_conversas for select to authenticated
  using (restaurante_id = (select public.meu_restaurante()) and public.is_caixa());
drop policy if exists whatsapp_conversas_update on public.whatsapp_conversas;
create policy whatsapp_conversas_update on public.whatsapp_conversas for update to authenticated
  using (restaurante_id = (select public.meu_restaurante()) and public.is_caixa())
  with check (restaurante_id = (select public.meu_restaurante()) and public.is_caixa());

drop policy if exists whatsapp_mensagens_select on public.whatsapp_mensagens;
create policy whatsapp_mensagens_select on public.whatsapp_mensagens for select to authenticated
  using (restaurante_id = (select public.meu_restaurante()) and public.is_caixa());

drop policy if exists whatsapp_config_select on public.whatsapp_config;
create policy whatsapp_config_select on public.whatsapp_config for select to authenticated
  using (restaurante_id = (select public.meu_restaurante()) and public.is_caixa());
drop policy if exists whatsapp_config_insert on public.whatsapp_config;
create policy whatsapp_config_insert on public.whatsapp_config for insert to authenticated
  with check (restaurante_id = (select public.meu_restaurante()) and public.is_caixa());
drop policy if exists whatsapp_config_update on public.whatsapp_config;
create policy whatsapp_config_update on public.whatsapp_config for update to authenticated
  using (restaurante_id = (select public.meu_restaurante()) and public.is_caixa())
  with check (restaurante_id = (select public.meu_restaurante()) and public.is_caixa());
-- whatsapp_credenciais: sem política = só a chave de serviço (Edge Function) acessa.

-- Tempo real para o quadro e o chat.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                 and schemaname = 'public' and tablename = 'whatsapp_conversas') then
    execute 'alter publication supabase_realtime add table public.whatsapp_conversas';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                 and schemaname = 'public' and tablename = 'whatsapp_mensagens') then
    execute 'alter publication supabase_realtime add table public.whatsapp_mensagens';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Lança o pedido confirmado pelo robô usando a MESMA criar_pedido_externo do Delivery
-- (mesma validação, numeração do dia, plano e impressão automática), em nome do dono do
-- restaurante. Só a Edge Function (service_role) chama.
-- ---------------------------------------------------------------------------------------------
create or replace function public.whatsapp_lancar_pedido(p_conversa_id uuid, p_dados jsonb)
returns public.pedidos_externos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversa public.whatsapp_conversas;
  v_usuario  uuid;
  v_pedido   public.pedidos_externos;
begin
  select * into v_conversa from public.whatsapp_conversas where id = p_conversa_id for update;
  if not found then raise exception 'Conversa não encontrada'; end if;
  if v_conversa.pedido_id is not null and v_conversa.status = 'pedido' then
    select * into v_pedido from public.pedidos_externos where id = v_conversa.pedido_id;
    if found then return v_pedido; end if; -- confirmação repetida: não lança duas vezes
  end if;

  -- Dono primeiro; sem dono ativo, qualquer caixa ativo do restaurante.
  select id into v_usuario from public.profiles
   where restaurante_id = v_conversa.restaurante_id and ativo and papel = 'caixa'
   order by dono desc, nome
   limit 1;
  if v_usuario is null then raise exception 'O restaurante não tem usuário de caixa ativo'; end if;

  -- auth.uid() passa a ser o caixa só dentro desta transação.
  perform set_config('request.jwt.claim.sub', v_usuario::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_usuario, 'role', 'authenticated')::text, true);

  v_pedido := public.criar_pedido_externo(p_dados, true);

  update public.whatsapp_conversas
     set pedido_id = v_pedido.id, status = 'pedido', etapa = 'coletando', rascunho = '{}'::jsonb
   where id = p_conversa_id;
  return v_pedido;
end;
$$;

revoke execute on function public.whatsapp_lancar_pedido(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_lancar_pedido(uuid, jsonb) to service_role;
