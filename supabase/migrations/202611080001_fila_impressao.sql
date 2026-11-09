-- Fila de impressão automática (cozinha, adicional, delivery e conta).
--
-- Toda impressão vira uma linha em public.fila_impressao. A estação de impressão do caixa
-- (app desktop ou navegador com impressora direta) reserva os trabalhos com
-- reservar_impressao() — select ... for update skip locked — e devolve o resultado com
-- concluir_impressao(). Duas estações abertas nunca imprimem o mesmo trabalho.
--
-- Compatível com o que já existe:
--   * pedidos_cozinha continua recebendo as comandas (enviar_pedido não muda). Um gatilho
--     cria os trabalhos da fila a partir de cada comanda nova.
--   * marcar_impresso() continua funcionando para a tela /cozinha e para abas antigas: quem
--     marcar primeiro imprime; o trabalho correspondente na fila sai como impresso.
--   * Quando a fila imprime, pedidos_cozinha.impresso_em também é preenchido.
--
-- Só adiciona/substitui funções. Não altera migrations antigas e não apaga dados existentes.
-- Substitui (create or replace, mesma assinatura): criar_pedido_externo, marcar_impresso,
-- limpar_pedidos_cozinha.

-- ---------------------------------------------------------------------------------------------
-- 1. Configuração compartilhada (vale para todas as estações)
-- ---------------------------------------------------------------------------------------------
create table if not exists public.config_impressao (
  id integer primary key default 1 check (id = 1),
  -- Ao criar pedido de delivery: imprimir e mover para "preparo" automaticamente.
  delivery_imprimir_ao_criar boolean not null default true,
  -- Quando a mesa vai para "conta": imprimir a conta da mesa automaticamente.
  conta_automatica boolean not null default true,
  atualizado_em timestamptz not null default now()
);

insert into public.config_impressao (id) values (1) on conflict (id) do nothing;

alter table public.config_impressao enable row level security;
drop policy if exists config_impressao_select on public.config_impressao;
create policy config_impressao_select on public.config_impressao
  for select to authenticated using (true);
drop policy if exists config_impressao_caixa_update on public.config_impressao;
create policy config_impressao_caixa_update on public.config_impressao
  for update to authenticated using (public.is_caixa()) with check (public.is_caixa());
grant select, update on public.config_impressao to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Fila
-- ---------------------------------------------------------------------------------------------
create table if not exists public.fila_impressao (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('cozinha', 'adicional', 'delivery', 'conta')),
  status text not null default 'pendente'
    check (status in ('pendente', 'imprimindo', 'impresso', 'falhou')),
  tentativas integer not null default 0,
  erro text,
  pedido_cozinha_id uuid references public.pedidos_cozinha(id) on delete cascade,
  pedido_externo_id uuid references public.pedidos_externos(id) on delete set null,
  mesa_id uuid references public.mesas(id) on delete set null,
  -- Conta: cópia dos itens da mesa no momento em que a conta foi pedida.
  dados jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  -- Desde quando o trabalho está liberado para impressão automática (volta a now() ao reenviar).
  -- Só o que foi liberado nas últimas 3 horas imprime sozinho.
  liberado_em timestamptz not null default now(),
  proxima_tentativa_em timestamptz not null default now(),
  reservado_em timestamptz,
  reservado_por uuid references public.profiles(id) on delete set null,
  estacao text,
  impresso_em timestamptz
);

create index if not exists idx_fila_impressao_aguardando
  on public.fila_impressao (proxima_tentativa_em)
  where status in ('pendente', 'imprimindo');
create index if not exists idx_fila_impressao_criado on public.fila_impressao (criado_em);
create index if not exists idx_fila_impressao_comanda on public.fila_impressao (pedido_cozinha_id);

alter table public.fila_impressao enable row level security;
drop policy if exists fila_impressao_caixa_select on public.fila_impressao;
create policy fila_impressao_caixa_select on public.fila_impressao
  for select to authenticated using (public.is_caixa());
-- Escrita só pelas funções abaixo (security definer).
revoke insert, update, delete on public.fila_impressao from anon, authenticated;
grant select on public.fila_impressao to authenticated;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fila_impressao'
  ) then
    execute 'alter publication supabase_realtime add table public.fila_impressao';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. Comandas de pedidos_cozinha entram na fila
--    Mesa: "cozinha" (primeiro envio) ou "adicional" (mesa já tinha itens: só os itens novos,
--    porque enviar_pedido grava em cada comanda apenas os itens daquele envio).
--    Delivery/retirada: "delivery" — um trabalho que imprime a comanda da cozinha e, junto, a
--    comanda de delivery (endereço e troco, para o entregador).
-- ---------------------------------------------------------------------------------------------
create or replace function public._fila_comanda_nova()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.impresso_em is not null then
    return new;
  end if;
  insert into public.fila_impressao (tipo, pedido_cozinha_id, pedido_externo_id)
  values (
    case
      when new.origem <> 'mesa' then 'delivery'
      when new.adicional then 'adicional'
      else 'cozinha'
    end,
    new.id,
    new.pedido_externo_id
  );
  return new;
end;
$$;

drop trigger if exists pedidos_cozinha_fila on public.pedidos_cozinha;
create trigger pedidos_cozinha_fila
  after insert on public.pedidos_cozinha
  for each row execute procedure public._fila_comanda_nova();

-- ---------------------------------------------------------------------------------------------
-- 4. Conta da mesa
-- ---------------------------------------------------------------------------------------------
create or replace function public._enfileirar_conta(p_mesa_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.fila_impressao (tipo, mesa_id, dados)
  select 'conta', m.id, jsonb_build_object(
    'mesa_numero', m.numero,
    'itens', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id,
        'produto', i.produto_nome,
        'quantidade', i.quantidade,
        'valor_unitario', i.valor_unitario,
        'observacao', coalesce(i.observacao, ''),
        'garcom', coalesce(i.garcom_nome, '')
      ) order by i.criado_em), '[]'::jsonb)
      from public.itens_pedido i where i.mesa_id = m.id
    )
  )
  from public.mesas m
  where m.id = p_mesa_id
    and exists (select 1 from public.itens_pedido i where i.mesa_id = m.id)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public._enfileirar_conta(uuid) from public, anon, authenticated;

-- Mesa entrou em "conta" (garçom ou caixa pediu a conta): imprime a conta, se configurado.
create or replace function public._fila_conta_solicitada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'conta' and old.status is distinct from 'conta'
     and coalesce((select conta_automatica from public.config_impressao where id = 1), true) then
    perform public._enfileirar_conta(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists mesas_fila_conta on public.mesas;
create trigger mesas_fila_conta
  after update of status on public.mesas
  for each row execute procedure public._fila_conta_solicitada();

-- Reimpressão manual da conta (botão "Reimprimir nota"): manda de novo para a estação.
create or replace function public.imprimir_conta(p_mesa_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Faça login para continuar';
  end if;
  v_id := public._enfileirar_conta(p_mesa_id);
  if v_id is null then
    raise exception 'A mesa não tem itens para imprimir a conta';
  end if;
  return v_id;
end;
$$;

grant execute on function public.imprimir_conta(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. Delivery: comanda nasce com o pedido (e o pedido já nasce em "preparo")
-- ---------------------------------------------------------------------------------------------
create or replace function public._comanda_pedido_externo(p_pedido public.pedidos_externos)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.pedidos_cozinha where pedido_externo_id = p_pedido.id) then
    return;
  end if;
  insert into public.pedidos_cozinha
    (mesa_numero, setor, garcom_nome, adicional, itens, origem, pedido_externo_id, dados)
  values (
    null, 'cozinha', p_pedido.criado_por_nome, false, p_pedido.itens, p_pedido.tipo, p_pedido.id,
    jsonb_strip_nulls(jsonb_build_object(
      'numero_dia', p_pedido.numero_dia,
      'canal', p_pedido.canal,
      'tipo', p_pedido.tipo,
      'cliente_nome', p_pedido.cliente_nome,
      'telefone', p_pedido.telefone,
      'endereco', p_pedido.endereco,
      'bairro', p_pedido.bairro,
      'referencia', p_pedido.referencia,
      'observacao', p_pedido.observacao,
      'subtotal', p_pedido.subtotal,
      'taxa_entrega', p_pedido.taxa_entrega,
      'desconto', p_pedido.desconto,
      'total', p_pedido.total,
      'pagamento_previsto', p_pedido.pagamento_previsto
    ))
  );
end;
$$;

revoke execute on function public._comanda_pedido_externo(public.pedidos_externos)
  from public, anon, authenticated;

-- Configuração desligada: o pedido nasce "novo" e a comanda sai ao avançar para "preparo".
create or replace function public._fila_pedido_externo_preparo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'preparo' and old.status = 'novo' then
    perform public._comanda_pedido_externo(new);
  end if;
  return new;
end;
$$;

drop trigger if exists pedidos_externos_fila_preparo on public.pedidos_externos;
create trigger pedidos_externos_fila_preparo
  after update of status on public.pedidos_externos
  for each row execute procedure public._fila_pedido_externo_preparo();

-- Mesmo corpo da versão atual; muda só o final: status inicial conforme a configuração e a
-- comanda gerada por _comanda_pedido_externo (que vai para a fila pelo gatilho da seção 3).
create or replace function public.criar_pedido_externo(p_dados jsonb, p_imprimir boolean default true)
returns public.pedidos_externos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_canal  text := lower(coalesce(nullif(trim(p_dados->>'canal'), ''), 'whatsapp'));
  v_tipo   text := lower(coalesce(nullif(trim(p_dados->>'tipo'), ''), 'entrega'));
  v_nome   text := nullif(trim(coalesce(p_dados->>'cliente_nome', '')), '');
  v_tel    text := nullif(regexp_replace(coalesce(p_dados->>'telefone', ''), '\D', '', 'g'), '');
  v_end    text := nullif(trim(coalesce(p_dados->>'endereco', '')), '');
  v_bairro text := nullif(trim(coalesce(p_dados->>'bairro', '')), '');
  v_ref    text := nullif(trim(coalesce(p_dados->>'referencia', '')), '');
  v_obs    text := nullif(trim(coalesce(p_dados->>'observacao', '')), '');
  v_it     jsonb;
  v_prod   record;
  v_qtd    int;
  v_iobs   text;
  v_nomeit text;
  v_valor  numeric(10,2);
  v_itens  jsonb := '[]'::jsonb;
  v_sub    numeric(10,2) := 0;
  v_taxa   numeric(10,2) := 0;
  v_desc   numeric(10,2) := 0;
  v_total  numeric(10,2);
  v_pp     jsonb := null;
  v_forma  text;
  v_troco  numeric(10,2);
  v_pago   boolean;
  v_usuario text;
  v_dia    int;
  v_auto   boolean;
  v_pedido public.pedidos_externos;
begin
  if not public.is_caixa() then
    raise exception 'Apenas o caixa pode lançar pedidos de delivery';
  end if;
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then
    raise exception 'Dados do pedido inválidos';
  end if;
  if v_canal not in ('whatsapp', 'telefone', 'papel', 'app', 'balcao', 'outro') then
    raise exception 'Canal inválido';
  end if;
  if v_tipo not in ('entrega', 'retirada', 'balcao') then
    raise exception 'Tipo de pedido inválido';
  end if;
  if v_tel is not null and length(v_tel) not between 10 and 13 then
    raise exception 'Telefone inválido: use DDD + número';
  end if;
  if v_tipo = 'entrega' and v_end is null then
    raise exception 'Informe o endereço de entrega';
  end if;
  if v_tipo = 'entrega' and v_nome is null then
    raise exception 'Informe o nome do cliente';
  end if;
  if v_tipo = 'retirada' and v_nome is null then
    raise exception 'Informe o nome de quem vai retirar';
  end if;

  -- itens
  if jsonb_typeof(p_dados->'itens') is distinct from 'array'
     or jsonb_array_length(p_dados->'itens') = 0 then
    raise exception 'Adicione pelo menos um item';
  end if;
  if jsonb_array_length(p_dados->'itens') > 60 then
    raise exception 'Muitos itens em um só pedido (máximo 60 linhas)';
  end if;

  for v_it in select * from jsonb_array_elements(p_dados->'itens') loop
    v_qtd := (v_it->>'quantidade')::int;
    if v_qtd is null or v_qtd < 1 or v_qtd > 99 then
      raise exception 'Quantidade inválida (use de 1 a 99)';
    end if;
    v_iobs := nullif(trim(coalesce(v_it->>'observacao', '')), '');

    if nullif(v_it->>'produto_id', '') is not null then
      select p.id, p.nome, p.preco into v_prod
      from public.produtos p
      where p.id = (v_it->>'produto_id')::uuid and p.ativo;
      if not found then
        raise exception 'Produto não encontrado ou inativo';
      end if;
      v_nomeit := v_prod.nome;
      v_valor  := v_prod.preco;
      v_itens := v_itens || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'produto_id', v_prod.id, 'produto', v_nomeit, 'quantidade', v_qtd,
        'valor_unitario', v_valor, 'observacao', v_iobs, 'avulso', false)));
    else
      v_nomeit := nullif(trim(coalesce(v_it->>'nome', '')), '');
      if v_nomeit is null then
        raise exception 'Informe o nome do item avulso';
      end if;
      v_valor := round((v_it->>'valor_unitario')::numeric, 2);
      if v_valor is null or v_valor < 0 or v_valor > 9999 then
        raise exception 'Valor inválido para o item %', v_nomeit;
      end if;
      v_itens := v_itens || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'produto', v_nomeit, 'quantidade', v_qtd,
        'valor_unitario', v_valor, 'observacao', v_iobs, 'avulso', true)));
    end if;

    v_sub := v_sub + v_qtd * v_valor;
  end loop;

  -- taxa de entrega: valor fixo definido em Configurações (retirada e balcão não têm taxa)
  if v_tipo = 'entrega' then
    select coalesce(taxa_entrega, 0) into v_taxa from public.restaurante where id = 1;
    v_taxa := coalesce(v_taxa, 0);
  end if;

  v_desc := round(coalesce(nullif(p_dados->>'desconto', '')::numeric, 0), 2);
  if v_desc < 0 or v_desc > v_sub then
    raise exception 'Desconto inválido';
  end if;

  v_total := v_sub + v_taxa - v_desc;

  -- como o cliente vai pagar (para constar na comanda)
  if jsonb_typeof(p_dados->'pagamento_previsto') = 'object' then
    v_forma := lower(nullif(trim(coalesce(p_dados->'pagamento_previsto'->>'forma', '')), ''));
    if v_forma is not null and v_forma not in ('dinheiro', 'pix', 'credito', 'debito') then
      raise exception 'Forma de pagamento inválida: %', v_forma;
    end if;
    v_pago := coalesce((p_dados->'pagamento_previsto'->>'pago')::boolean, false);
    v_troco := nullif(p_dados->'pagamento_previsto'->>'troco_para', '')::numeric;
    if v_troco is not null and (v_forma is distinct from 'dinheiro' or v_troco < v_total) then
      raise exception 'O valor do troco deve ser em dinheiro e maior ou igual ao total';
    end if;
    v_pp := jsonb_strip_nulls(jsonb_build_object('forma', v_forma, 'pago', v_pago, 'troco_para', v_troco));
  end if;

  select nome into v_usuario from public.profiles where id = auth.uid();

  -- Ligado (padrão): imprime ao criar e o pedido já nasce em "preparo".
  -- Desligado: nasce "novo" e imprime ao avançar para "preparo" (gatilho da seção 5).
  v_auto := p_imprimir
    and coalesce((select delivery_imprimir_ao_criar from public.config_impressao where id = 1), true);

  -- número do pedido no dia (1, 2, 3...), sem repetir mesmo com cliques simultâneos
  perform pg_advisory_xact_lock(hashtext('pedidos_externos_numero_dia'));
  select coalesce(max(numero_dia), 0) + 1 into v_dia
  from public.pedidos_externos
  where (criado_em at time zone 'America/Sao_Paulo')::date
      = (now() at time zone 'America/Sao_Paulo')::date;

  insert into public.pedidos_externos
    (numero_dia, canal, tipo, cliente_nome, telefone, endereco, bairro, referencia,
     itens, subtotal, taxa_entrega, desconto, total, pagamento_previsto, observacao,
     criado_por, criado_por_nome, status)
  values
    (v_dia, v_canal, v_tipo, v_nome, v_tel,
     case when v_tipo = 'entrega' then v_end end,
     case when v_tipo = 'entrega' then v_bairro end,
     case when v_tipo = 'entrega' then v_ref end,
     v_itens, v_sub, v_taxa, v_desc, v_total, v_pp, v_obs,
     auth.uid(), v_usuario,
     case when v_auto then 'preparo' else 'novo' end)
  returning * into v_pedido;

  -- comanda (cozinha + delivery, se entrega) para a fila de impressão
  if v_auto then
    perform public._comanda_pedido_externo(v_pedido);
  end if;

  return v_pedido;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 6. RPCs da estação de impressão
-- ---------------------------------------------------------------------------------------------

-- Reserva até p_limite trabalhos liberados (últimas 3 h), sem disputar com outra estação.
-- Também retoma trabalhos "imprimindo" abandonados (estação fechou no meio) há mais de 2 min.
-- Devolve cada trabalho com a comanda (pedidos_cozinha) em "comanda".
create or replace function public.reservar_impressao(
  p_estacao text,
  p_tipos text[] default null,
  p_limite integer default 3
)
returns setof jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_caixa() then
    raise exception 'Somente o caixa imprime a fila de impressão';
  end if;

  -- Abandonado depois da 5ª tentativa: falhou.
  update public.fila_impressao
     set status = 'falhou', erro = coalesce(erro, 'A estação parou de responder durante a impressão.'),
         reservado_em = null
   where status = 'imprimindo'
     and reservado_em < now() - interval '2 minutes'
     and tentativas >= 5;

  return query
  with alvo as (
    select f.id
      from public.fila_impressao f
     where ((f.status = 'pendente' and f.proxima_tentativa_em <= now())
            or (f.status = 'imprimindo' and f.reservado_em < now() - interval '2 minutes'))
       and f.tentativas < 5
       and f.liberado_em > now() - interval '3 hours'
       and (p_tipos is null or f.tipo = any (p_tipos))
     order by f.criado_em
     limit greatest(1, least(coalesce(p_limite, 3), 20))
     for update skip locked
  ), reservados as (
    update public.fila_impressao f
       set status = 'imprimindo',
           reservado_em = now(),
           reservado_por = auth.uid(),
           estacao = left(coalesce(nullif(trim(p_estacao), ''), 'Estação'), 80),
           tentativas = f.tentativas + 1
      from alvo
     where f.id = alvo.id
    returning f.*
  )
  select to_jsonb(r) || jsonb_build_object(
           'comanda', (select to_jsonb(pc) from public.pedidos_cozinha pc where pc.id = r.pedido_cozinha_id)
         )
    from reservados r
   order by r.criado_em;
end;
$$;

grant execute on function public.reservar_impressao(text, text[], integer) to authenticated;

-- Resultado da impressão. Falha: tenta de novo em 15 s, até 5 tentativas; depois "falhou".
create or replace function public.concluir_impressao(p_id uuid, p_ok boolean, p_erro text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.fila_impressao;
begin
  if not public.is_caixa() then
    raise exception 'Somente o caixa imprime a fila de impressão';
  end if;

  update public.fila_impressao
     set status = case when p_ok then 'impresso' when tentativas >= 5 then 'falhou' else 'pendente' end,
         impresso_em = case when p_ok then now() else null end,
         erro = case when p_ok then null else left(coalesce(nullif(trim(p_erro), ''), 'Falha na impressão'), 500) end,
         proxima_tentativa_em = case when p_ok then proxima_tentativa_em else now() + interval '15 seconds' end,
         reservado_em = null
   where id = p_id and status = 'imprimindo' and reservado_por = auth.uid()
  returning * into v_job;

  if not found then
    return null;
  end if;

  if p_ok and v_job.pedido_cozinha_id is not null then
    update public.pedidos_cozinha set impresso_em = now()
     where id = v_job.pedido_cozinha_id and impresso_em is null;
  end if;

  return v_job.status;
end;
$$;

grant execute on function public.concluir_impressao(uuid, boolean, text) to authenticated;

-- "Imprimir pendentes": devolve à fila os que falharam e os antigos (> 3 h) que não imprimiram.
-- Com p_ids, reenvia exatamente esses (inclusive reimpressão de um já impresso).
create or replace function public.reenviar_impressao(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
begin
  if not public.is_caixa() then
    raise exception 'Somente o caixa imprime a fila de impressão';
  end if;

  update public.fila_impressao
     set status = 'pendente', tentativas = 0, erro = null,
         proxima_tentativa_em = now(), liberado_em = now(),
         reservado_em = null, reservado_por = null
   where status <> 'imprimindo'
     and (
       (p_ids is not null and id = any (p_ids))
       or (p_ids is null and criado_em > now() - interval '24 hours'
           and (status = 'falhou'
                or (status = 'pendente' and liberado_em <= now() - interval '3 hours')))
     );
  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

grant execute on function public.reenviar_impressao(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7. Compatibilidade: marcar_impresso (tela /cozinha e abas antigas do caixa)
-- ---------------------------------------------------------------------------------------------
create or replace function public.marcar_impresso(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Faça login para continuar';
  end if;

  -- A fila já está imprimindo (ou imprimiu) esta comanda: não imprime de novo.
  if exists (
    select 1 from public.fila_impressao
     where pedido_cozinha_id = p_id and status in ('imprimindo', 'impresso')
  ) then
    return false;
  end if;

  update public.pedidos_cozinha
  set impresso_em = now()
  where id = p_id and impresso_em is null;

  if not found then
    return false;
  end if;

  update public.fila_impressao
     set status = 'impresso', impresso_em = now(), erro = null,
         estacao = coalesce(estacao, 'Estação da cozinha')
   where pedido_cozinha_id = p_id and status in ('pendente', 'falhou');

  return true;
end;
$$;

-- Limpeza que o caixa já roda ao abrir: agora também apaga a fila com mais de 7 dias
-- (os trabalhos de comandas apagadas saem junto, pela chave estrangeira).
create or replace function public.limpar_pedidos_cozinha()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_caixa() then
    raise exception 'Apenas o caixa pode executar a limpeza';
  end if;
  delete from public.pedidos_cozinha where criado_em < now() - interval '7 days';
  delete from public.fila_impressao where criado_em < now() - interval '7 days';
end;
$$;

notify pgrst, 'reload schema';
