-- Mercado Pago (Checkout Pro): cada período é uma cobrança (Pix, boleto ou cartão).
alter table public.checkout_pedidos
  add column if not exists gateway text not null default 'asaas',
  add column if not exists mp_preference_id text,
  add column if not exists mp_payment_id text;

-- Renovação paga pelo app ("Pagar renovação").
create table if not exists public.renovacoes (
  id uuid primary key default gen_random_uuid(),
  restaurante_id integer not null references public.restaurante(id) on delete cascade,
  plano_id text not null references public.planos(id),
  ciclo text not null check (ciclo in ('mensal', 'anual')),
  valor numeric(10,2) not null,
  status text not null default 'aguardando' check (status in ('aguardando', 'pago', 'cancelada')),
  mp_preference_id text,
  mp_payment_id text,
  pedido_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_renovacoes_restaurante on public.renovacoes (restaurante_id, criado_em desc);
alter table public.renovacoes enable row level security;
revoke all on public.renovacoes from anon, authenticated;

alter table public.plano_trocas add column if not exists mp_payment_id text;

-- minha_assinatura: pagamento online também vale para o Mercado Pago (sem assinatura recorrente).
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
    'gateway', v_a.gateway,
    'pagamento_online', (
      (v_a.gateway = 'asaas' and v_a.gateway_assinatura_id is not null and v_a.status in ('ativa', 'atrasada'))
      or (v_a.gateway = 'mercadopago' and v_a.status in ('ativa', 'atrasada'))
    ),
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
