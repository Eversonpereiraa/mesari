# Mesari Desktop (Windows)

O Mesari Desktop é o mesmo sistema do navegador, empacotado com Electron, com instalador próprio, impressão nativa e atualização automática. O site continua funcionando normalmente no navegador; o app desktop é uma opção a mais.

- A interface vem **dentro do app** (build do Vite empacotado), aberta em `app://mesari/`. Os dados continuam no Supabase, então é preciso internet.
- A impressão fala direto com a impressora, **sem o agente de impressão**: rede (IP), impressora instalada no Windows, porta COM (cabo USB em modo COM e Bluetooth clássico pareado) e Bluetooth BLE.

## Estrutura

| Caminho | O que é |
| --- | --- |
| `desktop/main.ts` | Processo principal: janela, protocolo `app://`, atalhos, bandeja, inicialização com o Windows |
| `desktop/printing.ts` | Impressão nativa: TCP (rede), RAW no Windows, porta COM (`serialport`) |
| `desktop/updater.ts` | Atualização automática (`electron-updater` + GitHub Releases) |
| `desktop/preload.ts` | Ponte segura: expõe só `window.mesariDesktop` com funções específicas |
| `desktop/electron-builder.config.cjs` | Instalador NSIS, ícone, asar e publicação |
| `desktop/build/installer.nsh` | Página final do instalador ("Abrir o Mesari", "Iniciar com o Windows") |
| `desktop/build/icon.ico` | Ícone (16 a 256 px), gerado a partir de `src/assets/branding/icon-1024.png` |
| `desktop/scripts/` | `dev.mjs` (desenvolvimento) e `build.mjs` (instalador e publicação) |
| `src/lib/printing/transports/electron.ts` | `ElectronTransport`, usado sozinho quando o app desktop está presente |

Segurança: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. O renderer não tem acesso ao Node; cada chamada de IPC confere se veio da janela do Mesari. Links externos abrem no navegador padrão.

## Requisitos

- Windows 10 ou 11 (64 bits)
- Node.js 22 ou mais novo
- Uma vez, para instalar as dependências:

```powershell
npm install
npm --prefix desktop install
```

> Se o `npm` avisar de scripts de instalação bloqueados, rode `node desktop/node_modules/electron/install.js` para baixar o Electron.

## Rodar em desenvolvimento

```powershell
npm run desktop:dev
```

Sobe o Vite em `http://localhost:5180` (com recarga automática) e abre o Electron apontando para ele. `Ctrl+Shift+I` abre o DevTools (só em desenvolvimento).

> Terminais do VS Code exportam `ELECTRON_RUN_AS_NODE=1`, o que faria o Electron rodar como Node. O `desktop:dev` já remove essa variável. Se for abrir o `Mesari.exe` à mão por esse terminal, rode antes `Remove-Item Env:ELECTRON_RUN_AS_NODE`.

## Gerar o instalador

```powershell
npm run desktop:build
```

O script:

1. faz o build do Vite em modo SPA (`MESARI_DESKTOP=1`, saída em `dist/client`). O build do site (Lovable/Vercel) não muda;
2. copia a interface para `desktop/app`;
3. compila o main e o preload em `desktop/out`;
4. confere se o `serialport` carrega dentro do Electron. Ele traz um binário N-API pronto, que funciona sem compilar. O `electron-rebuild` só roda se esse binário não carregar, e aí precisa do Visual Studio Build Tools com C++;
5. gera `desktop/release/Mesari-Setup-x.y.z.exe` (64 bits).

O instalador:

- é em português, com assistente: escolher a pasta e criar atalhos na área de trabalho e no Menu Iniciar;
- na última tela, tem "Abrir o Mesari ao terminar" (marcado) e "Iniciar o Mesari com o Windows" (desmarcado). Essa opção também fica em **Impressão > App desktop** dentro do Mesari;
- instala por usuário (sem pedir administrador) em `%LOCALAPPDATA%\Programs\Mesari`;
- aparece em **Aplicativos instalados** como "Mesari", com ícone e editora "Mesari". A desinstalação mantém os dados do usuário (`%APPDATA%\Mesari`).

## Publicar uma atualização

1. Suba a versão em `desktop/package.json` (ex.: `1.1.0` → `1.1.1`). O app só atualiza para uma versão **maior** que a instalada.
2. Escolha uma forma de publicar:
   - **Pelo GitHub Actions (recomendado):** crie e envie uma tag `desktop-v1.1.1`. O workflow `.github/workflows/desktop.yml` gera o instalador no `windows-latest` e publica o Release com o `.exe`, o `latest.yml` e o `.blockmap`, que o atualizador usa.

     ```powershell
     git tag desktop-v1.1.1
     git push origin desktop-v1.1.1
     ```

   - **Do seu computador:** com um token do GitHub com permissão de escrita em Releases:

     ```powershell
     $env:GH_TOKEN = "ghp_..."
     npm run desktop:publish
     ```

3. Nos computadores com o Mesari Desktop: ao abrir (e a cada 4 horas), o app verifica em segundo plano e baixa a versão nova. Quando termina, aparece **"Nova versão disponível. Reiniciar agora?"**. O app **nunca reinicia sozinho**. Se o usuário escolher "Depois", a versão nova é instalada quando o Mesari for fechado pelo menu da bandeja (**Sair**).

### Repositório das versões

Configurável por variável de ambiente no momento do build (o padrão é o repositório deste projeto):

| Variável | Padrão | Uso |
| --- | --- | --- |
| `MESARI_GH_OWNER` | `Eversonpereiraa` | Dono do repositório |
| `MESARI_GH_REPO` | `mesari` | Nome do repositório |
| `MESARI_GH_PRIVATE` | (público) | `1` se o repositório for privado |

**Repositório privado:** o app instalado precisa de um token para baixar as atualizações, e o token iria dentro de cada computador. O mais seguro é publicar as versões num **repositório público só de releases** (ex.: `mesari-desktop-releases`, sem código) e apontar `MESARI_GH_REPO` para ele.

## Assinar o instalador (tirar o aviso do Windows)

Sem assinatura, o Windows SmartScreen mostra "O Windows protegeu o computador" e é preciso clicar em **Mais informações > Executar assim mesmo**. Para tirar o aviso:

1. **Compre um certificado de assinatura de código** (Code Signing) de uma autoridade como DigiCert, Sectigo ou GlobalSign, em nome da empresa (exige CNPJ e validação):
   - **OV (Organization Validation):** mais barato. O aviso some depois que o instalador ganha "reputação" (downloads ao longo de algumas semanas).
   - **EV (Extended Validation):** mais caro, vem em token USB ou HSM na nuvem. Costuma ganhar reputação mais rápido.
   - Alternativa: **Azure Trusted Signing** (Microsoft), com assinatura mensal, sem token físico.
2. **Configure o electron-builder.**
   - Com um arquivo `.pfx`:

     ```powershell
     $env:CSC_LINK = "C:\certificados\mesari.pfx"     # ou o conteúdo em base64
     $env:CSC_KEY_PASSWORD = "senha-do-certificado"
     npm run desktop:build
     ```

     No GitHub Actions, guarde os dois como *secrets* e passe no passo de build (`env:`).
   - Com token EV ou Azure Trusted Signing: siga a seção "Code Signing" da documentação do electron-builder (`win.signtoolOptions` ou `win.azureSignOptions` em `electron-builder.config.cjs`).
3. Gere de novo. O log do build deve mostrar `signing` em vez de `no code signing certificate configured`.

Mantenha a mesma editora/certificado entre versões: a atualização automática confere a assinatura.

## Impressão no app desktop

Em **Impressão**, o desktop mostra três opções. Todas têm "Testar conexão", "Imprimir página de teste" e "Imprimir comanda de exemplo".

1. **Bluetooth:** lista as impressoras Bluetooth pareadas no Windows (aparecem como porta COM, ex.: "Link serial padrão por Bluetooth (COM5)"). **Pareie a impressora em Configurações do Windows > Bluetooth antes.** O botão "Procurar BLE" procura impressoras Bluetooth Low Energy e mostra a lista para escolher.
2. **Rede:** IP e porta (9100).
3. **Cabo USB:** lista as impressoras instaladas no Windows (envio RAW, sem o layout do driver) e as portas COM (cabo USB em modo serial), com a velocidade (baud).

O perfil de largura, a calibração e a codepage são os mesmos do navegador. Os logs ficam em `%APPDATA%\Mesari\logs\mesari.log` (atalho na bandeja: **Abrir pasta de logs**).

## Atalhos

| Tecla | Ação |
| --- | --- |
| F5 | Recarregar |
| F11 | Tela cheia |
| Ctrl + / Ctrl − / Ctrl 0 | Zoom |
| Ctrl+Shift+I | DevTools (só em desenvolvimento) |

## Mudanças em relação à versão 1.0.x

- A 1.0.x abria o site publicado; a 1.1 traz a interface dentro do app. Como a origem mudou, **é preciso entrar de novo** e refazer a configuração da impressora na primeira abertura.
- "Iniciar com o Windows" agora vem **desligado** por padrão. Quem já usava ligado continua ligado.
- O agente de impressão não é mais necessário no computador com o app desktop.
