-- Nota de consumo (pré-conta): impressa no caixa quando alguém pede a conta.
-- Só adiciona. Depende das migrations 202611030001 e 202611030002.

-- Quando a nota da mesa foi impressa (ou reservada para impressão) pela última vez.
alter table public.mesas add column if not exists nota_impressa_em timestamptz;

-- Mesa liberada (conta fechada): começa a próxima ocupação sem nota.
create or replace function public.limpar_nota_ao_liberar()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'livre' then
    new.nota_impressa_em := null;
  end if;
  return new;
end;
$$;

drop trigger if exists mesas_limpar_nota on public.mesas;
create trigger mesas_limpar_nota
  before update of status on public.mesas
  for each row execute procedure public.limpar_nota_ao_liberar();

-- Item novo depois de pedir a conta: a mesa volta para "ocupada" (a nota impressa fica
-- desatualizada). O nome com "zz" garante que roda depois dos outros gatilhos de itens_pedido.
create or replace function public.reabrir_conta_com_item_novo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.mesas set status = 'ocupada' where id = new.mesa_id and status = 'conta';
  return new;
end;
$$;

drop trigger if exists itens_pedido_zz_reabrir_conta on public.itens_pedido;
create trigger itens_pedido_zz_reabrir_conta
  after insert on public.itens_pedido
  for each row execute procedure public.reabrir_conta_com_item_novo();

-- O caixa reserva a impressão da nota (evita imprimir duas vezes com dois caixas abertos).
-- Reserva se a mesa está em "conta" e ainda não tem nota, ou se entrou item depois da nota.
create or replace function public.reservar_nota_conta(p_mesa_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_caixa() then
    raise exception 'Somente o caixa imprime a nota de consumo.';
  end if;
  update public.mesas m
     set nota_impressa_em = now()
   where m.id = p_mesa_id
     and m.status = 'conta'
     and (
       m.nota_impressa_em is null
       or exists (
         select 1 from public.itens_pedido i
          where i.mesa_id = m.id and i.criado_em > m.nota_impressa_em
       )
     );
  return found;
end;
$$;

grant execute on function public.reservar_nota_conta(uuid) to authenticated;

notify pgrst, 'reload schema';
