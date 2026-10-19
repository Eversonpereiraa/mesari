-- Todo item sai na comanda: o setor da categoria passa a ser só 'cozinha' ou 'bar'.
-- A opção "Não imprimir" (setor 'nenhum') deixa de existir; as categorias que
-- estavam nela (ou sem setor) passam para a cozinha.

begin;

-- Se a coluna for enum, vira text antes de restringir (com text não muda nada).
alter table public.categorias alter column setor drop default;
alter table public.categorias alter column setor type text using setor::text;

update public.categorias
   set setor = 'cozinha'
 where setor is null or setor = 'nenhum';

alter table public.categorias
  alter column setor set default 'cozinha',
  alter column setor set not null;

alter table public.categorias drop constraint if exists categorias_setor_check;
alter table public.categorias
  add constraint categorias_setor_check check (setor in ('cozinha', 'bar'));

commit;
