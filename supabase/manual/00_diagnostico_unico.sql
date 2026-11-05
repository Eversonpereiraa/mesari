-- 00 · DIAGNÓSTICO EM UMA CONSULTA (somente leitura)
-- Mesmo conteúdo do 00_diagnostico.sql (D1–D14), devolvido como um único JSON.
-- Rode tudo de uma vez no SQL Editor e copie o valor da coluna "diagnostico".
--
-- Partes que dependem de tabela/extensão que pode não existir (cron.job, pedidos_externos.status...)
-- rodam por SQL dinâmico (query_to_xml) só quando o objeto existe; senão viram null.
-- O resultado dinâmico volta em base64 para não sofrer com escape de XML, e é decodificado aqui.

select json_build_object(
  'gerado_em', now(),

  -- D1. Tabelas: tamanho e linhas
  'd1_tabelas', (select json_agg(t) from (
    select c.relname as tabela,
           pg_size_pretty(pg_total_relation_size(c.oid)) as total,
           pg_size_pretty(pg_relation_size(c.oid))       as dados,
           pg_size_pretty(pg_indexes_size(c.oid))        as indices,
           pg_total_relation_size(c.oid)                 as total_bytes,
           c.reltuples::bigint                           as linhas_aprox
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by pg_total_relation_size(c.oid) desc) t),
  'd1_banco', pg_size_pretty(pg_database_size(current_database())),

  -- D2. Colunas de todas as tabelas
  'd2_colunas', (select json_agg(t) from (
    select table_name, column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public'
    order by table_name, ordinal_position) t),

  -- D3. pg_cron / pg_net e jobs existentes
  'd3_extensoes', (select json_agg(t) from (
    select extname, extversion from pg_extension where extname in ('pg_cron', 'pg_net')) t),
  'd3_cron_jobs', case when to_regclass('cron.job') is not null then
    convert_from(decode((xpath('/row/j/text()', query_to_xml($q$
      select encode(convert_to(coalesce(json_agg(t)::text, '[]'), 'UTF8'), 'base64') as j
      from (select jobid, jobname, schedule, command, active from cron.job) t
    $q$, false, true, '')))[1]::text, 'base64'), 'UTF8')::json end,

  -- D4. Tabelas no Realtime
  'd4_realtime', (select json_agg(t) from (
    select schemaname, tablename from pg_publication_tables
    where pubname = 'supabase_realtime' order by 1, 2) t),

  -- D5. Índices: tamanho, uso, PK/UNIQUE + desde quando as estatísticas contam
  'd5_indices', (select json_agg(t) from (
    select s.relname as tabela, s.indexrelname as indice,
           pg_size_pretty(pg_relation_size(s.indexrelid)) as tamanho,
           s.idx_scan as usos, i.indisprimary as pk, i.indisunique as unico,
           pg_get_indexdef(s.indexrelid) as definicao
    from pg_stat_user_indexes s join pg_index i on i.indexrelid = s.indexrelid
    where s.schemaname = 'public'
    order by s.relname, s.indexrelname) t),
  'd5_stats_reset', (select stats_reset from pg_stat_database where datname = current_database()),

  -- D6. Colunas com imagem/base64/conteúdo gigante (só as que têm ocorrência)
  'd6_colunas_suspeitas', (select json_agg(t) from (
    select * from (
      select c.table_name, c.column_name,
             (xpath('/row/n/text()', query_to_xml(format(
               'select count(*) as n from public.%I where %I::text like ''data:%%'' or length(%I::text) > 20000',
               c.table_name, c.column_name, c.column_name), false, true, '')))[1]::text::int as suspeitos
      from information_schema.columns c
      join information_schema.tables tb
        on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
      where c.table_schema = 'public' and c.data_type in ('text', 'character varying', 'jsonb', 'json', 'bytea')
    ) s where suspeitos > 0 order by suspeitos desc) t),
  'd6_logo', case when exists (select 1 from information_schema.columns
                               where table_schema = 'public' and table_name = 'restaurante' and column_name = 'logo_url') then
    convert_from(decode((xpath('/row/j/text()', query_to_xml($q$
      select encode(convert_to(coalesce(json_agg(t)::text, '[]'), 'UTF8'), 'base64') as j
      from (select length(logo_url) as tamanho_logo, left(logo_url, 40) as inicio from public.restaurante) t
    $q$, false, true, '')))[1]::text, 'base64'), 'UTF8')::json end,

  -- D7. Status existentes
  'd7_pedidos_externos_status', case when exists (select 1 from information_schema.columns
                               where table_schema = 'public' and table_name = 'pedidos_externos' and column_name = 'status') then
    convert_from(decode((xpath('/row/j/text()', query_to_xml($q$
      select encode(convert_to(coalesce(json_agg(t)::text, '[]'), 'UTF8'), 'base64') as j
      from (select status, count(*) as qtd, min(criado_em) as primeiro, max(criado_em) as ultimo
            from public.pedidos_externos group by status) t
    $q$, false, true, '')))[1]::text, 'base64'), 'UTF8')::json end,
  'd7_pedidos_cozinha', case when to_regclass('public.pedidos_cozinha') is not null then
    convert_from(decode((xpath('/row/j/text()', query_to_xml($q$
      select encode(convert_to(coalesce(json_agg(t)::text, '[]'), 'UTF8'), 'base64') as j
      from (select (impresso_em is not null) as impresso,
                   count(*) filter (where criado_em < now() - interval '7 days') as mais_de_7_dias,
                   count(*) as total
            from public.pedidos_cozinha group by 1) t
    $q$, false, true, '')))[1]::text, 'base64'), 'UTF8')::json end,

  -- D8. Definição das funções que o resumo/limpeza precisam imitar
  'd8_funcoes', (select json_agg(t) from (
    select p.proname, pg_get_functiondef(p.oid) as definicao
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and p.proname in ('resumo_por_forma', 'fechar_conta', 'limpar_pedidos_cozinha', 'is_caixa',
                        'usuario_caixa', 'concluir_pedido_externo', 'enviar_pedido')) t),

  -- D9. Formato real de pagamentos/itens nas vendas
  'd9_vendas_exemplo', case when to_regclass('public.vendas') is not null then
    convert_from(decode((xpath('/row/j/text()', query_to_xml($q$
      select encode(convert_to(coalesce(json_agg(t)::text, '[]'), 'UTF8'), 'base64') as j
      from (select numero, origem, total, pagamentos, itens -> 0 as primeiro_item
            from public.vendas order by fechada_em desc limit 3) t
    $q$, false, true, '')))[1]::text, 'base64'), 'UTF8')::json end,

  -- D10. Chaves estrangeiras que apontam para tabelas que vamos limpar/arquivar
  'd10_fks', (select json_agg(t) from (
    select conrelid::regclass::text as tabela, conname, confrelid::regclass::text as referencia,
           pg_get_constraintdef(oid) as definicao
    from pg_constraint
    where contype = 'f'
      and confrelid in (to_regclass('public.pedidos_cozinha'), to_regclass('public.pedidos_externos'),
                        to_regclass('public.vendas'))) t),

  -- D11. Buckets do Storage
  'd11_buckets', case when to_regclass('storage.buckets') is not null then
    convert_from(decode((xpath('/row/j/text()', query_to_xml($q$
      select encode(convert_to(coalesce(json_agg(t)::text, '[]'), 'UTF8'), 'base64') as j
      from (select id, public from storage.buckets) t
    $q$, false, true, '')))[1]::text, 'base64'), 'UTF8')::json end,

  -- D12. Volume real por dia (últimos 30 dias)
  'd12_volume', json_build_object(
    'vendas', case when to_regclass('public.vendas') is not null then
      convert_from(decode((xpath('/row/j/text()', query_to_xml($q$
        select encode(convert_to(coalesce(json_agg(t)::text, '[]'), 'UTF8'), 'base64') as j
        from (select round(count(*) / 30.0, 1) as linhas_dia,
                     avg(pg_column_size(v.*))::bigint as linha_media_bytes,
                     avg(pg_column_size(v.itens))::bigint as itens_jsonb_medio_bytes,
                     round(avg(case when jsonb_typeof(v.itens::jsonb) = 'array'
                                    then jsonb_array_length(v.itens::jsonb) end), 1) as itens_por_venda
              from public.vendas v where fechada_em > now() - interval '30 days') t
      $q$, false, true, '')))[1]::text, 'base64'), 'UTF8')::json end,
    'pedidos_cozinha', case when to_regclass('public.pedidos_cozinha') is not null then
      convert_from(decode((xpath('/row/j/text()', query_to_xml($q$
        select encode(convert_to(coalesce(json_agg(t)::text, '[]'), 'UTF8'), 'base64') as j
        from (select round(count(*) / 30.0, 1) as linhas_dia, avg(pg_column_size(p.*))::bigint as linha_media_bytes
              from public.pedidos_cozinha p where criado_em > now() - interval '30 days') t
      $q$, false, true, '')))[1]::text, 'base64'), 'UTF8')::json end,
    'pedidos_externos', case when to_regclass('public.pedidos_externos') is not null then
      convert_from(decode((xpath('/row/j/text()', query_to_xml($q$
        select encode(convert_to(coalesce(json_agg(t)::text, '[]'), 'UTF8'), 'base64') as j
        from (select round(count(*) / 30.0, 1) as linhas_dia, avg(pg_column_size(e.*))::bigint as linha_media_bytes
              from public.pedidos_externos e where criado_em > now() - interval '30 days') t
      $q$, false, true, '')))[1]::text, 'base64'), 'UTF8')::json end
  ),

  -- D13. Autovacuum: tuplas mortas e última passada
  'd13_autovacuum', (select json_agg(t) from (
    select relname, n_live_tup, n_dead_tup, last_autovacuum, last_autoanalyze, autovacuum_count
    from pg_stat_user_tables where schemaname = 'public' order by n_dead_tup desc) t),

  -- D14. Tipos de coluna (só para ver o impacto; nada é convertido)
  'd14_tipos', (select json_agg(t) from (
    select table_name, column_name, data_type
    from information_schema.columns
    where table_schema = 'public'
      and (data_type in ('integer', 'bigint', 'numeric', 'double precision', 'real')
           or (data_type in ('text', 'character varying') and column_name ~ '(_em|data|hora)$'))
    order by table_name, column_name) t)
) as diagnostico;
