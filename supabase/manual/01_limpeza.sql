-- 01 · LIMPEZA — uma rotina só: public.limpar_pedidos_cozinha() (já existe no banco)
--
-- Regra atual, mantida: apaga pedidos_cozinha com criado_em há mais de 7 dias,
-- impressos ou não. O app chama ao abrir a tela Mesas do caixa (actions.cleanKitchenOrders).
--
-- Única mudança: a função também passa a aceitar a chamada do próprio banco (pg_cron e
-- SQL Editor, que rodam como "postgres"). Pela API o session_user é sempre "authenticator",
-- então para o app nada muda: só o caixa consegue executar.
-- Assinatura e retorno (void) iguais: o app continua funcionando sem alteração.
--
-- Não toca em vendas, itens_pedido, mesas, produtos nem pedidos_externos.

-- 1) SIMULAÇÃO — rode antes e me mande o resultado (não apaga nada):
-- select count(*) as seriam_apagados,
--        count(*) filter (where impresso_em is null) as dos_quais_nao_impressos,
--        min(criado_em) as mais_antigo
-- from public.pedidos_cozinha
-- where criado_em < now() - interval '7 days';

-- 2) Função (mesma lógica; só a verificação de permissão muda):
create or replace function public.limpar_pedidos_cozinha()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if session_user <> 'postgres' and not public.is_caixa() then
    raise exception 'Apenas o caixa pode executar a limpeza';
  end if;
  delete from public.pedidos_cozinha where criado_em < now() - interval '7 days';
end;
$function$;

-- A versão anterior deste arquivo propunha public.limpeza_diaria(); ela não existe mais no plano.
-- Se por acaso foi aplicada, remova:
drop function if exists public.limpeza_diaria(boolean);

-- Agendamento: ver 05_agendar.sql (comentado até você aprovar a simulação).
