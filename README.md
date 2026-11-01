# Mesari

Comanda digital para restaurantes, bares e lanchonetes pequenos.

- **Garçom:** lança o pedido pelo celular, direto na mesa.
- **Cozinha e bar:** recebem a comanda na hora, na tela ou impressa.
- **Caixa:** acompanha as mesas, fecha a conta (Pix, dinheiro, cartão, com troco), imprime o recibo e vê o relatório de vendas.

Também tem delivery/retirada, cardápio, mapa das mesas e app para Windows com impressão silenciosa.

## Tecnologias

- [TanStack Start](https://tanstack.com/start) + React + TypeScript + Vite + Tailwind
- [Supabase](https://supabase.com): login, banco Postgres, Realtime e funções (RPC)
- Electron (pasta [`desktop/`](desktop/README.md)): app Windows que imprime sem abrir diálogo

O projeto é sincronizado com o [Lovable](https://lovable.dev). Não use force push nem reescreva commits já enviados, porque o Lovable perde o histórico.

## Como rodar

Você precisa do Node.js 22 ou mais novo.

```sh
npm ci
cp .env.example .env   # depois preencha com os dados do seu Supabase
npm run dev
```

Abra o endereço que aparece no terminal (normalmente http://localhost:5173 ou :3000).

### Variáveis de ambiente (`.env`)

| Variável                 | O que é                                                  |
| ------------------------ | -------------------------------------------------------- |
| `VITE_SUPABASE_URL`      | URL do projeto Supabase (Project Settings → API)         |
| `VITE_SUPABASE_ANON_KEY` | Chave pública `anon` do projeto (Project Settings → API) |

Nunca coloque a chave `service_role` no `.env` do front-end.

### Banco de dados

O passo a passo para criar o banco de um restaurante novo do zero está em [`supabase/README.md`](supabase/README.md). Toda mudança de banco vira um arquivo novo em `supabase/migrations/`.

## Verificações

Rode antes de enviar qualquer mudança:

```sh
npx tsc --noEmit   # tipos
npx eslint .       # estilo e erros comuns
npx vitest run     # testes (não precisam de .env nem de internet)
npm run build      # build de produção
```

## Telas

| Rota           | Quem usa | Para quê                                             |
| -------------- | -------- | ---------------------------------------------------- |
| `/`            | todos    | Login                                                |
| `/garcom`      | garçom   | Mapa das mesas no celular                            |
| `/mesa/:id`    | garçom   | Itens da mesa, pedir a conta                         |
| `/pedido/:id`  | garçom   | Lançar pedido                                        |
| `/cozinha`     | cozinha  | Comandas da cozinha/bar em tempo real                |
| `/caixa`       | caixa    | Mesas, fechamento de conta e recibo                  |
| `/delivery`    | caixa    | Pedidos de entrega e retirada                        |
| `/vendas`      | caixa    | Relatório de vendas por período e forma de pagamento |
| `/cardapio`    | caixa    | Produtos e categorias (setor cozinha/bar)            |
| `/layout`      | caixa    | Mapa do salão                                        |
| `/restaurante` | caixa    | Dados do restaurante, taxa de serviço, garçons       |
| `/impressao`   | caixa    | Impressoras, largura da bobina e teste de impressão  |

## App desktop (Windows) e instalador

O app desktop abre o sistema publicado e imprime direto na impressora térmica, sem diálogo. Detalhes completos estão em [`desktop/README.md`](desktop/README.md).

Para gerar o instalador no Windows:

```powershell
cd desktop
npm ci
npm run dist
```

O arquivo sai em `desktop\release\Mesari-Setup-<versão>.exe`. Também dá para gerar pelo GitHub Actions enviando uma tag `desktop-v<versão>` (exemplo: `git tag desktop-v1.0.1 && git push origin desktop-v1.0.1`).
