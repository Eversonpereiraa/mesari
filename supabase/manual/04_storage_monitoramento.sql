-- 04 · STORAGE DO LOGO + MONITORAMENTO

-- Bucket público para logo (e futuras fotos de cardápio). Leitura pública pela URL;
-- só o caixa envia/troca/apaga. Limite 1 MB, só imagens.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marca', 'marca', true, 1048576, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;

drop policy if exists marca_caixa_select on storage.objects;
drop policy if exists marca_caixa_insert on storage.objects;
drop policy if exists marca_caixa_update on storage.objects;
drop policy if exists marca_caixa_delete on storage.objects;
-- select é necessário para remove() e upsert no Storage (a leitura pública pela URL não depende dele).
create policy marca_caixa_select on storage.objects for select to authenticated
  using (bucket_id = 'marca' and public.is_caixa());
create policy marca_caixa_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'marca' and public.is_caixa());
create policy marca_caixa_update on storage.objects for update to authenticated
  using (bucket_id = 'marca' and public.is_caixa()) with check (bucket_id = 'marca' and public.is_caixa());
create policy marca_caixa_delete on storage.objects for delete to authenticated
  using (bucket_id = 'marca' and public.is_caixa());
-- (restaurante.logo_url continua text; passa a guardar a URL. O app converte o base64
--  atual na primeira vez que o caixa abrir a tela Restaurante.)


-- Monitoramento: tamanho do banco e das 10 maiores tabelas, só para o caixa.
create or replace function public.admin_tamanho_banco()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_caixa() then raise exception 'Somente o caixa vê o uso do banco.'; end if;
  return jsonb_build_object(
    'banco_bytes', pg_database_size(current_database()),
    'tabelas', (
      select coalesce(jsonb_agg(t order by t.total_bytes desc), '[]'::jsonb) from (
        select c.relname as tabela,
               pg_total_relation_size(c.oid) as total_bytes,
               pg_indexes_size(c.oid) as indices_bytes,
               greatest(c.reltuples, 0)::bigint as linhas
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by pg_total_relation_size(c.oid) desc
        limit 10
      ) t)
  );
end;
$$;

revoke execute on function public.admin_tamanho_banco() from public, anon;
grant execute on function public.admin_tamanho_banco() to authenticated;

notify pgrst, 'reload schema';
