-- Checkout pela landing (Asaas). Só as Edge Functions (chave de serviço) leem e escrevem aqui.
-- Já aplicada no Supabase em 09/11/2026 (versão 20261109023322); este arquivo é o registro no repositório.
create table if not exists public.checkout_pedidos (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  nome text not null,
  telefone text,
  restaurante_nome text,
  restaurante_codigo text,           -- veio do app ("Meu plano"): restaurante que já existe
  plano_id text not null references public.planos(id),
  ciclo text not null check (ciclo in ('mensal', 'anual')),
  valor numeric(10,2) not null,
  restaurante_id integer references public.restaurante(id) on delete set null,
  asaas_cliente_id text,
  asaas_assinatura_id text unique,
  status text not null default 'aguardando' check (status in ('aguardando', 'pago', 'cancelado')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_checkout_pedidos_email on public.checkout_pedidos (lower(email));

create table if not exists public.webhook_eventos (
  id text primary key,
  evento text not null,
  recebido_em timestamptz not null default now()
);

alter table public.checkout_pedidos enable row level security;
alter table public.webhook_eventos enable row level security;
revoke all on public.checkout_pedidos, public.webhook_eventos from anon, authenticated;

-- Restaurante de um e-mail que já tem conta (dono que fez o teste grátis e agora assina).
create or replace function public.restaurante_por_email(p_email text)
returns integer
language sql
stable
security definer
set search_path = public, auth
as $$
  select p.restaurante_id
    from auth.users u join public.profiles p on p.id = u.id
   where lower(u.email) = lower(trim(p_email)) and p.ativo
   order by p.dono desc
   limit 1;
$$;

revoke execute on function public.restaurante_por_email(text) from public, anon, authenticated;
grant execute on function public.restaurante_por_email(text) to service_role;
