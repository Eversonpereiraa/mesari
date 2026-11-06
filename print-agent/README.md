# Mesari Print Agent

Programa pequeno que roda no computador do caixa e deixa o Mesari (no navegador) imprimir em:

- **Rede (IP)**: impressora térmica ligada no cabo de rede ou Wi-Fi (porta 9100).
- **Impressora do Windows**: qualquer impressora instalada no Windows (ex.: "ELGIN i9"). Os comandos vão direto, em modo RAW, sem passar pelo layout do driver.
- **Porta serial (COM)**: impressora em COM1, COM3 etc., com velocidade configurável.

O navegador não consegue abrir essas conexões sozinho. O agente escuta só em `http://localhost:9123` e só aceita pedidos do site do Mesari e de `localhost`.

## Jeito mais fácil: o arquivo .exe

1. Copie a pasta `print-agent` (com o `mesari-print-agent.exe` dentro de `dist`, ou o `.exe` solto) para o computador do caixa, por exemplo em `C:\Mesari\print-agent`.
2. Dê dois cliques em **iniciar-agente.bat**. Uma janela fica aberta escrito "Rodando em http://localhost:9123". Deixe aberta (pode minimizar).
3. No Mesari, abra **Impressão** e escolha Rede, Impressora do Windows ou Porta serial. O status do agente deve aparecer como **Rodando**.
4. Se o Chrome perguntar se o site pode acessar dispositivos da rede local, clique em **Permitir**.

> Se o `iniciar-agente.bat` não achar o `.exe` ao lado dele, ele tenta rodar com o Node (veja abaixo). Coloque o `.exe` na mesma pasta do `.bat`.

## Iniciar junto com o Windows

Dê dois cliques em **instalar-inicializacao.bat**. Ele cria um atalho em `shell:startup` (pasta Inicializar do seu usuário), e o agente abre minimizado sempre que o Windows ligar.

Para desfazer, rode **remover-inicializacao.bat**.

## Rodar com o Node (sem .exe)

1. Instale o Node.js LTS (versão 18 ou mais nova) em <https://nodejs.org>. Na instalação, deixe marcada a opção "Add to PATH".
2. Abra o Prompt de Comando nesta pasta e rode:

   ```bat
   node agent.js
   ```

   ou dê dois cliques em `iniciar-agente.bat`.

O agente não tem dependências: não precisa de `npm install`.

## Gerar o .exe

Com o Node instalado, nesta pasta:

```bat
npm run build:exe
```

O arquivo sai em `dist\mesari-print-agent.exe` (cerca de 55 MB, já inclui o Node). Copie-o junto com os `.bat`.

## Configuração (opcional)

Crie um `config.json` ao lado do agente (veja `config.example.json`):

```json
{
  "porta": 9123,
  "origens": ["https://design-driven-orders.vercel.app", "https://meu-dominio.com.br"]
}
```

- `porta`: porta local do agente. Se mudar, ajuste também "Endereço do agente" na tela Impressão.
- `origens`: sites que podem usar o agente, além de `localhost`. O domínio publicado do Mesari já vem incluído.

As mesmas opções podem vir das variáveis de ambiente `MESARI_AGENTE_PORTA` e `MESARI_ORIGENS` (separadas por vírgula).

## Endereços

| Método | Caminho | O que faz |
| --- | --- | --- |
| GET | `/health` | `{ ok, versao }`: confirma que o agente está rodando |
| GET | `/printers` | Impressoras instaladas no Windows |
| GET | `/serial-ports` | Portas COM disponíveis |
| POST | `/check` | Testa a conexão sem imprimir (mesmo corpo do `/print`, sem `dados`) |
| POST | `/print` | Imprime. Corpo: `{ tipo: "rede" \| "windows" \| "serial", ip, porta, impressora, com, baud, dados }`, com `dados` em base64 |

Os erros voltam como `{ ok: false, mensagem, detalhe }`: `mensagem` é para mostrar ao usuário e `detalhe` é técnico.

## Problemas comuns

- **"Agente não encontrado"** na tela Impressão: a janela do agente está fechada. Rode `iniciar-agente.bat`.
- **"A porta 9123 já está em uso"**: o agente já está aberto em outra janela.
- **Impressora do Windows não imprime**: confira se o nome é exatamente o que aparece em Configurações > Impressoras. Drivers do tipo "v4" (XPS) não aceitam RAW; instale o driver do fabricante (Elgin, Bematech, Epson).
- **Porta COM em uso**: feche outros programas que usam a impressora (outro PDV, utilitário do fabricante).
- **Acentos errados**: na tela Impressão, troque a codepage (CP850, CP860, CP437, WPC1252) e imprima a página de teste.
