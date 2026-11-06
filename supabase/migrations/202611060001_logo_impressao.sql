-- Logo de impressão (PNG preto e branco processado no upload), opção de imprimir a logo na
-- conta e na comanda de delivery, e rodapé editável da conta. Só adiciona colunas.
alter table public.restaurante
  add column if not exists logo_impressao_url text not null default '';

alter table public.restaurante
  add column if not exists imprimir_logo boolean not null default false;

alter table public.restaurante
  add column if not exists rodape_conta text not null default E'Obrigado pela preferência!\nVolte sempre';
