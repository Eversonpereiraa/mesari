-- Anônimo não chama nenhuma função do app; funções de gatilho e auxiliares internas não são RPC.
do $$
declare
  f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.proname like '\_%' or f.proname in ('handle_new_user', 'itens_after_delete', 'itens_after_insert',
         'itens_before_insert', 'reabrir_conta_com_item_novo', 'limpar_nota_ao_liberar',
         'bloquear_exclusao_area_com_mesas', 'bloquear_exclusao_mesa_ocupada', 'rls_auto_enable',
         'plano_do_restaurante', 'exigir_assinatura', 'gerar_codigo_restaurante', 'admin_tamanho_banco') then
      execute format('revoke execute on function %s from authenticated', f.sig);
    else
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

-- Funções criadas daqui para frente não ficam abertas ao anônimo por padrão.
alter default privileges in schema public revoke execute on functions from public, anon;

alter function public._validar_pagamentos(jsonb, numeric) set search_path = public;
