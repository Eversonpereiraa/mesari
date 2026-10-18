# Mesari para Windows

O Mesari Desktop é um contêiner Electron para o sistema publicado. Ele não inclui nem compila o Vite: a interface e os dados continuam vindo do site remoto. O conteúdo do sistema atualiza sozinho a cada publicação do site; este aplicativo não tem atualização automática.

## Desenvolvimento

Com Node.js instalado:

```powershell
cd desktop
npm ci
npm run dev
```

O aplicativo usa o endereço de `config.json`. Para desenvolvimento/teste, copie `config.example.json` para `config.json` e informe uma URL HTTPS válida. A configuração em `%APPDATA%\Mesari\config.json` tem prioridade sobre a configuração empacotada e permite trocar o endereço sem gerar outro instalador.

## Gerar o instalador localmente

Em Windows x64, na pasta `desktop`:

```powershell
npm ci
npm run dist
```

O instalador será criado em `desktop\release\Mesari-Setup-1.0.0.exe`. O NSIS permite escolher a pasta de instalação, cria atalhos no Menu Iniciar e na Área de Trabalho e abre o aplicativo ao final. A instalação é por usuário, sem solicitar administrador. A desinstalação preserva os dados do usuário.

## Gerar pelo GitHub Actions

Envie uma tag no formato `desktop-v1.0.0`:

```powershell
git tag desktop-v1.0.0
git push origin desktop-v1.0.0
```

O workflow compila o instalador em `windows-latest`, publica o `.exe` como artefato e cria um Release do GitHub quando acionado por tag. Também é possível iniciá-lo manualmente em **Actions > Aplicativo desktop Windows > Run workflow**.

## Uso

Instale o arquivo `Mesari-Setup-*.exe` e abra o Mesari pelo atalho. Entre com as credenciais do caixa e abra **Impressão**. Escolha entre o driver do Windows (com uma impressora para notas e outra para comandas), USB direto ou Bluetooth/porta COM. No modo direto, uma impressora autorizada atende notas e comandas neste computador; o Mesari salva a permissão e tenta reconectá-la automaticamente nas próximas aberturas. A largura pode ser definida como 58 ou 80 mm; também é possível habilitar a impressão de comandas e imprimir uma página de teste. O login fica salvo na sessão persistente do aplicativo.

Para usar uma impressora Bluetooth térmica, emparelhe-a primeiro nas configurações Bluetooth do Windows e, se o modelo oferecer perfil de porta serial (SPP), selecione a porta COM correspondente em **Bluetooth / porta COM**. Impressoras Bluetooth BLE que não disponibilizam uma porta COM não são compatíveis com essa conexão direta; nesse caso, use o driver do Windows.

O ícone da bandeja oferece **Abrir Mesari**, **Imprimir página de teste**, **Abrir pasta de logs**, **Abrir pasta de impressões** e **Sair**. Com **manter em segundo plano** habilitado, fechar a janela apenas a oculta. O padrão mantém a suspensão do aplicativo bloqueada e inicia o Mesari com o Windows; essas três opções podem ser alteradas em **Impressão**.

O arquivo `config.json` dentro de `%APPDATA%\Mesari` pode conter, por exemplo:

```json
{
  "appUrl": "https://design-driven-orders.vercel.app/"
}
```

Os logs ficam em `%APPDATA%\Mesari\logs\mesari.log`, com rotação limitada e cópias antigas numeradas.

## Testar sem impressora (impressora virtual em PDF)

Na lista de impressoras do Windows aparece também **Mesari - Impressora virtual (PDF)**. Escolha-a como impressora da nota e/ou das comandas em **Impressão**: cada impressão vira um PDF na largura da bobina (58 ou 80 mm), salvo sem diálogo em `%APPDATA%\Mesari\impressoes\AAAA-MM-DD_HHmmss_<tipo>.pdf` (`comanda`, `recibo` ou `teste`). Use **Abrir pasta de impressões** na bandeja para ver os arquivos. Assim dá para testar o app exatamente como ele roda no restaurante.

## Limitações conhecidas

- É necessária conexão com a internet para usar o sistema. Se o site estiver indisponível, o aplicativo exibe a tela offline e tenta novamente automaticamente a cada 10 segundos e quando a conexão retorna.
- A largura e a altura de bobina personalizadas dependem do suporte do driver da impressora. Alguns drivers ignoram o tamanho de papel enviado pelo Electron/Windows e podem imprimir em página maior, cortar de modo diferente ou acrescentar espaço em branco.
- Não há atualização automática do aplicativo desktop. O conteúdo web, por outro lado, já acompanha automaticamente as publicações do sistema.
- O instalador não possui assinatura digital. O Windows SmartScreen pode exibir um aviso; para prosseguir, selecione **Mais informações > Executar assim mesmo** somente se confiar no instalador que baixou.
- USB direto requer uma impressora térmica compatível com ESC/POS e interface USB de impressão. Impressoras que exigem protocolo ou driver proprietário podem não funcionar nesse modo; use o driver do Windows.
- Bluetooth direto utiliza uma porta COM/serial disponibilizada pelo Windows após o pareamento. Bluetooth BLE sem porta COM não é compatível com a conexão direta.
- No modo de driver, o modelo, o tamanho da bobina e a qualidade dependem da configuração do driver do Windows; alguns drivers ignoram o tamanho personalizado enviado pelo aplicativo.
