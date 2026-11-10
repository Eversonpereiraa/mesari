-- Ciclo trimestral (com desconto) e assinatura recorrente no cartão (Mercado Pago preapproval).
alter table public.planos add column if not exists preco_trimestral numeric(10,2);
update public.planos set preco_trimestral = case id
  when 'essencial' then 107.70
  when 'profissional' then 215.70
  when 'completo' then 350.70
  else round(preco_mensal * 3 * 0.9, 2) end
where preco_trimestral is null;
alter table public.planos alter column preco_trimestral set not null;

alter table public.assinaturas drop constraint if exists assinaturas_ciclo_check;
alter table public.assinaturas add constraint assinaturas_ciclo_check check (ciclo in ('mensal', 'trimestral', 'anual'));
alter table public.assinaturas drop constraint if exists assinaturas_ciclo_proximo_check;
alter table public.assinaturas add constraint assinaturas_ciclo_proximo_check check (ciclo_proximo in ('mensal', 'trimestral', 'anual'));
alter table public.plano_trocas drop constraint if exists plano_trocas_ciclo_check;
alter table public.plano_trocas add constraint plano_trocas_ciclo_check check (ciclo in ('mensal', 'trimestral', 'anual'));
alter table public.checkout_pedidos drop constraint if exists checkout_pedidos_ciclo_check;
alter table public.checkout_pedidos add constraint checkout_pedidos_ciclo_check check (ciclo in ('mensal', 'trimestral', 'anual'));
alter table public.renovacoes drop constraint if exists renovacoes_ciclo_check;
alter table public.renovacoes add constraint renovacoes_ciclo_check check (ciclo in ('mensal', 'trimestral', 'anual'));

-- Assinatura recorrente no cartão: id da preapproval no Mercado Pago.
alter table public.checkout_pedidos
  add column if not exists mp_preapproval_id text,
  add column if not exists metodo text;
alter table public.assinaturas add column if not exists mp_preapproval_id text;
create index if not exists idx_pedidos_preapproval on public.checkout_pedidos (mp_preapproval_id);
create index if not exists idx_assinaturas_preapproval on public.assinaturas (mp_preapproval_id);

-- Cartão recusado na primeira cobrança da assinatura.
alter table public.checkout_pedidos drop constraint if exists checkout_pedidos_status_check;
alter table public.checkout_pedidos add constraint checkout_pedidos_status_check check (status in ('aguardando', 'pago', 'cancelado', 'recusado'));
alter table public.checkout_pedidos add column if not exists motivo_recusa text;
alter table public.checkout_pedidos add column if not exists cpf_cnpj text;
