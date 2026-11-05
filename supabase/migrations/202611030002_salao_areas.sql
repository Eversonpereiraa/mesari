-- Áreas livres do salão (Salão, Varanda, Calçada...) e elementos (balcão, porta, janela,
-- caixa, cozinha). Só adiciona. Depende da migration 202611030001_mapa_salao.sql.
-- Posições continuam em coordenadas absolutas de grade, como mesas.pos_x/pos_y.

create table if not exists public.salao_areas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo text not null default 'interna' check (tipo in ('interna', 'externa')),
  pos_x numeric not null default 0,
  pos_y numeric not null default 0,
  largura numeric not null default 12 check (largura >= 2),
  profundidade numeric not null default 9 check (profundidade >= 2),
  ordem integer not null default 0,
  criado_em timestamptz not null default now()
);

create table if not exists public.salao_elementos (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references public.salao_areas(id) on delete cascade,
  tipo text not null check (tipo in ('balcao', 'porta', 'janela', 'caixa', 'cozinha')),
  -- Centro, em unidades de grade. Porta/janela: centro na parede; rotation 0 = parede do
  -- fundo (ao longo de x), 1 = parede da esquerda (ao longo de y).
  pos_x numeric not null,
  pos_y numeric not null,
  largura numeric not null default 1,
  profundidade numeric not null default 1,
  rotation smallint not null default 0 check (rotation in (0, 1)),
  criado_em timestamptz not null default now()
);

alter table public.mesas
  add column if not exists area_id uuid references public.salao_areas(id) on delete set null;
create index if not exists mesas_area_idx on public.mesas (area_id);
create index if not exists salao_elementos_area_idx on public.salao_elementos (area_id);

-- RLS igual ao de mesas: todos leem, só o caixa altera.
alter table public.salao_areas enable row level security;
alter table public.salao_elementos enable row level security;

drop policy if exists salao_areas_select on public.salao_areas;
drop policy if exists salao_areas_caixa_insert on public.salao_areas;
drop policy if exists salao_areas_caixa_update on public.salao_areas;
drop policy if exists salao_areas_caixa_delete on public.salao_areas;
create policy salao_areas_select on public.salao_areas for select to authenticated using (true);
create policy salao_areas_caixa_insert on public.salao_areas for insert to authenticated with check (public.is_caixa());
create policy salao_areas_caixa_update on public.salao_areas for update to authenticated using (public.is_caixa()) with check (public.is_caixa());
create policy salao_areas_caixa_delete on public.salao_areas for delete to authenticated using (public.is_caixa());

drop policy if exists salao_elementos_select on public.salao_elementos;
drop policy if exists salao_elementos_caixa_insert on public.salao_elementos;
drop policy if exists salao_elementos_caixa_update on public.salao_elementos;
drop policy if exists salao_elementos_caixa_delete on public.salao_elementos;
create policy salao_elementos_select on public.salao_elementos for select to authenticated using (true);
create policy salao_elementos_caixa_insert on public.salao_elementos for insert to authenticated with check (public.is_caixa());
create policy salao_elementos_caixa_update on public.salao_elementos for update to authenticated using (public.is_caixa()) with check (public.is_caixa());
create policy salao_elementos_caixa_delete on public.salao_elementos for delete to authenticated using (public.is_caixa());

grant select, insert, update, delete on public.salao_areas, public.salao_elementos to authenticated;

-- Não deixa excluir área com mesa ativa dentro.
create or replace function public.bloquear_exclusao_area_com_mesas()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.mesas where area_id = old.id and ativa) then
    raise exception 'A área "%" tem mesas. Mova as mesas para outra área antes de excluir.', old.nome;
  end if;
  return old;
end;
$$;

drop trigger if exists salao_areas_bloquear_exclusao on public.salao_areas;
create trigger salao_areas_bloquear_exclusao
  before delete on public.salao_areas
  for each row execute procedure public.bloquear_exclusao_area_com_mesas();

-- Dados: área "Salão" 12 x 9 com todas as mesas, e balcão/porta/janela nas posições de hoje.
-- Pode rodar de novo sem duplicar.
do $$
declare
  v_area uuid;
begin
  select id into v_area from public.salao_areas order by ordem, criado_em limit 1;
  if v_area is null then
    insert into public.salao_areas (nome, tipo, pos_x, pos_y, largura, profundidade, ordem)
    values ('Salão', 'interna', 0, 0, 12, 9, 0)
    returning id into v_area;
    insert into public.salao_elementos (area_id, tipo, pos_x, pos_y, largura, profundidade, rotation) values
      (v_area, 'balcao', 11.375, 1.675, 0.95, 3.05, 0),
      (v_area, 'porta', 0, 4.8, 1.2, 0.2, 1),
      (v_area, 'janela', 6, 0, 6, 0.2, 0);
  end if;
  update public.mesas set area_id = v_area where area_id is null;
end $$;

-- Tempo real: o caixa vê mudanças de layout sem recarregar.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'salao_areas') then
    execute 'alter publication supabase_realtime add table public.salao_areas';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'salao_elementos') then
    execute 'alter publication supabase_realtime add table public.salao_elementos';
  end if;
end $$;

notify pgrst, 'reload schema';
