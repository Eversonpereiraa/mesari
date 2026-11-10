-- Anti-abuso do checkout: limite por IP e de tentativas de cartão por pedido.
alter table public.checkout_pedidos
  add column if not exists ip text,
  add column if not exists tentativas_cartao integer not null default 0;
create index if not exists idx_pedidos_ip_criado on public.checkout_pedidos (ip, criado_em desc);

create table if not exists public.checkout_tentativas (
  id bigserial primary key,
  ip text not null,
  tipo text not null,           -- 'criar' | 'cartao' | 'pix' | 'boleto'
  criado_em timestamptz not null default now()
);
create index if not exists idx_tentativas_ip on public.checkout_tentativas (ip, tipo, criado_em desc);
alter table public.checkout_tentativas enable row level security;
revoke all on public.checkout_tentativas from anon, authenticated;
