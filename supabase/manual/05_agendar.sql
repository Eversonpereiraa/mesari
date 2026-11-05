-- 05 · AGENDAMENTOS — SÓ RODAR DEPOIS DA SUA CONFIRMAÇÃO
--
-- Passo 0: pg_cron NÃO está habilitado (diagnóstico de 04/11/2026). Habilite uma vez:
--   Dashboard → Database → Extensions → pg_cron → Enable
--   ou no SQL Editor:
create extension if not exists pg_cron with schema pg_catalog;

-- pg_cron usa UTC. Brasília = UTC-3 (sem horário de verão desde 2019).
-- Os jobs rodam como "postgres" (quem agenda pelo SQL Editor), por isso passam na
-- verificação de permissão de 01_limpeza.sql.
-- Agendar com o mesmo nome substitui o job (não duplica). Desligar: select cron.unschedule('<nome>');

-- Resumo diário em resumo_diario — 03:15 Brasília = 06:15 UTC. Não apaga nada.
-- Refaz também anteontem, para pegar venda fechada depois da meia-noite com data do dia anterior.
select cron.schedule('mesari-resumo-diario', '15 6 * * *', $$
  select public.fechar_resumo_dia((now() at time zone 'America/Sao_Paulo')::date - 1);
  select public.fechar_resumo_dia((now() at time zone 'America/Sao_Paulo')::date - 2);
$$);

-- Limpeza da cozinha — 03:30 Brasília = 06:30 UTC. APAGA DADOS (pedidos_cozinha > 7 dias).
-- Só descomente depois de aprovar a simulação de 01_limpeza.sql:
-- select cron.schedule('mesari-limpar-cozinha', '30 6 * * *', $$select public.limpar_pedidos_cozinha()$$);

-- limpar_vendas_antigas() NÃO é agendada (decisão pendente sobre apagar vendas).

-- Conferir os jobs e as últimas execuções:
-- select jobname, schedule, active from cron.job;
-- select jobid, status, return_message, start_time from cron.job_run_details order by start_time desc limit 10;

-- Sem VACUUM FULL agendado: o autovacuum reaproveita o espaço liberado pelos deletes.
