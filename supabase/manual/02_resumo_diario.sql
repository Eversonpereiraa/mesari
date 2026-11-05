-- 02 · RESUMO DIÁRIO — uma tabela só: public.resumo_diario (já existe: data, total, contas)
--
-- Só ACRESCENTA colunas (com padrão); nenhuma coluna existente muda de tipo ou de nome.
-- Dia = data em America/Sao_Paulo. Esta parte só lê vendas; não apaga nada.
-- "Por forma" segue resumo_por_forma: soma pagamentos[].valor por forma; venda com
-- pagamentos = [] conta o total como 'nao_informado'.
-- Itens das vendas usam as chaves produto/quantidade/valor_unitario/observacao/garcom.

alter table public.resumo_diario
  add column if not exists ticket_medio numeric not null default 0,
  add column if not exists total_por_forma_pagamento jsonb not null default '{}'::jsonb, -- {"pix": {"total": 10.5, "contas": 2}}
  add column if not exists total_por_origem jsonb not null default '{}'::jsonb,          -- {"mesa": {"total": 80, "quantidade": 3}}
  add column if not exists top_itens jsonb not null default '[]'::jsonb,                 -- [{"nome", "quantidade", "total"}] (top 20)
  add column if not exists atualizado_em timestamptz not null default now();

-- RLS: continua a política existente resumo_caixa_select (select só para is_caixa()).
-- Sem insert/update para o app: só as funções abaixo escrevem.

-- Agrega as vendas de um intervalo. Base única para o resumo e para os relatórios.
create or replace function public.agregar_vendas(p_de timestamptz, p_ate timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with v as (
    select id, total, origem, pagamentos, itens
    from public.vendas
    where fechada_em >= p_de and fechada_em < p_ate
  ),
  pag as (
    select v.id,
           coalesce(p ->> 'forma', 'nao_informado') as forma,
           coalesce((p ->> 'valor')::numeric, v.total) as valor
    from v
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(v.pagamentos) = 'array' and jsonb_array_length(v.pagamentos) > 0
           then v.pagamentos else '[null]'::jsonb end) p
  ),
  itens as (
    select coalesce(i ->> 'produto', i ->> 'produto_nome', i ->> 'name') as nome,
           coalesce((i ->> 'quantidade')::numeric, (i ->> 'qty')::numeric, 0) as qtd,
           coalesce((i ->> 'valor_unitario')::numeric, (i ->> 'price')::numeric, 0) as preco
    from v cross join lateral jsonb_array_elements(
      case when jsonb_typeof(v.itens) = 'array' then v.itens else '[]'::jsonb end) i
  )
  select jsonb_build_object(
    'total', coalesce((select sum(total) from v), 0),
    'contas', (select count(*) from v),
    'por_forma', coalesce((
      select jsonb_object_agg(forma, jsonb_build_object('total', t, 'contas', c))
      from (select forma, sum(valor) t, count(distinct id) c from pag group by forma) x), '{}'::jsonb),
    'por_origem', coalesce((
      select jsonb_object_agg(origem, jsonb_build_object('total', t, 'quantidade', c))
      from (select coalesce(origem, 'mesa') origem, sum(total) t, count(*) c from v group by 1) x), '{}'::jsonb),
    'top_itens', coalesce((
      select jsonb_agg(jsonb_build_object('nome', nome, 'quantidade', q, 'total', t) order by q desc, t desc)
      from (select nome, sum(qtd) q, round(sum(qtd * preco), 2) t
            from itens where nome is not null group by nome order by 2 desc, 3 desc limit 20) x), '[]'::jsonb)
  );
$$;

-- Fecha (ou refaz) o resumo de um dia em resumo_diario. Idempotente.
create or replace function public.fechar_resumo_dia(p_dia date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a jsonb := public.agregar_vendas(
    p_dia::timestamp at time zone 'America/Sao_Paulo',
    (p_dia + 1)::timestamp at time zone 'America/Sao_Paulo');
  v_total numeric := (a ->> 'total')::numeric;
  v_contas integer := (a ->> 'contas')::integer;
begin
  insert into public.resumo_diario as r
    (data, total, contas, ticket_medio, total_por_forma_pagamento, total_por_origem, top_itens, atualizado_em)
  values (p_dia, v_total, v_contas, case when v_contas > 0 then round(v_total / v_contas, 2) else 0 end,
          a -> 'por_forma', a -> 'por_origem', a -> 'top_itens', now())
  on conflict (data) do update set
    total = excluded.total, contas = excluded.contas, ticket_medio = excluded.ticket_medio,
    total_por_forma_pagamento = excluded.total_por_forma_pagamento,
    total_por_origem = excluded.total_por_origem, top_itens = excluded.top_itens,
    atualizado_em = now();
end;
$$;

revoke execute on function public.agregar_vendas(timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.fechar_resumo_dia(date) from public, anon, authenticated;

-- Relatório de período para o app: dias passados vêm de resumo_diario; hoje (ou dia sem
-- resumo) é calculado na hora.
create or replace function public.relatorio_periodo(p_inicio date, p_fim date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  dias jsonb := '[]'::jsonb;
  d date;
  r public.resumo_diario%rowtype;
  a jsonb;
begin
  if not public.is_caixa() then raise exception 'Somente o caixa vê relatórios.'; end if;
  if p_fim < p_inicio or p_fim - p_inicio > 400 then raise exception 'Período inválido (máx. 400 dias).'; end if;

  for d in select generate_series(p_inicio, p_fim, interval '1 day')::date loop
    select * into r from public.resumo_diario where data = d and d < hoje;
    if found then
      a := jsonb_build_object('total', r.total, 'contas', r.contas,
             'por_forma', r.total_por_forma_pagamento, 'por_origem', r.total_por_origem, 'top_itens', r.top_itens);
    else
      a := public.agregar_vendas(d::timestamp at time zone 'America/Sao_Paulo',
                                 (d + 1)::timestamp at time zone 'America/Sao_Paulo');
    end if;
    dias := dias || jsonb_build_array(a);
  end loop;

  return (
    select jsonb_build_object(
      'total', coalesce(sum((x ->> 'total')::numeric), 0),
      'contas', coalesce(sum((x ->> 'contas')::int), 0),
      'por_forma', coalesce((
        select jsonb_object_agg(k, jsonb_build_object('total', t, 'contas', c)) from (
          select f.key k, sum((f.value ->> 'total')::numeric) t, sum((f.value ->> 'contas')::int) c
          from jsonb_array_elements(dias) y, jsonb_each(y -> 'por_forma') f group by f.key) s), '{}'::jsonb),
      'por_origem', coalesce((
        select jsonb_object_agg(k, jsonb_build_object('total', t, 'quantidade', c)) from (
          select o.key k, sum((o.value ->> 'total')::numeric) t, sum((o.value ->> 'quantidade')::int) c
          from jsonb_array_elements(dias) y, jsonb_each(y -> 'por_origem') o group by o.key) s), '{}'::jsonb)
    )
    from jsonb_array_elements(dias) x
  );
end;
$$;

grant execute on function public.relatorio_periodo(date, date) to authenticated;

-- Carga inicial: gera o resumo de todos os dias que já têm venda (até ontem).
do $$
declare d date;
begin
  for d in
    select distinct (fechada_em at time zone 'America/Sao_Paulo')::date from public.vendas
    where (fechada_em at time zone 'America/Sao_Paulo')::date < (now() at time zone 'America/Sao_Paulo')::date
  loop
    perform public.fechar_resumo_dia(d);
  end loop;
end $$;

-- Agendamento diário: ver 05_agendar.sql.


-- ───────────────────────────────────────────────────────────────────────────────
-- limpar_vendas_antigas() — DECISÃO PENDENTE. Não é chamada pelo app nem agendada.
-- Hoje ela grava só total/contas no resumo e apaga vendas com mais de 12 meses.
-- Esta versão mantém exatamente o mesmo corte e a mesma permissão; só troca a conta
-- própria por fechar_resumo_dia, para o resumo guardar também forma, origem e itens.
-- Aplique este bloco só se decidir manter a função (com 12 meses ou outro prazo).

-- create or replace function public.limpar_vendas_antigas()
-- returns void
-- language plpgsql
-- security definer
-- set search_path to 'public'
-- as $function$
-- declare
--   v_corte timestamptz;
--   d date;
-- begin
--   if not public.is_caixa() then
--     raise exception 'Apenas o caixa pode executar a limpeza';
--   end if;
--
--   -- corte sempre no início de um dia (fuso de São Paulo), para não dividir um dia ao meio
--   v_corte := date_trunc('day', (now() at time zone 'America/Sao_Paulo') - interval '12 months')
--              at time zone 'America/Sao_Paulo';
--
--   for d in
--     select distinct (fechada_em at time zone 'America/Sao_Paulo')::date
--     from public.vendas where fechada_em < v_corte
--   loop
--     perform public.fechar_resumo_dia(d);
--   end loop;
--
--   delete from public.vendas where fechada_em < v_corte;
-- end;
-- $function$;
