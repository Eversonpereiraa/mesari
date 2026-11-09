/**
 * Atualização automática pelo GitHub Releases (electron-updater).
 *
 * Fluxo:
 *   1. Ao abrir (15 s depois) e a cada 4 horas, verifica em segundo plano se há versão nova.
 *   2. Achou → avisa o app ("Nova atualização disponível") com a versão e as novidades.
 *   3. "Atualizar agora" → baixa mostrando o progresso → instala em silêncio e reabre o Mesari.
 *   4. "Depois" → baixa quietinho em segundo plano e instala quando o Mesari for fechado.
 * Nunca reinicia por conta própria: quem decide é o usuário (não derruba o caixa no meio do
 * serviço).
 */
import { app, type BrowserWindow } from "electron";
import { autoUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";

type Log = (message: string, error?: unknown) => void;

export type UpdateState =
  | { fase: "nenhuma" }
  | { fase: "disponivel"; versao: string; notas: string; tamanho: number }
  | { fase: "baixando"; versao: string; notas: string; pct: number; baixado: number; total: number; velocidade: number }
  | { fase: "pronta"; versao: string; notas: string }
  | { fase: "erro"; versao: string | null; mensagem: string };

let state: UpdateState = { fase: "nenhuma" };
let downloading = false;
let getWin: () => BrowserWindow | null = () => null;

/** Notas do GitHub Release (vêm em HTML ou como lista) → texto simples. */
function notesToText(info: UpdateInfo) {
  const raw = info.releaseNotes;
  const text = Array.isArray(raw)
    ? raw.map((n) => n.note ?? "").join("\n")
    : typeof raw === "string"
      ? raw
      : "";
  return text
    .replace(/<\/(p|li|h\d)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function totalSize(info: UpdateInfo) {
  return info.files?.reduce((sum, f) => sum + (f.size ?? 0), 0) ?? 0;
}

function setState(next: UpdateState) {
  state = next;
  const win = getWin();
  if (win && !win.isDestroyed()) {
    win.webContents.send("mesari:update-state", state);
    // Compatibilidade com o aviso antigo (interfaces anteriores à 1.2).
    if (next.fase === "pronta") win.webContents.send("mesari:update-ready", { versao: next.versao });
  }
}

export function updateState() {
  return state;
}

/** Mantido para o canal antigo "mesari:update-status". */
export function updateReadyVersion() {
  return state.fase === "pronta" ? state.versao : null;
}

export function startUpdater(getWindow: () => BrowserWindow | null, log: Log) {
  getWin = getWindow;
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = false; // só baixa depois que o usuário escolher
  autoUpdater.autoInstallOnAppQuit = true; // se não reiniciar, instala ao fechar
  autoUpdater.logger = {
    info: (message: unknown) => log(`[atualização] ${String(message)}`),
    warn: (message: unknown) => log(`[atualização] ${String(message)}`),
    error: (message: unknown) => log("[atualização] erro", message),
    debug: () => undefined,
  };

  autoUpdater.on("update-available", (info) => {
    // Já baixando ou pronta: não volta o aviso para o início.
    if (downloading || state.fase === "pronta") return;
    log(`Atualização ${info.version} disponível.`);
    setState({ fase: "disponivel", versao: info.version, notas: notesToText(info), tamanho: totalSize(info) });
  });

  autoUpdater.on("download-progress", (p: ProgressInfo) => {
    const base = state.fase === "disponivel" || state.fase === "baixando" ? state : null;
    if (!base) return;
    setState({
      fase: "baixando",
      versao: base.versao,
      notas: base.notas,
      pct: Math.max(0, Math.min(100, Math.round(p.percent))),
      baixado: p.transferred,
      total: p.total,
      velocidade: p.bytesPerSecond,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    downloading = false;
    log(`Atualização ${info.version} baixada; aguardando o usuário reiniciar.`);
    const notas = state.fase === "disponivel" || state.fase === "baixando" ? state.notas : notesToText(info);
    setState({ fase: "pronta", versao: info.version, notas });
  });

  autoUpdater.on("error", (error) => {
    log("Falha na atualização", error);
    // Erro na verificação em segundo plano não incomoda ninguém; só mostra se estava baixando.
    if (downloading) {
      downloading = false;
      const versao = state.fase === "baixando" || state.fase === "disponivel" ? state.versao : null;
      setState({ fase: "erro", versao, mensagem: "Não foi possível baixar a atualização. Confira a internet e tente de novo." });
    }
  });

  const check = () => {
    if (downloading || state.fase === "pronta") return;
    void autoUpdater.checkForUpdates().catch((error: unknown) => log("Falha ao verificar atualização", error));
  };
  setTimeout(check, 15_000);
  setInterval(check, 4 * 60 * 60 * 1000);
}

/** Começa a baixar. Chamado por "Atualizar agora" e também por "Depois" (em segundo plano). */
export function downloadUpdate() {
  if (downloading || state.fase === "pronta") return true;
  if (state.fase !== "disponivel" && state.fase !== "erro") return false;
  downloading = true;
  if (state.fase === "erro" && state.versao) {
    setState({ fase: "disponivel", versao: state.versao, notas: "", tamanho: 0 });
  }
  void autoUpdater.downloadUpdate().catch(() => undefined); // o erro chega pelo evento "error"
  return true;
}

/** Fecha, instala em silêncio e reabre. Só quando o usuário clica em "Reiniciar agora". */
export function installUpdateNow() {
  if (state.fase !== "pronta") return false;
  // isSilent = true (sem telas do instalador), isForceRunAfter = true (reabre o Mesari)
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return true;
}
