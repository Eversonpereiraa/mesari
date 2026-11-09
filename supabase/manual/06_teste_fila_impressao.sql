-- 06 · TESTE DA FILA DE IMPRESSÃO (não grava nada)
--
-- Para testar ANTES de aplicar: cole no SQL Editor o conteúdo de
-- supabase/migrations/202611080001_fila_impressao.sql e, logo abaixo, este arquivo; rode tudo
-- de uma vez. Depois de aplicada a migration, rode só este arquivo.
--
-- Termina SEMPRE com erro: "TESTE OK ..." quando tudo passou, ou a primeira verificação que
-- falhou. O erro desfaz a transação inteira (pedidos, mesas, fila e, se veio junto, a migration).
-- Único efeito que fica: os contadores (numero) de pedidos_cozinha/pedidos_externos pulam
-- alguns números, porque sequências do Postgres não voltam no rollback.

do $teste$
declare
  v_caixa  uuid;
  v_mesa   uuid;
  v_prod   uuid;
  v_job    jsonb;
  v_a      uuid[];
  v_b      uuid[];
  v_id     uuid;
  v_ped    public.pedidos_externos;
  v_status text;
  v_total  numeric;
  i        int;
begin
  select id into v_caixa from public.profiles where papel = 'caixa' and ativo limit 1;
  assert v_caixa is not null, 'precisa de um usuário caixa ativo';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_caixa, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_caixa::text, true);

  -- Começa com a fila "limpa" para o teste (dentro da transação).
  update public.fila_impressao set status = 'impresso' where status <> 'impresso';
  update public.config_impressao set delivery_imprimir_ao_criar = true, conta_automatica = true;

  select m.id into v_mesa from public.mesas m
   where m.ativa and m.status = 'livre'
     and not exists (select 1 from public.itens_pedido i where i.mesa_id = m.id)
   limit 1;
  assert v_mesa is not null, 'precisa de uma mesa livre';
  select p.id into v_prod from public.produtos p
    left join public.categorias c on c.id = p.categoria_id
   where p.ativo and coalesce(c.setor, 'cozinha') <> 'nenhum' limit 1;
  assert v_prod is not null, 'precisa de um produto ativo de cozinha/bar';

  -- 1. Primeiro pedido (2 itens): mesa livre -> ocupada; comanda "cozinha" com 2 itens.
  perform public.enviar_pedido(v_mesa, jsonb_build_array(
    jsonb_build_object('produto_id', v_prod, 'quantidade', 1),
    jsonb_build_object('produto_id', v_prod, 'quantidade', 2, 'observacao', 'sem sal')), true);
  assert (select status from public.mesas where id = v_mesa) = 'ocupada', '1: mesa não ficou ocupada';
  assert (select count(*) from public.fila_impressao f join public.pedidos_cozinha pc on pc.id = f.pedido_cozinha_id
           where f.status = 'pendente' and f.tipo = 'cozinha' and jsonb_array_length(pc.itens) = 2) = 1,
         '1: esperava 1 comanda "cozinha" com 2 itens';

  -- 2. Adicional de 1 item: comanda "adicional" só com o item novo.
  perform public.enviar_pedido(v_mesa, jsonb_build_array(
    jsonb_build_object('produto_id', v_prod, 'quantidade', 1)), true);
  assert (select count(*) from public.fila_impressao f join public.pedidos_cozinha pc on pc.id = f.pedido_cozinha_id
           where f.status = 'pendente' and f.tipo = 'adicional' and pc.adicional
             and jsonb_array_length(pc.itens) = 1) = 1,
         '2: esperava 1 comanda "adicional" com 1 item';

  -- 3. Duas estações: cada trabalho é reservado por uma só.
  select array_agg((j->>'id')::uuid) into v_a from public.reservar_impressao('Estação A', null, 1) j;
  select array_agg((j->>'id')::uuid) into v_b from public.reservar_impressao('Estação B', null, 10) j;
  assert cardinality(v_a) = 1, '3: estação A deveria reservar 1';
  assert cardinality(v_b) = 1, '3: estação B deveria reservar o outro';
  assert not (v_a && v_b), '3: as duas estações reservaram o mesmo trabalho';
  assert (select count(*) from public.reservar_impressao('Estação C', null, 10)) = 0,
         '3: nada deveria sobrar para a estação C';
  -- A reserva traz a comanda junto.
  select j into v_job from public.reservar_impressao('x', null, 1) j;
  assert v_job is null, '3: reservou de novo um trabalho já reservado';

  -- 4. Falha: volta em 15 s, até 5 tentativas; depois "falhou".
  v_id := v_a[1];
  v_status := public.concluir_impressao(v_id, false, 'Impressora sem papel');
  assert v_status = 'pendente', '4: falha 1 deveria voltar para pendente';
  assert (select count(*) from public.reservar_impressao('A', null, 10)) = 0,
         '4: não deveria tentar de novo antes de 15 s';
  for i in 2..5 loop
    update public.fila_impressao set proxima_tentativa_em = now() where id = v_id;
    assert (select count(*) from public.reservar_impressao('A', null, 10)) = 1, '4: retentativa não reservou';
    v_status := public.concluir_impressao(v_id, false, 'Impressora sem papel');
  end loop;
  assert v_status = 'falhou', '4: depois de 5 tentativas deveria ficar "falhou"';
  assert (select tentativas from public.fila_impressao where id = v_id) = 5, '4: tentativas <> 5';

  -- 5. "Imprimir pendentes" devolve o que falhou; sucesso marca pedidos_cozinha.impresso_em.
  assert public.reenviar_impressao(null) = 1, '5: reenviar_impressao deveria devolver 1';
  select (j->>'id')::uuid into v_id from public.reservar_impressao('A', null, 1) j;
  assert v_id = v_a[1], '5: reenviado não foi reservado';
  assert public.concluir_impressao(v_id, true) = 'impresso', '5: sucesso não marcou impresso';
  assert (select pc.impresso_em is not null from public.fila_impressao f
            join public.pedidos_cozinha pc on pc.id = f.pedido_cozinha_id where f.id = v_id),
         '5: pedidos_cozinha.impresso_em não foi preenchido';
  -- marcar_impresso (tela /cozinha, abas antigas) não imprime de novo o que a fila imprimiu.
  assert public.marcar_impresso((select pedido_cozinha_id from public.fila_impressao where id = v_id)) = false,
         '5: marcar_impresso deveria recusar comanda já impressa pela fila';
  -- Nem a que a fila está imprimindo agora (estação B).
  assert public.marcar_impresso((select pedido_cozinha_id from public.fila_impressao where id = v_b[1])) = false,
         '5: marcar_impresso deveria recusar comanda reservada pela fila';
  perform public.concluir_impressao(v_b[1], true);

  -- 6. Pedir a conta: ocupada -> conta e a conta entra na fila com os 3 lançamentos.
  perform public.solicitar_conta(v_mesa);
  assert (select status from public.mesas where id = v_mesa) = 'conta', '6: mesa não foi para conta';
  assert (select count(*) from public.fila_impressao
           where tipo = 'conta' and mesa_id = v_mesa and jsonb_array_length(dados->'itens') = 3) = 1,
         '6: esperava 1 conta na fila com 3 itens';

  -- 7. Pagamento concluído: conta -> livre.
  select sum(quantidade * valor_unitario) into v_total from public.itens_pedido where mesa_id = v_mesa;
  select v_total + case when r.taxa_servico_ativa then round(v_total * r.taxa_servico_percentual / 100, 2) else 0 end
    into v_total from public.restaurante r limit 1;
  perform public.fechar_conta(v_mesa, jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', v_total)));
  assert (select status from public.mesas where id = v_mesa) = 'livre', '7: mesa não ficou livre';

  -- 8. Delivery (opção ligada): nasce em "preparo" e a comanda entra na fila.
  v_ped := public.criar_pedido_externo(jsonb_build_object(
    'canal', 'whatsapp', 'tipo', 'entrega', 'cliente_nome', 'Teste', 'endereco', 'Rua Teste, 1',
    'pagamento_previsto', jsonb_build_object('forma', 'dinheiro', 'troco_para', 500),
    'itens', jsonb_build_array(jsonb_build_object('produto_id', v_prod, 'quantidade', 1))), true);
  assert v_ped.status = 'preparo', '8: pedido de delivery deveria nascer em preparo';
  assert (select count(*) from public.fila_impressao f join public.pedidos_cozinha pc on pc.id = f.pedido_cozinha_id
           where f.tipo = 'delivery' and pc.pedido_externo_id = v_ped.id
             and (pc.dados->'pagamento_previsto'->>'troco_para')::numeric = 500
             and pc.dados->>'endereco' = 'Rua Teste, 1') = 1,
         '8: esperava 1 comanda de delivery com endereço e troco';

  -- 9. Opção desligada: nasce "novo", sem comanda; imprime ao avançar para "preparo".
  update public.config_impressao set delivery_imprimir_ao_criar = false;
  v_ped := public.criar_pedido_externo(jsonb_build_object(
    'canal', 'telefone', 'tipo', 'retirada', 'cliente_nome', 'Teste 2',
    'itens', jsonb_build_array(jsonb_build_object('produto_id', v_prod, 'quantidade', 1))), true);
  assert v_ped.status = 'novo', '9: com a opção desligada deveria nascer novo';
  assert not exists (select 1 from public.pedidos_cozinha where pedido_externo_id = v_ped.id),
         '9: não deveria ter comanda antes de "preparo"';
  perform public.atualizar_status_pedido_externo(v_ped.id, 'preparo', null, null);
  assert (select count(*) from public.fila_impressao f join public.pedidos_cozinha pc on pc.id = f.pedido_cozinha_id
           where pc.pedido_externo_id = v_ped.id) = 1, '9: comanda não saiu ao avançar para preparo';
  perform public.atualizar_status_pedido_externo(v_ped.id, 'pronto', null, null);
  assert (select count(*) from public.pedidos_cozinha where pedido_externo_id = v_ped.id) = 1,
         '9: avançar de novo não pode duplicar a comanda';

  -- 10. Conta automática desligada: pedir a conta não imprime.
  update public.config_impressao set conta_automatica = false;
  perform public.enviar_pedido(v_mesa, jsonb_build_array(
    jsonb_build_object('produto_id', v_prod, 'quantidade', 1)), true);
  perform public.solicitar_conta(v_mesa);
  assert (select count(*) from public.fila_impressao where tipo = 'conta' and mesa_id = v_mesa) = 1,
         '10: com a opção desligada não deveria enfileirar outra conta';
  -- Reimpressão manual continua funcionando.
  perform public.imprimir_conta(v_mesa);
  assert (select count(*) from public.fila_impressao where tipo = 'conta' and mesa_id = v_mesa) = 2,
         '10: imprimir_conta não enfileirou';

  raise exception 'TESTE OK: todos os 10 cenários passaram (nada foi gravado).';
end
$teste$;
