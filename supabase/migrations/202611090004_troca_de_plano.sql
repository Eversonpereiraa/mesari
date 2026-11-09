-- Troca de plano dentro do app.
--   Subir de plano: libera na hora e cobra só a diferença proporcional aos dias que faltam.
--   Descer de plano / trocar mensal↔anual: vale na próxima renovação (fica em plano_proximo).
-- Quem calcula e fala com o Asaas é a Edge Function "trocar-plano" (chave de serviço).

alter table public.assinaturas
  add column if not exists plano_proximo text references public.planos(id),
  add column if not exists ciclo_proximo text check (ciclo_proximo in ('mensal', 'anual'));

create table if not exists public.plano_trocas (
  id uuid primary key default gen_random_uuid(),
  restaurante_id integer not null references public.restaurante(id) on delete cascade,
  de_plano text not null references public.planos(id),
  para_plano text not null references public.planos(id),
  ciclo text not null check (ciclo in ('mensal', 'anual')),
  tipo text not null check (tipo in ('upgrade', 'agendada')),
  valor numeric(10,2) not null default 0,
  asaas_cobranca_id text unique,
  status text not null default 'aguardando' check (status in ('aguardando', 'pago', 'agendada', 'aplicada', 'cancelada')),
  pedido_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_plano_trocas_restaurante on public.plano_trocas (restaurante_id, criado_em desc);

alter table public.plano_trocas enable row level security;
revoke all on public.plano_trocas from anon, authenticated;

-- O que impede descer para p_plano (uso atual acima do limite do plano novo).
create or replace function public.limites_excedidos(p_restaurante integer, p_plano text)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_p public.planos;
  v_n integer;
  v_out text[] := '{}';
begin
  select * into v_p from public.planos where id = p_plano;
  if not found then return array['Plano inválido']; end if;

  if v_p.max_mesas is not null then
    select count(*) into v_n from public.mesas where restaurante_id = p_restaurante and ativa;
    if v_n > v_p.max_mesas then v_out := v_out || format('Você tem %s mesas ativas; o %s permite %s.', v_n, v_p.nome, v_p.max_mesas); end if;
  end if;
  if v_p.max_garcons is not null then
    select count(*) into v_n from public.profiles where restaurante_id = p_restaurante and ativo and papel = 'garcom';
    if v_n > v_p.max_garcons then v_out := v_out || format('Você tem %s garçons ativos; o %s permite %s.', v_n, v_p.nome, v_p.max_garcons); end if;
  end if;
  if v_p.max_caixas is not null then
    select count(*) into v_n from public.profiles where restaurante_id = p_restaurante and ativo and papel = 'caixa';
    if v_n > v_p.max_caixas then v_out := v_out || format('Você tem %s usuários de caixa ativos; o %s permite %s.', v_n, v_p.nome, v_p.max_caixas); end if;
  end if;
  if v_p.max_areas is not null then
    select count(*) into v_n from public.salao_areas where restaurante_id = p_restaurante;
    if v_n > v_p.max_areas then v_out := v_out || format('Você tem %s áreas no salão; o %s permite %s.', v_n, v_p.nome, v_p.max_areas); end if;
  end if;
  return v_out;
end;
$$;
revoke execute on function public.limites_excedidos(integer, text) from public, anon, authenticated;
grant execute on function public.limites_excedidos(integer, text) to service_role;

-- minha_assinatura passa a contar a troca agendada e se dá para trocar pelo app.
create or replace function public.minha_assinatura()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rid integer := public.meu_restaurante();
  v_a public.assinaturas;
  v_p public.planos;
  v_prox public.planos;
  v_troca public.plano_trocas;
begin
  if v_rid is null then raise exception 'Faça login para continuar'; end if;
  select * into v_a from public.assinaturas where restaurante_id = v_rid;
  v_p := public.plano_do_restaurante(v_rid);
  if v_a.plano_proximo is not null then
    select * into v_prox from public.planos where id = v_a.plano_proximo;
  end if;
  select * into v_troca from public.plano_trocas
   where restaurante_id = v_rid and status = 'aguardando' and criado_em > now() - interval '2 days'
   order by criado_em desc limit 1;

  return jsonb_build_object(
    'restaurante_id', v_rid,
    'codigo', (select codigo from public.restaurante where id = v_rid),
    'plano', to_jsonb(v_p),
    'status', coalesce(v_a.status, 'expirada'),
    'ciclo', v_a.ciclo,
    'periodo_fim', v_a.periodo_fim,
    'renovacao_automatica', coalesce(v_a.renovacao_automatica, false),
    'ativa', public.assinatura_ativa(v_rid),
    'pagamento_online', (v_a.gateway = 'asaas' and v_a.gateway_assinatura_id is not null
                         and v_a.status in ('ativa', 'atrasada')),
    'dono', coalesce((select dono from public.profiles where id = auth.uid()), false),
    'plano_proximo', case when v_prox.id is null then null else to_jsonb(v_prox) end,
    'ciclo_proximo', v_a.ciclo_proximo,
    'troca_aguardando', case when v_troca.id is null then null else jsonb_build_object(
        'para_plano', v_troca.para_plano, 'valor', v_troca.valor, 'criado_em', v_troca.criado_em) end,
    'uso', jsonb_build_object(
      'mesas',   (select count(*) from public.mesas where restaurante_id = v_rid and ativa),
      'garcons', (select count(*) from public.profiles where restaurante_id = v_rid and ativo and papel = 'garcom'),
      'caixas',  (select count(*) from public.profiles where restaurante_id = v_rid and ativo and papel = 'caixa'),
      'areas',   (select count(*) from public.salao_areas where restaurante_id = v_rid)
    )
  );
end;
$$;
grant execute on function public.minha_assinatura() to authenticated;
