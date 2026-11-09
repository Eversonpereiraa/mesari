/**
 * Mesari Desktop (Electron). Carrega o build do Vite empacotado (app://mesari/) ou, em
 * desenvolvimento, o servidor do Vite (MESARI_DEV_URL). O renderer roda isolado
 * (contextIsolation, sandbox, sem Node) e só fala com o sistema pelas funções do preload.
 */
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  powerSaveBlocker,
  protocol,
  session,
  shell,
  Tray,
  type IpcMainInvokeEvent,
} from "electron";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  listSerialPorts,
  listWindowsPrinters,
  networkTarget,
  run,
  sendNetwork,
  sendSerial,
  sendWindows,
  serialTarget,
  toBuffer,
  windowsTarget,
} from "./printing";
import {
  downloadUpdate,
  installUpdateNow,
  startUpdater,
  updateReadyVersion,
  updateState,
} from "./updater";

type AppSettings = {
  printerNota: string;
  printerComanda: string;
  iniciarComWindows: boolean;
  manterEmSegundoPlano: boolean;
  impedirSuspensao: boolean;
  /** Ao fechar a janela, perguntar "Minimizar para a bandeja" ou "Sair". */
  perguntarAoFechar: boolean;
};

type PrintRequest = { html: string; printerName: string; widthMm: number; copies: number };
type WindowState = { x?: number; y?: number; width?: number; height?: number; maximized?: boolean };

const APP_SCHEME = "app";
const APP_BASE = `${APP_SCHEME}://mesari/`;
const DEV_URL = process.env["MESARI_DEV_URL"]?.replace(/\/?$/, "/");
const START_URL = !app.isPackaged && DEV_URL ? DEV_URL : APP_BASE;
/** Abre direto na tela Mesas (sem sessão, o app manda para o login). */
const HOME_URL = `${START_URL}caixa`;
const LOGIN_ITEM_NAME = "Mesari";
const LOG_MAX_BYTES = 1024 * 1024;
const LOG_BACKUPS = 3;
const MAX_HTML_BYTES = 2 * 1024 * 1024;

app.setName("Mesari");
if (process.platform === "win32") app.setAppUserModelId("com.mesari.app");

// Precisa ser registrado antes do "ready": app:// se comporta como https (origem própria,
// localStorage, fetch e CORS).
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const singleInstance = app.requestSingleInstanceLock();
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitRequested = false;
let powerBlockerId: number | null = null;
let pendingBluetooth: ((deviceId: string) => void) | null = null;

// ---------------------------------------------------------------------------------------------
// Arquivos de dados e log (%APPDATA%\Mesari)

function userDataPath(name: string) {
  return path.join(app.getPath("userData"), name);
}

function rotateLogsIfNeeded(filePath: string) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size < LOG_MAX_BYTES) return;
  for (let index = LOG_BACKUPS - 1; index >= 1; index -= 1) {
    if (fs.existsSync(`${filePath}.${index}`)) {
      fs.renameSync(`${filePath}.${index}`, `${filePath}.${index + 1}`);
    }
  }
  fs.renameSync(filePath, `${filePath}.1`);
}

function log(message: string, error?: unknown) {
  try {
    fs.mkdirSync(userDataPath("logs"), { recursive: true });
    const filePath = userDataPath(path.join("logs", "mesari.log"));
    rotateLogsIfNeeded(filePath);
    const detail =
      error instanceof Error
        ? `${error.message}${error.stack ? `\n${error.stack}` : ""}`
        : error === undefined
          ? ""
          : typeof error === "string"
            ? error
            : JSON.stringify(error);
    fs.appendFileSync(
      filePath,
      `[${new Date().toISOString()}] ${message}${detail ? `: ${detail}` : ""}\n`,
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

// ---------------------------------------------------------------------------------------------
// Configurações do aplicativo

function readSettings(): AppSettings {
  const stored = readJson<Partial<AppSettings>>(userDataPath("settings.json"));
  return {
    printerNota: typeof stored?.printerNota === "string" ? stored.printerNota : "",
    printerComanda: typeof stored?.printerComanda === "string" ? stored.printerComanda : "",
    // Ligado por padrão: a estação de impressão precisa estar aberta para imprimir sozinha.
    iniciarComWindows:
      typeof stored?.iniciarComWindows === "boolean" ? stored.iniciarComWindows : true,
    manterEmSegundoPlano: stored?.manterEmSegundoPlano !== false,
    impedirSuspensao: stored?.impedirSuspensao !== false,
    perguntarAoFechar: stored?.perguntarAoFechar !== false,
  };
}

function applySystemSettings(settings: AppSettings) {
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: settings.iniciarComWindows, name: LOGIN_ITEM_NAME });
    // Remove a entrada antiga (versão 1.0.x usava o nome padrão do Electron).
    app.setLoginItemSettings({ openAtLogin: false });
  }
  if (settings.impedirSuspensao && powerBlockerId === null) {
    powerBlockerId = powerSaveBlocker.start("prevent-app-suspension");
  } else if (!settings.impedirSuspensao && powerBlockerId !== null) {
    powerSaveBlocker.stop(powerBlockerId);
    powerBlockerId = null;
  }
}

function validateSettingsUpdate(value: unknown, current: AppSettings) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Configurações inválidas.");
  }
  const update = value as Partial<AppSettings>;
  const next = { ...current };
  for (const key of ["printerNota", "printerComanda"] as const) {
    const entry = update[key];
    if (entry === undefined) continue;
    if (typeof entry !== "string" || entry.length > 512) throw new Error("Valor inválido.");
    next[key] = entry;
  }
  for (const key of [
    "iniciarComWindows",
    "manterEmSegundoPlano",
    "impedirSuspensao",
    "perguntarAoFechar",
  ] as const) {
    const entry = update[key];
    if (entry === undefined) continue;
    if (typeof entry !== "boolean") throw new Error("Valor inválido.");
    next[key] = entry;
  }
  return next;
}

// ---------------------------------------------------------------------------------------------
// Origem confiável e protocolo app://

function isAppUrl(url: string) {
  return url.startsWith(START_URL) || url === START_URL.replace(/\/$/, "");
}

function isTrustedSender(event: IpcMainInvokeEvent) {
  const url = event.senderFrame?.url ?? "";
  return event.sender === mainWindow?.webContents && isAppUrl(url);
}

function registerAppProtocol() {
  const root = path.join(app.getAppPath(), "app");
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== "mesari") return new Response("Não encontrado", { status: 404 });
    const relative = decodeURIComponent(url.pathname);
    let file = path.normalize(path.join(root, relative));
    if (!file.startsWith(root)) return new Response("Não encontrado", { status: 404 });
    // Rotas do app (/caixa, /impressao...) não são arquivos: devolve o index.html (SPA).
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(root, "index.html");
    }
    return net.fetch(pathToFileURL(file).toString());
  });
}

// ---------------------------------------------------------------------------------------------
// Impressão por HTML (modo "Navegador" no desktop: driver do Windows, sem caixa de diálogo)

function validatePrintRequest(value: unknown): PrintRequest {
  const request = (value ?? {}) as Partial<PrintRequest>;
  if (typeof request.html !== "string" || Buffer.byteLength(request.html) > MAX_HTML_BYTES) {
    throw new Error("Solicitação de impressão inválida.");
  }
  const widthMm = Number(request.widthMm);
  const copies = Number(request.copies);
  if (!Number.isFinite(widthMm) || widthMm < 40 || widthMm > 120) {
    throw new Error("Largura de papel inválida.");
  }
  if (!Number.isInteger(copies) || copies < 1 || copies > 5) throw new Error("Vias inválidas.");
  if (typeof request.printerName !== "string") throw new Error("Impressora inválida.");
  return { html: request.html, printerName: request.printerName, widthMm, copies };
}

async function printHtml(request: PrintRequest) {
  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  try {
    printWindow.webContents.on("will-navigate", (event) => event.preventDefault());
    printWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    await printWindow.loadURL(
      `data:text/html;charset=utf-8;base64,${Buffer.from(request.html, "utf8").toString("base64")}`,
    );
    const height = (await printWindow.webContents.executeJavaScript(
      "document.fonts.ready.then(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))",
    )) as number;
    const printed = await new Promise<boolean>((resolve) => {
      printWindow.webContents.print(
        {
          silent: true,
          deviceName: request.printerName,
          printBackground: true,
          margins: { marginType: "none" },
          pageSize: {
            width: Math.round(request.widthMm * 1000),
            height: Math.max(1000, Math.ceil(height * (25_400 / 96))),
          },
          copies: request.copies,
        },
        (success, reason) => {
          if (!success) log("Erro de impressão (driver)", reason);
          resolve(success);
        },
      );
    });
    return printed ? { ok: true } : { ok: false, error: "O Windows não concluiu a impressão." };
  } catch (cause) {
    log("Erro de impressão (driver)", cause);
    return { ok: false, error: "O Windows não concluiu a impressão." };
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy();
  }
}

// ---------------------------------------------------------------------------------------------
// IPC

function handle(channel: string, handler: (...args: unknown[]) => unknown) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error("Origem não autorizada.");
    return handler(...args);
  });
}

function registerIpc() {
  handle("mesari:app-info", () => ({ versao: app.getVersion(), empacotado: app.isPackaged }));
  handle("mesari:get-settings", () => readSettings());
  handle("mesari:set-settings", (value) => {
    const settings = validateSettingsUpdate(value, readSettings());
    writeJson(userDataPath("settings.json"), settings);
    applySystemSettings(settings);
    return settings;
  });
  handle("mesari:list-printers", async () => {
    if (!mainWindow) return [];
    const printers = await listWindowsPrinters(mainWindow.webContents);
    return printers.map((printer) => ({
      name: printer.nome,
      displayName: printer.nome,
      isDefault: printer.padrao,
    }));
  });
  handle("mesari:print", (value) => printHtml(validatePrintRequest(value)));

  handle("mesari:printer-network", (target, data) =>
    run(async () => {
      const { ip, porta } = networkTarget(target);
      await sendNetwork(ip, porta, toBuffer(data));
    }, log),
  );
  handle("mesari:printer-windows", (target, data) =>
    run(async () => sendWindows(windowsTarget(target), toBuffer(data)), log),
  );
  handle("mesari:printer-serial", (target, data) =>
    run(async () => {
      const { com, baud } = serialTarget(target);
      await sendSerial(com, baud, toBuffer(data));
    }, log),
  );
  handle("mesari:printer-list-windows", async () =>
    mainWindow ? listWindowsPrinters(mainWindow.webContents) : [],
  );
  handle("mesari:printer-list-serial", async () => {
    try {
      return await listSerialPorts();
    } catch (cause) {
      log("Falha ao listar portas COM", cause);
      return [];
    }
  });

  handle("mesari:ble-select", (deviceId) => {
    const callback = pendingBluetooth;
    pendingBluetooth = null;
    callback?.(typeof deviceId === "string" ? deviceId : "");
    return true;
  });

  handle("mesari:update-status", () => ({ versao: updateReadyVersion() }));
  handle("mesari:update-state", () => updateState());
  handle("mesari:update-download", () => downloadUpdate());
  handle("mesari:update-install", () => {
    const ok = installUpdateNow();
    if (ok) quitRequested = true;
    return ok;
  });
}

// ---------------------------------------------------------------------------------------------
// Janela

function persistWindowState(window: BrowserWindow) {
  try {
    const current = readJson<WindowState>(userDataPath("window-state.json")) ?? {};
    const bounds = window.isMaximized() || window.isFullScreen() ? current : window.getBounds();
    writeJson(userDataPath("window-state.json"), {
      ...bounds,
      maximized: window.isMaximized(),
    });
  } catch (cause) {
    log("Falha ao salvar o estado da janela", cause);
  }
}

function openExternal(url: string) {
  try {
    const target = new URL(url);
    if (["https:", "http:", "mailto:", "tel:"].includes(target.protocol)) {
      void shell.openExternal(target.toString()).catch((cause: unknown) => log("Link externo", cause));
    }
  } catch (cause) {
    log("Link externo inválido", cause);
  }
}

function bringToFront() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createMainWindow() {
  const state = readJson<WindowState>(userDataPath("window-state.json"));
  const window = new BrowserWindow({
    width: state?.width ?? 1366,
    height: state?.height ?? 768,
    ...(state?.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}),
    minWidth: 1024,
    minHeight: 640,
    title: "Mesari",
    icon: path.join(app.getAppPath(), "build", "icon.ico"),
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  mainWindow = window;
  window.setMenuBarVisibility(false);
  window.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle("Mesari");
  });

  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F5") {
      event.preventDefault();
      window.webContents.reload();
    } else if (input.key === "F11") {
      event.preventDefault();
      window.setFullScreen(!window.isFullScreen());
    } else if (input.control && input.shift && input.key.toLowerCase() === "i") {
      event.preventDefault();
      if (!app.isPackaged) window.webContents.toggleDevTools();
    } else if (input.control && (input.key === "+" || input.key === "=")) {
      event.preventDefault();
      window.webContents.setZoomLevel(Math.min(5, window.webContents.getZoomLevel() + 0.5));
    } else if (input.control && input.key === "-") {
      event.preventDefault();
      window.webContents.setZoomLevel(Math.max(-5, window.webContents.getZoomLevel() - 0.5));
    } else if (input.control && input.key === "0") {
      event.preventDefault();
      window.webContents.setZoomLevel(0);
    }
  });

  // Links externos abrem no navegador padrão, nunca numa janela do app.
  window.webContents.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openExternal(url);
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAppUrl(url)) openExternal(url);
    return { action: "deny" };
  });

  // Web Bluetooth (BLE): o Electron não tem seletor próprio; a lista vai para o app escolher.
  window.webContents.on("select-bluetooth-device", (event, devices, callback) => {
    event.preventDefault();
    pendingBluetooth = callback;
    window.webContents.send(
      "mesari:ble-devices",
      devices.map((device) => ({ id: device.deviceId, nome: device.deviceName || "" })),
    );
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    log("Processo de renderização encerrado", details);
    if (!window.isDestroyed()) void window.loadURL(HOME_URL);
  });
  window.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== -3) log(`Falha ao carregar ${url}`, `${code} ${description}`);
  });

  window.on("close", (event) => {
    persistWindowState(window);
    if (quitRequested) return;
    const settings = readSettings();
    if (settings.perguntarAoFechar) {
      event.preventDefault();
      void askOnClose(window);
      return;
    }
    if (settings.manterEmSegundoPlano) {
      event.preventDefault();
      hideToTray(window);
    }
  });
  window.on("resized", () => persistWindowState(window));
  window.on("moved", () => persistWindowState(window));
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  window.once("ready-to-show", () => {
    if (state?.maximized !== false) window.maximize();
    window.show();
  });
  void window.loadURL(HOME_URL);
}

let trayHintShown = false;

/** Esconde a janela; a estação de impressão continua rodando (backgroundThrottling desligado). */
function hideToTray(window: BrowserWindow) {
  window.hide();
  if (!trayHintShown && tray && process.platform === "win32") {
    trayHintShown = true;
    tray.displayBalloon({
      iconType: "info",
      title: "Mesari continua imprimindo",
      content: "O Mesari está na bandeja e segue imprimindo as comandas. Clique no ícone para abrir.",
    });
  }
}

let closePromptOpen = false;

async function askOnClose(window: BrowserWindow) {
  if (closePromptOpen) return;
  closePromptOpen = true;
  try {
    const { response, checkboxChecked } = await dialog.showMessageBox(window, {
      type: "question",
      title: "Fechar o Mesari",
      message: "O que você quer fazer?",
      detail: "Na bandeja, o Mesari continua imprimindo as comandas e as contas.",
      buttons: ["Minimizar para a bandeja (continua imprimindo)", "Sair"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      checkboxLabel: "Lembrar a escolha e não perguntar de novo",
    });
    const quit = response === 1;
    if (checkboxChecked) {
      const settings = { ...readSettings(), perguntarAoFechar: false, manterEmSegundoPlano: !quit };
      writeJson(userDataPath("settings.json"), settings);
    }
    if (quit) {
      quitRequested = true;
      app.quit();
    } else if (!window.isDestroyed()) {
      hideToTray(window);
    }
  } catch (cause) {
    log("Falha ao perguntar ao fechar", cause);
    if (!window.isDestroyed()) hideToTray(window);
  } finally {
    closePromptOpen = false;
  }
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(app.getAppPath(), "build", "icon.ico")));
  tray.setToolTip("Mesari · estação de impressão");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Abrir Mesari", click: bringToFront },
      {
        label: "Abrir pasta de logs",
        click: () => {
          fs.mkdirSync(userDataPath("logs"), { recursive: true });
          void shell.openPath(userDataPath("logs"));
        },
      },
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

function configureSession() {
  const allowed = new Set(["notifications", "clipboard-sanitized-write", "bluetooth"]);
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) =>
    callback(isAppUrl(details.requestingUrl) && allowed.has(permission)),
  );
  session.defaultSession.setPermissionCheckHandler((_contents, permission, origin) =>
    Boolean(origin && isAppUrl(origin.endsWith("/") ? origin : `${origin}/`) && allowed.has(permission)),
  );
  // Pareamento BLE que pede só confirmação: aceita (o usuário já escolheu o aparelho).
  session.defaultSession.setBluetoothPairingHandler((details, callback) => {
    callback({ confirmed: details.pairingKind === "confirm" });
  });
}

if (!singleInstance) {
  app.quit();
} else {
  app.on("second-instance", bringToFront);
  void app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    registerAppProtocol();
    configureSession();
    registerIpc();
    const settings = readSettings();
    applySystemSettings(settings);
    createMainWindow();
    createTray();
    startUpdater(() => mainWindow, log);
    log(`Mesari ${app.getVersion()} iniciado (${START_URL}).`);
  });
  app.on("window-all-closed", () => {
    if (!readSettings().manterEmSegundoPlano) app.quit();
  });
  app.on("before-quit", () => {
    quitRequested = true;
    if (powerBlockerId !== null) powerSaveBlocker.stop(powerBlockerId);
  });
  process.on("uncaughtException", (cause) => log("Exceção não tratada", cause));
  process.on("unhandledRejection", (cause) => log("Rejeição não tratada", cause));
}
