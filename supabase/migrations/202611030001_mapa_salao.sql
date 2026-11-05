-- Mapa do salão em perspectiva: posição em unidades de grade (múltiplos de 0,5),
-- formato e rotação de cada mesa. Só adiciona/ajusta; nenhuma coluna é apagada.

-- pos_x/pos_y eram integer (pixels do editor antigo). Passam a numeric para aceitar 0,5.
-- Os valores antigos são mantidos; o app trata posições fora do salão como "sem posição"
-- e reposiciona essas mesas automaticamente na primeira abertura do mapa.
alter table public.mesas
  alter column pos_x type numeric using pos_x::numeric,
  alter column pos_y type numeric using pos_y::numeric;

alter table public.mesas
  add column if not exists shape text not null default 'square',
  add column if not exists rotation smallint not null default 0;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'mesas_shape_check' and conrelid = 'public.mesas'::regclass) then
    alter table public.mesas add constraint mesas_shape_check check (shape in ('round', 'square', 'rect'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mesas_rotation_check' and conrelid = 'public.mesas'::regclass) then
    alter table public.mesas add constraint mesas_rotation_check check (rotation in (0, 1));
  end if;
end $$;

-- Mesas grandes começam como retangulares para o desenho bater com os lugares.
update public.mesas set shape = 'rect' where lugares >= 6 and shape = 'square';

-- Não deixa excluir (ou desativar) uma mesa que ainda tem itens em aberto.
create or replace function public.bloquear_exclusao_mesa_ocupada()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (tg_op = 'DELETE' or (old.ativa and not new.ativa))
     and exists (select 1 from public.itens_pedido where mesa_id = old.id) then
    raise exception 'A mesa % tem pedido em aberto. Feche a conta antes de excluir.', old.numero;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists mesas_bloquear_exclusao_ocupada on public.mesas;
create trigger mesas_bloquear_exclusao_ocupada
  before update of ativa or delete on public.mesas
  for each row execute procedure public.bloquear_exclusao_mesa_ocupada();

-- RLS: nada muda. As políticas existentes (mesas_caixa_insert/update/delete com is_caixa())
-- continuam valendo para as novas colunas.

-- Faz a API do Supabase enxergar as colunas novas na hora.
notify pgrst, 'reload schema';
