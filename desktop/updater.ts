/**
 * Atualização automática pelo GitHub Releases (electron-updater).
 * Verifica em segundo plano ao abrir e a cada 4 horas, baixa sozinha e só AVISA o app
 * ("Nova versão disponível. Reiniciar agora?"). Nunca reinicia por conta própria: se o usuário
 * não reiniciar, a versão nova é instalada quando o Mesari for fechado normalmente.
 */
import { app, type BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";

type Log = (message: string, error?: unknown) => void;

let readyVersion: string | null = null;

export function updateReadyVersion() {
  return readyVersion;
}

export function startUpdater(getWindow: () => BrowserWindow | null, log: Log) {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (message: unknown) => log(`[atualização] ${String(message)}`),
    warn: (message: unknown) => log(`[atualização] ${String(message)}`),
    error: (message: unknown) => log("[atualização] erro", message),
    debug: () => undefined,
  };
  autoUpdater.on("update-downloaded", (info) => {
    readyVersion = info.version;
    log(`Atualização ${info.version} baixada; aguardando o usuário reiniciar.`);
    getWindow()?.webContents.send("mesari:update-ready", { versao: info.version });
  });
  autoUpdater.on("error", (error) => log("Falha ao verificar atualização", error));
  const check = () =>
    void autoUpdater
      .checkForUpdates()
      .catch((error: unknown) => log("Falha ao verificar atualização", error));
  setTimeout(check, 15_000);
  setInterval(check, 4 * 60 * 60 * 1000);
}

/** Reinicia e instala. Só é chamado quando o usuário clica em "Reiniciar agora". */
export function installUpdateNow() {
  if (!readyVersion) return false;
  autoUpdater.quitAndInstall(false, true);
  return true;
}
