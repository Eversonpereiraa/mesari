-- 00 · DIAGNÓSTICO (somente leitura — não altera nada)
-- Rode cada bloco no SQL Editor do projeto skjsvyvstzabwwxjgywi e me mande os resultados.
-- Os SQLs 01–06 têm pontos marcados com "CONFIRMAR" que dependem destas respostas.

-- D1. Tabelas: tamanho e linhas
select c.relname as tabela,
       pg_size_pretty(pg_total_relation_size(c.oid)) as total,
       pg_size_pretty(pg_relation_size(c.oid))       as dados,
       pg_size_pretty(pg_indexes_size(c.oid))        as indices,
       c.reltuples::bigint                           as linhas_aprox
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc;

-- D2. Colunas de todas as tabelas (o schema real difere das migrations do repositório)
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;

-- D3. pg_cron instalado? Jobs existentes?
select extname, extversion from pg_extension where extname in ('pg_cron', 'pg_net');
-- (só rode a linha abaixo se pg_cron aparecer acima)
-- select jobid, jobname, schedule, command, active from cron.job;

-- D4. Tabelas no Realtime
select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1, 2;

-- D5. Índices: tamanho, uso e se são PK/UNIQUE
select s.relname as tabela, s.indexrelname as indice,
       pg_size_pretty(pg_relation_size(s.indexrelid)) as tamanho,
       s.idx_scan as usos,
       i.indisprimary as pk, i.indisunique as unico,
       pg_get_indexdef(s.indexrelid) as definicao
from pg_stat_user_indexes s join pg_index i on i.indexrelid = s.indexrelid
where s.schemaname = 'public'
order by s.relname, s.indexrelname;
-- Desde quando as estatísticas valem (idx_scan = 0 só significa algo se for um período longo)
select stats_reset from pg_stat_database where datname = current_database();

-- D6. Colunas com imagem/base64/conteúdo gigante (varre todas as colunas texto/jsonb/bytea)
select table_name, column_name,
       (xpath('/row/n/text()', query_to_xml(format(
         'select count(*) as n from public.%I where %I::text like ''data:%%'' or length(%I::text) > 20000',
         table_name, column_name, column_name), false, true, '')))[1]::text::int as suspeitos
from information_schema.columns
where table_schema = 'public' and data_type in ('text', 'character varying', 'jsonb', 'json', 'bytea')
order by suspeitos desc;
select length(logo_url) as tamanho_logo, left(logo_url, 40) as inicio from public.restaurante;

-- D7. Status existentes (para saber o que é "cancelado/nunca enviado")
select status, count(*), min(criado_em), max(criado_em) from public.pedidos_externos group by status;
select (impresso_em is not null) as impresso,
       count(*) filter (where criado_em < now() - interval '7 days') as mais_de_7_dias,
       count(*) as total
from public.pedidos_cozinha group by 1;

-- D8. Definição das funções que o resumo precisa imitar
select p.proname, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('resumo_por_forma', 'fechar_conta', 'limpar_pedidos_cozinha', 'is_caixa', 'usuario_caixa', 'concluir_pedido_externo');

-- D9. Formato real de pagamentos/itens nas vendas
select numero, origem, total, pagamentos, itens -> 0 as primeiro_item
from public.vendas order by fechada_em desc limit 3;

-- D10. Chaves estrangeiras que apontam para tabelas que vamos limpar/arquivar
select conrelid::regclass as tabela, conname, confrelid::regclass as referencia, pg_get_constraintdef(oid)
from pg_constraint
where contype = 'f' and confrelid in ('public.pedidos_cozinha'::regclass, 'public.pedidos_externos'::regclass, 'public.vendas'::regclass);

-- D11. Buckets do Storage
select id, public from storage.buckets;

-- D12. Volume real por dia (últimos 30 dias) — base da estimativa de MB/dia
select 'vendas' as tabela, count(*) / 30.0 as linhas_dia,
       pg_size_pretty(avg(pg_column_size(v.*))::bigint) as linha_media,
       pg_size_pretty(avg(pg_column_size(v.itens))::bigint) as itens_jsonb_medio,
       round(avg(jsonb_array_length(v.itens)), 1) as itens_por_venda
from public.vendas v where fechada_em > now() - interval '30 days'
union all
select 'pedidos_cozinha', count(*) / 30.0, pg_size_pretty(avg(pg_column_size(p.*))::bigint), null, null
from public.pedidos_cozinha p where criado_em > now() - interval '30 days'
union all
select 'pedidos_externos', count(*) / 30.0, pg_size_pretty(avg(pg_column_size(e.*))::bigint), null, null
from public.pedidos_externos e where criado_em > now() - interval '30 days';

-- D13. Autovacuum: tuplas mortas e última passada (tabelas com muito insert/delete)
select relname, n_live_tup, n_dead_tup, last_autovacuum, last_autoanalyze, autovacuum_count
from pg_stat_user_tables where schemaname = 'public' order by n_dead_tup desc;

-- D14. Tipos de coluna candidatos a enxugar (só para ver o impacto, nada é convertido)
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and (data_type in ('integer', 'bigint', 'numeric', 'double precision', 'real')
       or (data_type in ('text', 'character varying') and column_name ~ '(_em|data|hora)$'))
order by table_name, column_name;
