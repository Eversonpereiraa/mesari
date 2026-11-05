-- 03 · ÍNDICES E REALTIME (conferido com o diagnóstico de 04/11/2026)
--
-- NENHUM índice novo: o banco já tem os que o app usa.
--   vendas            idx_vendas_data (fechada_em) ............... 16 kB, 211 usos  → histórico e relatórios
--   pedidos_cozinha   idx_pedidos_cozinha_pendentes .............. 16 kB, 486 usos  → parcial (setor, criado_em) where impresso_em is null
--   pedidos_externos  idx_pedidos_externos_data (criado_em) ...... 16 kB             → lista do delivery
--   itens_pedido      idx_itens_mesa (mesa_id) ................... 16 kB             → fechar_conta / enviar_pedido por mesa
--   mesas             mesas_area_idx (area_id) ................... 16 kB             → FK de salao_areas (exclusão de área)
--   salao_elementos   salao_elementos_area_idx (area_id) ......... 16 kB             → FK de salao_areas
--   + PKs e UNIQUEs (mesas.numero, profiles.usuario) — nunca removidos.
-- "0 usos" em tabela com menos de 20 linhas é normal: o Postgres prefere ler a tabela inteira.
-- Por isso só tiro o índice que nenhuma consulta do app usa:

-- Ninguém filtra pedidos_externos só por status (a lista é por criado_em). Economia: 16 kB.
drop index if exists public.idx_pedidos_externos_status;


-- AUTOVACUUM — sem ajuste. Todas as tabelas estão abaixo do gatilho padrão (50 + 20% das linhas)
-- e mesas/itens_pedido já tiveram autovacuum. Reavaliar só se alguma passar de milhares de linhas mortas.


-- REALTIME — nada a mudar. A publicação tem exatamente as 7 tabelas que o app escuta:
--   mesas, itens_pedido, vendas, salao_areas, salao_elementos, pedidos_cozinha, pedidos_externos.
-- Os filtros por evento ficam no app (pedidos_cozinha já é só INSERT; vendas passa a ser só INSERT).
