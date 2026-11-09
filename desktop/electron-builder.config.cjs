/**
 * Configuração do instalador (electron-builder) e da publicação das atualizações.
 *
 * Repositório das versões (GitHub Releases), configurável por variável de ambiente:
 *   MESARI_GH_OWNER   dono do repositório           (padrão: Eversonpereiraa)
 *   MESARI_GH_REPO    nome do repositório           (padrão: mesari)
 *   MESARI_GH_PRIVATE "1" se o repositório é privado (padrão: público)
 * Para publicar: GH_TOKEN com permissão de escrita em Releases.
 */
const owner = process.env.MESARI_GH_OWNER || "Eversonpereiraa";
const repo = process.env.MESARI_GH_REPO || "mesari";
const isPrivate = process.env.MESARI_GH_PRIVATE === "1";

/** @type {import("electron-builder").Configuration} */
module.exports = {
  appId: "com.mesari.app",
  productName: "Mesari",
  copyright: "Copyright © Mesari",
  artifactName: "Mesari-Setup-${version}.${ext}",
  directories: { buildResources: "build", output: "release" },
  files: ["out/**", "app/**", "build/icon.ico", "package.json", "!**/*.map"],
  asar: true,
  // O binário nativo do serialport não pode ser carregado de dentro do .asar.
  asarUnpack: ["node_modules/@serialport/bindings-cpp/**"],
  // O serialport usa binário N-API pronto (prebuilds/win32-x64), que funciona no Electron sem
  // recompilar. O "npm run rebuild" (electron-rebuild) roda antes do empacotamento.
  npmRebuild: false,
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    icon: "build/icon.ico",
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    // O atalho da Área de Trabalho é um checkbox na página "Opções" (build/installer.nsh).
    createDesktopShortcut: false,
    createStartMenuShortcut: true,
    // Visual do assistente: imagem lateral (164x314) nas telas de boas-vindas/conclusão,
    // faixa no topo (150x57) nas outras e tela de termos de uso.
    license: "build/license_pt_BR.txt",
    installerSidebar: "build/installerSidebar.bmp",
    uninstallerSidebar: "build/installerSidebar.bmp",
    installerHeader: "build/installerHeader.bmp",
    shortcutName: "Mesari",
    runAfterFinish: true,
    installerIcon: "build/icon.ico",
    uninstallerIcon: "build/icon.ico",
    installerHeaderIcon: "build/icon.ico",
    uninstallDisplayName: "Mesari",
    language: "1046",
    installerLanguages: ["pt_BR"],
    multiLanguageInstaller: true, // "false" faria o electron-builder voltar para inglês; com só pt_BR na lista, não aparece seletor de idioma
    deleteAppDataOnUninstall: false,
    include: "build/installer.nsh",
  },
  publish: [{ provider: "github", owner, repo, private: isPrivate, releaseType: "release" }],
};
