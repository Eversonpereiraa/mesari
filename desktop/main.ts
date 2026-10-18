import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  powerSaveBlocker,
  session,
  shell,
  Tray,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type AppSettings = {
  printerNota: string;
  printerComanda: string;
  iniciarComWindows: boolean;
  manterEmSegundoPlano: boolean;
  impedirSuspensao: boolean;
};

type PrintKind = "comanda" | "recibo" | "teste";

type PrintRequest = {
  html: string;
  printerName: string;
  widthMm: number;
  copies: number;
  tipo?: PrintKind;
};

type PrinterInfo = {
  name: string;
  displayName: string;
  isDefault: boolean;
};

type SavedDevicePermissions = {
  serial: { portIds: string[]; instanceIds: string[] };
  usb: string[];
};

const DEFAULT_SETTINGS: AppSettings = {
  printerNota: "",
  printerComanda: "",
  iniciarComWindows: true,
  manterEmSegundoPlano: true,
  impedirSuspensao: true,
};
/** Impressora especial: salva PDF em %APPDATA%/Mesari/impressoes, sem diálogo. */
const VIRTUAL_PDF_PRINTER = "Mesari - Impressora virtual (PDF)";
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const PRINT_TIMEOUT_MS = 30_000;
const LOG_MAX_BYTES = 1024 * 1024;
const LOG_BACKUPS = 3;
app.setName("Mesari");
const singleInstance = app.requestSingleInstanceLock();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitRequested = false;
let retryTimer: NodeJS.Timeout | null = null;
let powerBlockerId: number | null = null;
let showingOffline = false;
let appUrl = "https://design-driven-orders.vercel.app/";
let appOrigin = new URL(appUrl).origin;
let printQueue: Promise<void> = Promise.resolve();

function userDataPath(name: string) {
  return path.join(app.getPath("userData"), name);
}

function readDevicePermissions(): SavedDevicePermissions {
  const value = readJson<Partial<SavedDevicePermissions>>(userDataPath("device-permissions.json"));
  return {
    serial: {
      portIds: Array.isArray(value?.serial?.portIds)
        ? value.serial.portIds.filter((id): id is string => typeof id === "string")
        : [],
      instanceIds: Array.isArray(value?.serial?.instanceIds)
        ? value.serial.instanceIds.filter((id): id is string => typeof id === "string")
        : [],
    },
    usb: Array.isArray(value?.usb)
      ? value.usb.filter((id): id is string => typeof id === "string")
      : [],
  };
}

function saveDevicePermission(
  type: "serial" | "usb",
  device: Electron.SerialPort | Electron.USBDevice,
) {
  const permissions = readDevicePermissions();
  if (type === "serial") {
    const port = device as Electron.SerialPort;
    permissions.serial = {
      portIds: [port.portId],
      instanceIds: port.deviceInstanceId ? [port.deviceInstanceId] : [],
    };
  } else {
    const usb = device as Electron.USBDevice;
    permissions.usb = [usb.deviceId];
  }
  writeJson(userDataPath("device-permissions.json"), permissions);
}

function forgetDevicePermissions(type: "serial" | "usb") {
  const permissions = readDevicePermissions();
  if (type === "serial") {
    permissions.serial = { portIds: [], instanceIds: [] };
  } else {
    permissions.usb = [];
  }
  writeJson(userDataPath("device-permissions.json"), permissions);
}

function isTrustedOrigin(url: string) {
  try {
    return new URL(url).origin === appOrigin;
  } catch {
    return false;
  }
}

async function chooseDevice(title: string, devices: Array<{ id: string; label: string }>) {
  if (devices.length === 0) return undefined;
  const labels = devices.map((device) => device.label || device.id);
  const options: Electron.MessageBoxOptions = {
    type: "question",
    title,
    message: "Selecione o dispositivo que deseja conectar.",
    buttons: [...labels, "Cancelar"],
    cancelId: labels.length,
    defaultId: 0,
    noLink: true,
  };
  const result = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  return result.response < devices.length ? devices[result.response] : undefined;
}

function installDeviceHandlers() {
  session.defaultSession.on("select-serial-port", (event, ports, sender, callback) => {
    event.preventDefault();
    if (sender !== mainWindow?.webContents || !isTrustedOrigin(sender.getURL())) {
      callback("");
      return;
    }
    void chooseDevice(
      "Conectar impressora Bluetooth/COM",
      ports.map((port) => ({
        id: port.portId,
        label: [port.displayName, port.portName].filter(Boolean).join(" · "),
      })),
    )
      .then((selected) => {
        if (!selected) {
          callback("");
          return;
        }
        const port = ports.find((item) => item.portId === selected.id);
        if (!port) {
          callback("");
          return;
        }
        saveDevicePermission("serial", port);
        callback(port.portId);
      })
      .catch((cause: unknown) => {
        log("Falha ao selecionar a porta serial", cause);
        callback("");
      });
  });
  session.defaultSession.on("select-usb-device", (event, details, callback) => {
    event.preventDefault();
    if (
      !details.frame ||
      details.frame !== mainWindow?.webContents.mainFrame ||
      !isTrustedOrigin(details.frame.url)
    ) {
      callback();
      return;
    }
    void chooseDevice(
      "Conectar impressora USB",
      details.deviceList.map((device) => ({
        id: device.deviceId,
        label: [
          device.productName,
          device.manufacturerName,
          `USB ${device.vendorId.toString(16)}:${device.productId.toString(16)}`,
        ]
          .filter(Boolean)
          .join(" · "),
      })),
    )
      .then((selected) => {
        if (!selected) {
          callback();
          return;
        }
        const device = details.deviceList.find((item) => item.deviceId === selected.id);
        if (!device) {
          callback();
          return;
        }
        saveDevicePermission("usb", device);
        callback(device.deviceId);
      })
      .catch((cause: unknown) => {
        log("Falha ao selecionar o dispositivo USB", cause);
        callback();
      });
  });
}

function rotateLogsIfNeeded(filePath: string) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size < LOG_MAX_BYTES) return;
  for (let index = LOG_BACKUPS - 1; index >= 1; index -= 1) {
    const oldPath = `${filePath}.${index}`;
    const nextPath = `${filePath}.${index + 1}`;
    if (fs.existsSync(oldPath)) fs.renameSync(oldPath, nextPath);
  }
  fs.renameSync(filePath, `${filePath}.1`);
}

function log(message: string, error?: unknown) {
  try {
    const logDirectory = userDataPath("logs");
    fs.mkdirSync(logDirectory, { recursive: true });
    const filePath = path.join(logDirectory, "mesari.log");
    rotateLogsIfNeeded(filePath);
    const detail =
      error instanceof Error ? `${error.message}${error.stack ? `\n${error.stack}` : ""}` : error;
    fs.appendFileSync(
      filePath,
      `[${new Date().toISOString()}] ${message}${detail ? `: ${String(detail)}` : ""}\n`,
      "utf8",
    );
  } catch (cause) {
    console.error("Não foi possível gravar o log do Mesari.", cause);
  }
}

function readJson<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch (cause) {
    log(`Falha ao ler ${path.basename(filePath)}`, cause);
    return null;
  }
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function loadAppUrl() {
  const userConfig = readJson<{ appUrl?: unknown }>(userDataPath("config.json"));
  const bundledConfig = readJson<{ appUrl?: unknown }>(path.join(app.getAppPath(), "config.json"));
  for (const configuredUrl of [userConfig?.appUrl, bundledConfig?.appUrl]) {
    if (configuredUrl === undefined) continue;
    try {
      if (typeof configuredUrl !== "string") {
        throw new Error("appUrl deve ser um endereço HTTPS válido.");
      }
      const parsed = new URL(configuredUrl);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
        throw new Error("appUrl deve ser um endereço HTTPS válido.");
      }
      appUrl = parsed.toString();
      appOrigin = parsed.origin;
      return;
    } catch (cause) {
      log("Configuração appUrl inválida; tentando a próxima configuração.", cause);
    }
  }
  log("Configuração appUrl ausente; usando o endereço padrão.");
}

function readSettings(): AppSettings {
  const stored = readJson<Partial<AppSettings>>(userDataPath("settings.json"));
  return {
    ...DEFAULT_SETTINGS,
    printerNota:
      typeof stored?.printerNota === "string" ? stored.printerNota : DEFAULT_SETTINGS.printerNota,
    printerComanda:
      typeof stored?.printerComanda === "string"
        ? stored.printerComanda
        : DEFAULT_SETTINGS.printerComanda,
    iniciarComWindows: stored?.iniciarComWindows !== false,
    manterEmSegundoPlano: stored?.manterEmSegundoPlano !== false,
    impedirSuspensao: stored?.impedirSuspensao !== false,
  };
}

function updateSystemSettings(settings: AppSettings) {
  app.setLoginItemSettings({ openAtLogin: settings.iniciarComWindows });
  if (settings.impedirSuspensao && powerBlockerId === null) {
    powerBlockerId = powerSaveBlocker.start("prevent-app-suspension");
  } else if (!settings.impedirSuspensao && powerBlockerId !== null) {
    powerSaveBlocker.stop(powerBlockerId);
    powerBlockerId = null;
  }
}

function validateSender(event: IpcMainInvokeEvent) {
  const url = event.senderFrame?.url;
  if (!url) return false;
  try {
    return new URL(url).origin === appOrigin;
  } catch {
    return false;
  }
}

function registerHandler(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!validateSender(event))
      throw new Error("Origem não autorizada para comunicação com o app.");
    return handler(event, ...args);
  });
}

function enqueuePrint(job: () => Promise<{ ok: boolean; error?: string }>) {
  const result = printQueue.then(job, job);
  printQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function timeout<T>(promise: Promise<T>, milliseconds: number, label: string) {
  let timer: NodeJS.Timeout;
  const timed = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(label)), milliseconds);
    promise.then(resolve, reject);
  });
  return timed.finally(() => clearTimeout(timer));
}

function waitForLoad(contents: WebContents) {
  return new Promise<void>((resolve, reject) => {
    const onLoad = () => {
      contents.removeListener("did-fail-load", onFail);
      resolve();
    };
    const onFail = (
      _event: Electron.Event,
      code: number,
      description: string,
      _url: string,
      isMainFrame: boolean,
    ) => {
      if (!isMainFrame) return;
      contents.removeListener("did-finish-load", onLoad);
      reject(new Error(`Falha ao carregar o documento de impressão (${code}): ${description}`));
    };
    contents.once("did-finish-load", onLoad);
    contents.on("did-fail-load", onFail);
  });
}

function validatePrintRequest(value: unknown): { request?: PrintRequest; error?: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { error: "Solicitação de impressão inválida." };
  }
  const request = value as Partial<PrintRequest>;
  if (
    typeof request.html !== "string" ||
    Buffer.byteLength(request.html, "utf8") > MAX_HTML_BYTES
  ) {
    return { error: "O HTML deve ter no máximo 2 MB." };
  }
  if (
    !Number.isFinite(request.widthMm) ||
    Number(request.widthMm) < 40 ||
    Number(request.widthMm) > 120
  ) {
    return { error: "A largura do papel deve estar entre 40 e 120 mm." };
  }
  if (
    !Number.isInteger(request.copies) ||
    Number(request.copies) < 1 ||
    Number(request.copies) > 5
  ) {
    return { error: "O número de vias deve estar entre 1 e 5." };
  }
  if (typeof request.printerName !== "string") {
    return { error: "Nome de impressora inválido." };
  }
  const tipo =
    request.tipo === "comanda" || request.tipo === "recibo" || request.tipo === "teste"
      ? request.tipo
      : undefined;
  return {
    request: {
      html: request.html,
      printerName: request.printerName,
      widthMm: Number(request.widthMm),
      copies: Number(request.copies),
      ...(tipo ? { tipo } : {}),
    },
  };
}

async function printHtml(request: PrintRequest) {
  let printWindow: BrowserWindow | null = null;
  const startedAt = Date.now();
  const remainingTimeout = () => Math.max(1, PRINT_TIMEOUT_MS - (Date.now() - startedAt));
  try {
    const printers =
      (await timeout(
        mainWindow?.webContents.getPrintersAsync() ?? Promise.resolve([]),
        remainingTimeout(),
        "Tempo esgotado ao consultar as impressoras.",
      )) ?? [];
    const virtualPdf = request.printerName === VIRTUAL_PDF_PRINTER;
    if (
      request.printerName &&
      !virtualPdf &&
      !printers.some((printer) => printer.name === request.printerName)
    ) {
      throw new Error("A impressora selecionada não está disponível.");
    }
    printWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    printWindow.webContents.on("will-navigate", (event) => event.preventDefault());
    printWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const loaded = waitForLoad(printWindow.webContents);
    const dataUrl = `data:text/html;charset=utf-8;base64,${Buffer.from(request.html, "utf8").toString("base64")}`;
    await timeout(
      printWindow.loadURL(dataUrl).then(() => loaded),
      remainingTimeout(),
      "Tempo esgotado ao carregar o cupom.",
    );
    const contentHeight = (await printWindow.webContents.executeJavaScript(
      "Promise.all([document.fonts?.ready ?? Promise.resolve(), ...Array.from(document.images, image => image.decode().catch(() => undefined))]).then(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))",
    )) as number;
    const heightMicrons = Math.max(1000, Math.ceil(contentHeight * (25_400 / 96)));
    if (virtualPdf) {
      const files = await savePdf(printWindow.webContents, request, heightMicrons);
      log(`Impressão virtual salva em PDF: ${files.join(", ")}`);
      return { ok: true };
    }
    const printed = await timeout(
      new Promise<boolean>((resolve) => {
        printWindow?.webContents.print(
          {
            silent: true,
            deviceName: request.printerName,
            printBackground: true,
            margins: { marginType: "none" },
            pageSize: { width: Math.round(request.widthMm * 1000), height: heightMicrons },
            scaleFactor: 100,
            copies: request.copies,
          },
          (success, failureReason) => {
            if (!success) {
              log("Erro de impressão", failureReason);
              resolve(false);
              return;
            }
            resolve(true);
          },
        );
      }),
      remainingTimeout(),
      "Tempo esgotado aguardando o driver da impressora.",
    );
    if (!printed) return { ok: false, error: "O driver do Windows não concluiu a impressão." };
    log(
      `Impressão concluída (${request.printerName || "padrão"}, ${request.widthMm} mm, ${request.copies} via(s)) em ${Date.now() - startedAt} ms`,
    );
    return { ok: true };
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    log("Erro de impressão", cause);
    return { ok: false, error };
  } finally {
    if (printWindow && !printWindow.isDestroyed()) printWindow.destroy();
  }
}

function printsFolder() {
  return userDataPath("impressoes");
}

/** Deduz o tipo quando o site (versão antiga) não informa: pela impressora escolhida. */
function printKind(request: PrintRequest): PrintKind | "impressao" {
  if (request.tipo) return request.tipo;
  const settings = readSettings();
  if (request.printerName === settings.printerComanda) return "comanda";
  if (request.printerName === settings.printerNota) return "recibo";
  return "impressao";
}

async function savePdf(contents: WebContents, request: PrintRequest, heightMicrons: number) {
  const pdf = await contents.printToPDF({
    printBackground: true,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    // printToPDF usa polegadas.
    pageSize: { width: request.widthMm / 25.4, height: heightMicrons / 25_400 },
  });
  fs.mkdirSync(printsFolder(), { recursive: true });
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const kind = printKind(request);
  const files: string[] = [];
  for (let copy = 1; copy <= request.copies; copy += 1) {
    const base = `${stamp}_${kind}${request.copies > 1 ? `_via${copy}` : ""}`;
    let filePath = path.join(printsFolder(), `${base}.pdf`);
    // Duas impressões no mesmo segundo não se sobrescrevem.
    for (let extra = 2; fs.existsSync(filePath); extra += 1) {
      filePath = path.join(printsFolder(), `${base}-${extra}.pdf`);
    }
    fs.writeFileSync(filePath, pdf);
    files.push(filePath);
  }
  return files;
}

function openPrintsFolder() {
  fs.mkdirSync(printsFolder(), { recursive: true });
  void shell.openPath(printsFolder()).then((result) => {
    if (result) log("Falha ao abrir a pasta de impressões", result);
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

function printerTestHtml(restaurantName: string, widthMm: number) {
  const time = new Date().toLocaleString("pt-BR");
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;width:100%}body{font:14px Arial,sans-serif;color:#000;text-align:center;padding:3mm}h1{font-size:20px;margin:0 0 6mm}p{margin:3mm 0}.ruler{height:12mm;background:repeating-linear-gradient(90deg,#000 0 1px,transparent 1px 5%);border-top:1px solid #000}.ruler-label{font-size:10px}</style></head><body><h1>${escapeHtml(restaurantName)}</h1><div class="ruler"></div><p class="ruler-label">Régua de largura: 0 a ${widthMm} mm</p><p>Teste de impressão · ã, õ, ç, é, í, ó, ú</p><p>${time}</p></body></html>`;
}

function applyZoomShortcuts(window: BrowserWindow) {
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F11") {
      event.preventDefault();
      window.setFullScreen(!window.isFullScreen());
      return;
    }
    if (!input.control) return;
    const current = window.webContents.getZoomLevel();
    if (input.key === "+" || input.key === "=") {
      event.preventDefault();
      window.webContents.setZoomLevel(Math.min(5, current + 0.5));
    } else if (input.key === "-") {
      event.preventDefault();
      window.webContents.setZoomLevel(Math.max(-5, current - 0.5));
    } else if (input.key === "0") {
      event.preventDefault();
      window.webContents.setZoomLevel(0);
    } else {
      return;
    }
    writeJson(userDataPath("zoom.json"), { level: window.webContents.getZoomLevel() });
  });
}

function persistWindowState(window: BrowserWindow) {
  const filePath = userDataPath("window-state.json");
  const current = readJson<{ x?: number; y?: number; width?: number; height?: number }>(filePath);
  const state = window.isMaximized()
    ? (current ?? { width: 1200, height: 800 })
    : { ...window.getBounds() };
  try {
    writeJson(filePath, { ...state, maximized: window.isMaximized() });
  } catch (cause) {
    log("Falha ao salvar o estado da janela", cause);
  }
}

function offlinePageUrl() {
  return `${pathToFileURL(path.join(app.getAppPath(), "offline.html")).toString()}?appUrl=${encodeURIComponent(appUrl)}`;
}

function scheduleRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) void loadApp();
  }, 10_000);
}

async function showOffline(cause?: unknown) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (showingOffline) return;
  showingOffline = true;
  if (cause) log("Falha ao carregar o sistema", cause);
  try {
    await mainWindow.loadURL(offlinePageUrl());
  } catch (loadError) {
    log("Falha ao abrir a tela offline", loadError);
  }
  scheduleRetry();
}

async function loadApp() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  showingOffline = false;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  try {
    await mainWindow.loadURL(appUrl);
  } catch (cause) {
    await showOffline(cause);
  }
}

function bringToFront() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createMainWindow() {
  const state = readJson<{
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    maximized?: boolean;
  }>(userDataPath("window-state.json"));
  const defaults = { width: 1200, height: 800 };
  const bounds =
    state?.width && state.height
      ? { x: state.x, y: state.y, width: state.width, height: state.height }
      : defaults;
  const iconPath = path.join(app.getAppPath(), "build", "icon.ico");
  mainWindow = new BrowserWindow({
    ...bounds,
    title: "Mesari",
    icon: iconPath,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(app.getAppPath(), "dist", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    mainWindow?.setTitle("Mesari");
  });
  applyZoomShortcuts(mainWindow);
  mainWindow.webContents.on("will-navigate", (event, url) => {
    try {
      const target = new URL(url);
      if (target.origin !== appOrigin) {
        event.preventDefault();
        if (target.protocol === "https:") {
          void shell
            .openExternal(target.toString())
            .catch((cause: unknown) => log("Falha ao abrir link externo", cause));
        }
      }
    } catch {
      event.preventDefault();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (new URL(url).protocol === "https:" && new URL(url).origin !== appOrigin) {
        void shell
          .openExternal(url)
          .catch((cause: unknown) => log("Falha ao abrir link externo", cause));
      }
    } catch (cause) {
      log("URL externa inválida", cause);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) void showOffline(new Error(`${code}: ${description}`));
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    log("Processo de renderização encerrado", details);
    void showOffline(new Error(details.reason));
  });
  mainWindow.on("close", (event) => {
    if (!quitRequested && readSettings().manterEmSegundoPlano) {
      event.preventDefault();
      mainWindow?.hide();
      return;
    }
    persistWindowState(mainWindow!);
  });
  mainWindow.on("resize", () => {
    if (mainWindow) persistWindowState(mainWindow);
  });
  mainWindow.on("move", () => {
    if (mainWindow) persistWindowState(mainWindow);
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.once("ready-to-show", () => {
    if (state?.maximized !== false) mainWindow?.maximize();
    mainWindow?.show();
  });
  mainWindow.webContents.once("did-finish-load", () => {
    const savedZoom = readJson<{ level?: number }>(userDataPath("zoom.json"));
    if (typeof savedZoom?.level === "number" && Number.isFinite(savedZoom.level)) {
      mainWindow?.webContents.setZoomLevel(Math.max(-5, Math.min(5, savedZoom.level)));
    }
  });
  void loadApp();
}

function openLogFolder() {
  fs.mkdirSync(userDataPath("logs"), { recursive: true });
  void shell.openPath(userDataPath("logs")).then((result) => {
    if (result) log("Falha ao abrir a pasta de logs", result);
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(app.getAppPath(), "build", "icon.ico"));
  tray = new Tray(icon);
  tray.setToolTip("Mesari");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Abrir Mesari", click: bringToFront },
      {
        label: "Imprimir página de teste",
        click: () => {
          const settings = readSettings();
          void enqueuePrint(() =>
            printHtml({
              html: printerTestHtml("Mesari", 80),
              printerName: settings.printerNota,
              widthMm: 80,
              copies: 1,
              tipo: "teste",
            }),
          );
        },
      },
      { label: "Abrir pasta de logs", click: openLogFolder },
      { label: "Abrir pasta de impressões", click: openPrintsFolder },
      { type: "separator" },
      {
        label: "Sair",
        click: () => {
          quitRequested = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", bringToFront);
}

function validateSettingsUpdate(value: unknown, current: AppSettings) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Configurações inválidas.");
  }
  const update = value as Partial<AppSettings>;
  const next = { ...current };
  for (const key of ["printerNota", "printerComanda"] as const) {
    if (update[key] !== undefined) {
      if (typeof update[key] !== "string" || update[key].length > 512) {
        throw new Error(`Valor inválido para ${key}.`);
      }
      next[key] = update[key];
    }
  }
  for (const key of ["iniciarComWindows", "manterEmSegundoPlano", "impedirSuspensao"] as const) {
    if (update[key] !== undefined) {
      if (typeof update[key] !== "boolean") throw new Error(`Valor inválido para ${key}.`);
      next[key] = update[key];
    }
  }
  return next;
}

function registerIpcHandlers() {
  installDeviceHandlers();
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      let allowedOrigin = false;
      try {
        allowedOrigin = new URL(details.requestingUrl).origin === appOrigin;
      } catch {
        allowedOrigin = false;
      }
      callback(
        allowedOrigin &&
          (permission === "notifications" ||
            permission === "clipboard-sanitized-write" ||
            permission === "serial" ||
            permission === "usb"),
      );
    },
  );
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, origin) => {
    try {
      return (
        new URL(origin).origin === appOrigin &&
        (permission === "notifications" ||
          permission === "clipboard-sanitized-write" ||
          permission === "serial" ||
          permission === "usb")
      );
    } catch {
      return false;
    }
  });
  session.defaultSession.setDevicePermissionHandler(({ origin, deviceType, device }) => {
    if (!isTrustedOrigin(origin)) return false;
    const permissions = readDevicePermissions();
    if (deviceType === "serial") {
      const port = device as Electron.SerialPort;
      return (
        permissions.serial.portIds.includes(port.portId) ||
        Boolean(
          port.deviceInstanceId && permissions.serial.instanceIds.includes(port.deviceInstanceId),
        )
      );
    }
    if (deviceType === "usb") {
      return permissions.usb.includes((device as Electron.USBDevice).deviceId);
    }
    return false;
  });

  registerHandler("mesari:list-printers", async () => {
    if (!mainWindow) return [] as PrinterInfo[];
    const printers = await mainWindow.webContents.getPrintersAsync();
    const defaultPrinter = printers.find((printer) => {
      const isDefault = Reflect.get(printer, "isDefault");
      const optionIsDefault = Reflect.get(printer.options, "isDefault");
      return isDefault === true || optionIsDefault === true || optionIsDefault === "true";
    });
    return [
      ...printers.map((printer) => ({
        name: printer.name,
        displayName: printer.displayName,
        isDefault: printer.name === defaultPrinter?.name,
      })),
      { name: VIRTUAL_PDF_PRINTER, displayName: VIRTUAL_PDF_PRINTER, isDefault: false },
    ];
  });
  registerHandler("mesari:get-settings", () => readSettings());
  registerHandler("mesari:set-settings", (_event, value) => {
    const settings = validateSettingsUpdate(value, readSettings());
    writeJson(userDataPath("settings.json"), settings);
    updateSystemSettings(settings);
    log("Configurações do aplicativo atualizadas.");
    return settings;
  });
  registerHandler("mesari:forget-direct-device", (_event, value) => {
    if (value !== "serial" && value !== "usb") {
      throw new Error("Tipo de conexão direta inválido.");
    }
    forgetDevicePermissions(value);
    return { ok: true };
  });
  registerHandler("mesari:print", async (_event, value) => {
    const validation = validatePrintRequest(value);
    if (!validation.request) {
      log("Solicitação de impressão inválida", validation.error);
      return { ok: false, error: validation.error };
    }
    const request = validation.request;
    return enqueuePrint(() => printHtml(request));
  });
  registerHandler("mesari:test-print", async (_event, value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { ok: false, error: "Solicitação de teste inválida." };
    }
    const request = value as {
      printerName?: unknown;
      widthMm?: unknown;
      restaurantName?: unknown;
    };
    if (
      typeof request.restaurantName !== "string" ||
      request.restaurantName.trim().length === 0 ||
      request.restaurantName.length > 200
    ) {
      return { ok: false, error: "Informe o nome do restaurante para o teste." };
    }
    const validation = validatePrintRequest({
      html: printerTestHtml(request.restaurantName, Number(request.widthMm)),
      printerName: request.printerName,
      widthMm: request.widthMm,
      copies: 1,
      tipo: "teste",
    });
    if (!validation.request) {
      log("Solicitação de teste inválida", validation.error);
      return { ok: false, error: validation.error };
    }
    const validRequest = validation.request;
    return enqueuePrint(() => printHtml(validRequest));
  });
}

if (!singleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => bringToFront());
  app.whenReady().then(() => {
    loadAppUrl();
    const settings = readSettings();
    updateSystemSettings(settings);
    registerIpcHandlers();
    createMainWindow();
    createTray();
    log(`Mesari iniciado (${appUrl}).`);
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
      else bringToFront();
    });
    app.on("window-all-closed", () => {
      if (process.platform !== "darwin" && !readSettings().manterEmSegundoPlano) app.quit();
    });
  });
  app.on("before-quit", () => {
    quitRequested = true;
    if (retryTimer) clearTimeout(retryTimer);
    if (powerBlockerId !== null) powerSaveBlocker.stop(powerBlockerId);
  });
  process.on("uncaughtException", (cause) => log("Exceção não tratada", cause));
  process.on("unhandledRejection", (cause) => log("Rejeição não tratada", cause));
}
