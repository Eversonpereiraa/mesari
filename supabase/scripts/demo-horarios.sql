-- Horários realistas para o restaurante de demonstração (Sabor do Agreste).
-- SÓ NO PROJETO mesari-teste, logo depois de clicar em "Montar demonstração".
-- As funções do banco gravam "agora"; este script move vendas, mesas abertas e
-- delivery de hoje para o almoço (12h–14h) e o jantar (19h–22h), horário de São
-- Paulo. Use quando o app avisar que não conseguiu ajustar os horários.

begin;

-- Vendas: as 14 mais recentes de hoje são as da demonstração (11 de mesa e
-- 3 de delivery, na ordem em que o seed fechou).
with hoje as (
  select (now() at time zone 'America/Sao_Paulo')::date as d
),
horarios(n, hora) as (
  values
    (1, time '12:14'), (2, time '12:38'), (3, time '13:02'), (4, time '13:25'),
    (5, time '13:47'), (6, time '19:18'), (7, time '19:52'), (8, time '20:24'),
    (9, time '20:51'), (10, time '21:26'), (11, time '21:44'),
    (12, time '13:06'), (13, time '20:11'), (14, time '20:47')
),
demo as (
  select v.id, row_number() over (order by v.fechada_em) as n
  from (
    select id, fechada_em from public.vendas, hoje
    where (fechada_em at time zone 'America/Sao_Paulo')::date = hoje.d
    order by fechada_em desc
    limit 14
  ) v
)
update public.vendas v
set fechada_em = (hoje.d + h.hora) at time zone 'America/Sao_Paulo'
from demo, horarios h, hoje
where v.id = demo.id and h.n = demo.n;

-- Delivery: pelo nome do cliente da demonstração.
with hoje as (
  select (now() at time zone 'America/Sao_Paulo')::date as d
),
horarios(cliente, hora) as (
  values
    ('Rafael Nunes', time '12:31'), ('Maria do Socorro Lima', time '19:36'),
    ('Marcos Vinícius', time '20:12'), ('Família Tavares', time '20:58'),
    ('Luciana Barbosa', time '21:12'), ('José Cícero Araújo', time '21:28'),
    ('Ana Paula Souza', time '21:41')
)
update public.pedidos_externos p
set criado_em = (hoje.d + h.hora) at time zone 'America/Sao_Paulo'
from horarios h, hoje
where p.cliente_nome = h.cliente
  and (p.criado_em at time zone 'America/Sao_Paulo')::date = hoje.d;

-- Mesas abertas: horário de cada pedido (mesas 4 e 7 tiveram dois pedidos).
with hoje as (
  select (now() at time zone 'America/Sao_Paulo')::date as d
),
horarios(mesa, produto, hora) as (
  values
    (2, null, time '21:32'),
    (4, 'Cartola', time '21:18'), (4, null, time '20:41'),
    (5, null, time '21:10'),
    (7, 'Cerveja 600ml', time '21:05'), (7, null, time '21:22'),
    (9, null, time '20:35'),
    (11, null, time '21:40')
)
update public.itens_pedido i
set criado_em = (hoje.d + coalesce(
  (select h.hora from horarios h where h.mesa = m.numero and h.produto = i.produto_nome),
  (select h.hora from horarios h where h.mesa = m.numero and h.produto is null)
)) at time zone 'America/Sao_Paulo'
from public.mesas m, hoje
where i.mesa_id = m.id
  and m.numero in (2, 4, 5, 7, 9, 11);

commit;
