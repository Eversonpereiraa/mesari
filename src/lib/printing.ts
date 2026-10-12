import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import receiptFontRegularUrl from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?url";
import receiptFontBoldUrl from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-700-normal.woff2?url";
import defaultReceiptLogo from "@/assets/branding/logo-mesari-preto.png?url";
import receiptStyles from "@/components/receipt-content.css?inline";
import { ReceiptContent } from "@/components/receipt-content";

export type PrintSettings = {
  paperWidth: 58 | 80;
  columns: number;
  fontSize: "small" | "normal" | "large";
  copies: 1 | 2;
  autoPrintOnClose: boolean;
  showKitchenPrices: boolean;
  printKitchenEnabled: boolean;
  cutPaper: boolean;
  openCashDrawer: boolean;
  characterTable: "CP860" | "CP850" | "WPC1252";
  baudRate: 9600 | 19200 | 38400 | 57600 | 115200;
  printerMode: "direct" | "browser";
  printerConnected: boolean;
  printerName?: string;
  printerDeviceId?: string;
  connectionType?: "serial" | "usb";
};

export type PrintReceipt = {
  id: string;
  at: number;
  table: number;
  saleNumber: number;
  lines: {
    id: string;
    name: string;
    qty: number;
    price: number;
    note: string;
    waiter: string;
  }[];
  subtotal: number;
  serviceCharge: number;
  total: number;
  payments?: {
    forma: "dinheiro" | "pix" | "credito" | "debito" | "nao_informado";
    valor: number;
    recebido?: number;
    troco?: number;
  }[];
  partial?: boolean;
  reprint?: boolean;
  origin?: "mesa" | "entrega" | "retirada" | "balcao";
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  deliveryFee?: number;
  discount?: number;
};

export type PrintRestaurant = {
  name: string;
  address: string;
  phone: string;
  cnpj: string;
  instagram: string;
  logo?: string;
};

export type KitchenTicket = {
  id: string;
  number: number;
  table: number | null;
  sector: "cozinha" | "bar";
  waiter: string;
  additional: boolean;
  createdAt: number;
  items: { product: string; quantity: number; note: string; unitPrice?: number }[];
  external?: {
    origin: "entrega" | "retirada";
    dayNumber: number;
    channel: "whatsapp" | "telefone" | "papel" | string;
    customerName: string;
    phone: string;
    address: string;
    observation: string;
    subtotal: number;
    deliveryFee: number;
    total: number;
    payment: { forma: string | null; pago: boolean; trocoPara: number | null };
  };
};

export type PrinterStatus = {
  supported: boolean;
  connected: boolean;
  name: string;
  error: string | null;
  connectionType?: "serial" | "usb" | undefined;
  vendorId?: number | undefined;
  productId?: number | undefined;
  productName?: string | undefined;
};

type SerialInfo = { usbVendorId?: number; usbProductId?: number };
type SerialPort = {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  getInfo: () => SerialInfo;
};
type SerialApi = {
  getPorts: () => Promise<SerialPort[]>;
  requestPort: (options?: { filters: { usbVendorId?: number }[] }) => Promise<SerialPort>;
  addEventListener: (type: "disconnect" | "connect", listener: (event: Event) => void) => void;
};
type UsbEndpoint = { direction: "in" | "out"; type: string; endpointNumber: number };
type UsbInterface = {
  interfaceNumber: number;
  alternate: { interfaceClass: number; endpoints: UsbEndpoint[] };
  claimed?: boolean;
};
type UsbDevice = {
  vendorId: number;
  productId: number;
  productName?: string;
  configuration: { interfaces: UsbInterface[] } | null;
  opened: boolean;
  open: () => Promise<void>;
  close: () => Promise<void>;
  selectConfiguration: (configurationValue: number) => Promise<void>;
  claimInterface: (interfaceNumber: number) => Promise<void>;
  transferOut: (endpointNumber: number, data: BufferSource) => Promise<{ status: string }>;
  forget?: () => Promise<void>;
};
type UsbApi = {
  getDevices: () => Promise<UsbDevice[]>;
  requestDevice: (options: { filters: { classCode?: number }[] }) => Promise<UsbDevice>;
  addEventListener: (type: "connect" | "disconnect", listener: (event: Event) => void) => void;
};

const SETTINGS_KEY = "mesari-print-settings";
const KITCHEN_CONFIGURED_KEY = "mesari-kitchen-configured";
const DEFAULT_SETTINGS: PrintSettings = {
  paperWidth: 58,
  columns: 32,
  fontSize: "normal",
  copies: 1,
  autoPrintOnClose: true,
  showKitchenPrices: true,
  printKitchenEnabled: false,
  cutPaper: true,
  openCashDrawer: false,
  characterTable: "CP860",
  baudRate: 9600,
  printerMode: "direct",
  printerConnected: false,
};

const defaultStatus = (): PrinterStatus => ({
  supported: false,
  connected: false,
  name: "",
  error: null,
  connectionType: undefined,
  vendorId: undefined,
  productId: undefined,
  productName: undefined,
});

const desktopStatus: PrinterStatus = {
  supported: true,
  connected: true,
  name: "Windows",
  error: null,
};

let status = defaultStatus();
let selectedPort: SerialPort | null = null;
let selectedDevice: UsbDevice | null = null;
let selectedUsbEndpoint: { interfaceNumber: number; endpointNumber: number } | null = null;
const listeners = new Set<() => void>();
let initialization: Promise<void> | null = null;
let deviceListenersAdded = false;
const automaticPrints = new Map<string, Promise<PrintResult>>();
let printQueue: Promise<unknown> = Promise.resolve();
let reconnectTimer: number | null = null;
let intentionalDisconnect = false;

export type PrintResult = { method: "direct" | "browser" | "desktop"; fallbackReason?: string };

function serialApi(): SerialApi | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { serial?: SerialApi }).serial ?? null;
}

function usbApi(): UsbApi | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { usb?: UsbApi }).usb ?? null;
}

export function isDirectPrintSupported() {
  return (
    typeof navigator !== "undefined" &&
    typeof window !== "undefined" &&
    window.isSecureContext &&
    (Boolean(serialApi()) || Boolean(usbApi()))
  );
}

export function getDefaultPrintSettings(): PrintSettings {
  return {
    ...DEFAULT_SETTINGS,
    printerMode: typeof window !== "undefined" && window.mesariDesktop ? "browser" : "direct",
  };
}

export function getPrintSettings(): PrintSettings {
  if (typeof localStorage === "undefined") return getDefaultPrintSettings();
  const stored = localStorage.getItem(SETTINGS_KEY);
  if (!stored) return getDefaultPrintSettings();

  const value: unknown = JSON.parse(stored);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("As configurações locais de impressão estão inválidas.");
  }
  const settings = value as Partial<PrintSettings>;
  const hasSavedDirectDevice = Boolean(settings.connectionType || settings.printerDeviceId);
  const printerMode =
    settings.printerMode === "browser"
      ? "browser"
      : hasSavedDirectDevice
        ? "direct"
        : getDefaultPrintSettings().printerMode;
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    paperWidth: settings.paperWidth === 80 ? 80 : 58,
    columns:
      Number.isInteger(settings.columns) && Number(settings.columns) >= 16
        ? Math.min(64, Number(settings.columns))
        : settings.paperWidth === 58
          ? 32
          : 48,
    fontSize:
      settings.fontSize === "small" || settings.fontSize === "large" ? settings.fontSize : "normal",
    copies: settings.copies === 2 ? 2 : 1,
    autoPrintOnClose: settings.autoPrintOnClose !== false,
    showKitchenPrices: settings.showKitchenPrices !== false,
    printKitchenEnabled: settings.printKitchenEnabled === true,
    cutPaper: settings.cutPaper !== false,
    openCashDrawer: settings.openCashDrawer === true,
    characterTable:
      settings.characterTable === "CP850" || settings.characterTable === "WPC1252"
        ? settings.characterTable
        : "CP860",
    baudRate:
      settings.baudRate === 19200 ||
      settings.baudRate === 38400 ||
      settings.baudRate === 57600 ||
      settings.baudRate === 115200
        ? settings.baudRate
        : 9600,
    printerMode,
    printerConnected: false,
  };
}

export function savePrintSettings(settings: PrintSettings) {
  if (typeof localStorage === "undefined") {
    throw new Error("Não foi possível salvar as configurações de impressão neste navegador.");
  }
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function subscribePrinterStatus(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPrinterStatus() {
  if (
    typeof window !== "undefined" &&
    window.mesariDesktop &&
    getPrintSettings().printerMode !== "direct"
  ) {
    return desktopStatus;
  }
  return status;
}

function publishStatus(next: Partial<PrinterStatus>) {
  status = { ...status, ...next };
  listeners.forEach((listener) => listener());
}

function deviceId(port: SerialPort) {
  const { usbVendorId, usbProductId } = port.getInfo();
  return usbVendorId === undefined || usbProductId === undefined
    ? ""
    : `${usbVendorId.toString(16)}:${usbProductId.toString(16)}`;
}

function deviceName(port: SerialPort) {
  const { usbVendorId, usbProductId } = port.getInfo();
  if (usbVendorId === undefined) return "Impressora térmica";
  const vendor = usbVendorId.toString(16).padStart(4, "0").toUpperCase();
  const product =
    usbProductId === undefined
      ? ""
      : ` · ${usbProductId.toString(16).padStart(4, "0").toUpperCase()}`;
  return `Impressora térmica · USB ${vendor}${product}`;
}

function usbDeviceId(device: UsbDevice) {
  return `${device.vendorId.toString(16)}:${device.productId.toString(16)}`;
}

function usbDeviceName(device: UsbDevice) {
  return device.productName || `Impressora USB ${device.vendorId}:${device.productId}`;
}

function storeConnectedSettings(
  type: "serial" | "usb",
  name: string,
  id: string,
  vendorId?: number,
  productId?: number,
  productName?: string,
) {
  let settings = getPrintSettings();
  if (localStorage.getItem(KITCHEN_CONFIGURED_KEY) !== "true") {
    settings = { ...settings, printKitchenEnabled: true };
    localStorage.setItem(KITCHEN_CONFIGURED_KEY, "true");
  }
  savePrintSettings({
    ...settings,
    printerMode: "direct",
    printerConnected: true,
    printerName: name,
    printerDeviceId: id,
    connectionType: type,
  });
  publishStatus({
    supported: true,
    connected: true,
    name,
    connectionType: type,
    vendorId,
    productId,
    productName,
    error: null,
  });
}

async function openPort(port: SerialPort) {
  if (selectedDevice?.opened) await selectedDevice.close();
  selectedUsbEndpoint = null;
  if (!port.writable) await port.open({ baudRate: getPrintSettings().baudRate });
  if (!port.writable)
    throw new Error("A impressora não disponibilizou uma conexão serial gravável.");
  selectedPort = port;
  selectedDevice = null;
  const info = port.getInfo();
  storeConnectedSettings(
    "serial",
    deviceName(port),
    deviceId(port),
    info.usbVendorId,
    info.usbProductId,
  );
}

async function openUsb(device: UsbDevice) {
  if (selectedDevice === device && selectedUsbEndpoint) {
    const settings = getPrintSettings();
    savePrintSettings({ ...settings, printerConnected: true });
    publishStatus({ supported: true, connected: true, error: null });
    return;
  }
  if (selectedPort?.writable) await selectedPort.close();
  if (selectedDevice && selectedDevice !== device && selectedDevice.opened) {
    await selectedDevice.close();
  }
  if (!device.opened) await device.open();
  if (!device.configuration) await device.selectConfiguration(1);
  const printerInterface = device.configuration?.interfaces.find(
    (candidate) => candidate.alternate.interfaceClass === 7,
  );
  const output = printerInterface?.alternate.endpoints.find(
    (endpoint) => endpoint.direction === "out" && endpoint.type === "bulk",
  );
  if (!printerInterface || !output) {
    throw new Error("O dispositivo USB não oferece uma interface ESC/POS com saída bulk.");
  }
  await device.claimInterface(printerInterface.interfaceNumber);
  selectedDevice = device;
  selectedPort = null;
  selectedUsbEndpoint = {
    interfaceNumber: printerInterface.interfaceNumber,
    endpointNumber: output.endpointNumber,
  };
  storeConnectedSettings(
    "usb",
    usbDeviceName(device),
    usbDeviceId(device),
    device.vendorId,
    device.productId,
    device.productName,
  );
}

function scheduleReconnect() {
  if (reconnectTimer !== null || intentionalDisconnect) return;
  reconnectTimer = window.setInterval(() => {
    if (!status.connected) void reconnectPrinter().catch(() => undefined);
  }, 5000);
}

function stopReconnect() {
  if (reconnectTimer !== null) window.clearInterval(reconnectTimer);
  reconnectTimer = null;
}

function listenForDeviceChanges() {
  if (deviceListenersAdded) return;
  serialApi()?.addEventListener("disconnect", (event) => {
    const disconnectedPort = (event as Event & { target?: SerialPort }).target;
    if (!disconnectedPort || disconnectedPort === selectedPort) {
      selectedPort = null;
      publishStatus({ connected: false, error: "A impressora foi desconectada." });
      scheduleReconnect();
    }
  });
  serialApi()?.addEventListener("connect", () => {
    void reconnectPrinter().catch(() => undefined);
  });
  usbApi()?.addEventListener("disconnect", (event) => {
    const device = (event as Event & { device?: UsbDevice }).device;
    if (!device || device === selectedDevice) {
      selectedDevice = null;
      publishStatus({ connected: false, error: "A impressora foi desconectada." });
      scheduleReconnect();
    }
  });
  usbApi()?.addEventListener("connect", () => {
    void reconnectPrinter().catch(() => undefined);
  });
  deviceListenersAdded = true;
}

async function findAuthorizedDevice() {
  const settings = getPrintSettings();
  if (settings.connectionType === "usb") {
    if (!settings.printerDeviceId) return false;
    const devices = await usbApi()?.getDevices();
    const device = devices?.find(
      (candidate) => usbDeviceId(candidate) === settings.printerDeviceId,
    );
    if (!device) return false;
    await openUsb(device);
    return true;
  }
  if (settings.connectionType !== "serial") return false;
  const ports = await serialApi()?.getPorts();
  const port = settings.printerDeviceId
    ? ports?.find((candidate) => deviceId(candidate) === settings.printerDeviceId)
    : undefined;
  const availablePort = port ?? (ports?.length === 1 ? ports[0] : undefined);
  if (!availablePort) return false;
  await openPort(availablePort);
  return true;
}

export function initializePrinter() {
  if (initialization) return initialization;
  initialization = (async () => {
    listenForDeviceChanges();
    if (
      typeof window !== "undefined" &&
      window.mesariDesktop &&
      getPrintSettings().printerMode !== "direct"
    ) {
      publishStatus({ supported: isDirectPrintSupported(), connected: false, error: null });
      return;
    }
    if (!isDirectPrintSupported()) {
      publishStatus({ supported: false, connected: false, name: "", error: null });
      return;
    }
    try {
      if (!(await findAuthorizedDevice())) {
        publishStatus({
          supported: true,
          connected: false,
          name: getPrintSettings().printerName ?? "",
          error: null,
        });
        if (getPrintSettings().printerDeviceId || getPrintSettings().connectionType === "serial") {
          scheduleReconnect();
        }
      }
    } catch (error) {
      publishStatus({
        supported: true,
        connected: false,
        name: getPrintSettings().printerName ?? "",
        error: errorMessage(error),
      });
      scheduleReconnect();
    }
  })().finally(() => {
    initialization = null;
  });
  return initialization;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error);
}

export async function connectPrinter() {
  return connectSerialPrinter();
}

export async function connectSerialPrinter() {
  const api = serialApi();
  if (!api) {
    const message =
      "Seu navegador não oferece suporte à conexão direta da impressora. Use Google Chrome ou Microsoft Edge.";
    publishStatus({ supported: false, connected: false, error: message });
    throw new Error(message);
  }
  listenForDeviceChanges();
  try {
    const port = await api.requestPort();
    intentionalDisconnect = false;
    await openPort(port);
    stopReconnect();
  } catch (error) {
    publishStatus({ connected: false, error: errorMessage(error) });
    throw error;
  }
}

export async function connectUsbPrinter(showAll = false) {
  const api = usbApi();
  if (!api) throw new Error("Este navegador não oferece conexão USB direta.");
  listenForDeviceChanges();
  try {
    const device = await api.requestDevice({ filters: showAll ? [] : [{ classCode: 7 }] });
    intentionalDisconnect = false;
    await openUsb(device);
    stopReconnect();
  } catch (error) {
    publishStatus({ connected: false, error: errorMessage(error) });
    throw error;
  }
}

export async function reconnectPrinter() {
  if (
    typeof window !== "undefined" &&
    window.mesariDesktop &&
    getPrintSettings().printerMode !== "direct"
  ) {
    return;
  }
  if (!isDirectPrintSupported()) {
    const message = "Este navegador não oferece suporte à conexão direta da impressora.";
    publishStatus({ supported: false, connected: false, error: message });
    throw new Error(message);
  }
  listenForDeviceChanges();
  try {
    if (!(await findAuthorizedDevice()))
      throw new Error("Nenhuma impressora autorizada foi encontrada.");
    intentionalDisconnect = false;
    stopReconnect();
  } catch (error) {
    publishStatus({ connected: false, error: errorMessage(error) });
    scheduleReconnect();
    throw error;
  }
}

export async function reconfigurePrinter() {
  return connectSerialPrinter();
}

export async function disconnectPrinter() {
  const port = selectedPort;
  const device = selectedDevice;
  intentionalDisconnect = true;
  stopReconnect();
  selectedPort = null;
  selectedDevice = null;
  selectedUsbEndpoint = null;
  try {
    if (port?.writable) await port.close();
    if (device?.opened) await device.close();
    const settings = getPrintSettings();
    savePrintSettings({ ...settings, printerConnected: false });
    publishStatus({ connected: false, error: null });
  } catch (error) {
    publishStatus({ connected: false, error: errorMessage(error) });
    throw error;
  }
}

export async function forgetPrinter() {
  const settings = getPrintSettings();
  const connectionType = settings.connectionType;
  const port = selectedPort;
  const device = selectedDevice;
  await disconnectPrinter();
  if (port && "forget" in port && typeof port.forget === "function") await port.forget();
  if (device?.forget) await device.forget();
  if (connectionType && window.mesariDesktop) {
    await window.mesariDesktop.forgetDirectDevice(connectionType);
  }
  const updatedSettings = { ...settings, printerConnected: false };
  if (window.mesariDesktop) updatedSettings.printerMode = "browser";
  delete updatedSettings.printerDeviceId;
  delete updatedSettings.printerName;
  delete updatedSettings.connectionType;
  savePrintSettings(updatedSettings);
  publishStatus({
    connected: false,
    name: "",
    connectionType: undefined,
    vendorId: undefined,
    productId: undefined,
    productName: undefined,
    error: null,
  });
}

const cp850Characters =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´≡±‗¾¶§÷¸°¨·¹³²■ ";
const cp860Characters =
  "ÇüéâãàÁçêÊèÍÔìÃÂÉÀÈôõòûùÌÕÜ¢£ÙÛƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´≡±‗¾¶§÷¸°¨·¹³²■";
const cp1252Extra = new Map<number, number>([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x2c6, 0x88],
  [0x2030, 0x89],
  [0x160, 0x8a],
  [0x2039, 0x8b],
  [0x152, 0x8c],
  [0x17d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x2dc, 0x98],
  [0x2122, 0x99],
  [0x161, 0x9a],
  [0x203a, 0x9b],
  [0x153, 0x9c],
  [0x17e, 0x9e],
  [0x178, 0x9f],
]);
const codePageSelector: Record<PrintSettings["characterTable"], number> = {
  CP860: 3,
  CP850: 2,
  WPC1252: 16,
};

function encodeText(text: string, table: PrintSettings["characterTable"] = "CP860") {
  const characters = table === "CP860" ? cp860Characters : cp850Characters;
  return Array.from(text, (character) => {
    const code = character.codePointAt(0) ?? 63;
    if (code <= 0x7f) return code;
    if (table === "WPC1252") {
      if (code >= 0xa0 && code <= 0xff) return code;
      return (
        cp1252Extra.get(code) ??
        character
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .codePointAt(0) ??
        63
      );
    }
    const characterIndex = characters.indexOf(character);
    if (characterIndex >= 0) return characterIndex + 128;
    const normalized = character.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const ascii = normalized.codePointAt(0) ?? 63;
    return ascii <= 0x7f ? ascii : 63;
  });
}

function money(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function wrapWords(text: string, width: number) {
  const result: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    if (word.length > width) {
      if (current) result.push(current);
      current = "";
      for (let index = 0; index < word.length; index += width) {
        const part = word.slice(index, index + width);
        if (part.length === width || index + width < word.length) result.push(part);
        else current = part;
      }
    } else if (!current) current = word;
    else if (current.length + word.length + 1 <= width) current += ` ${word}`;
    else {
      result.push(current);
      current = word;
    }
  }
  if (current) result.push(current);
  return result.length ? result : [""];
}

async function printDirect(data: Uint8Array) {
  if (selectedPort) {
    const port = selectedPort;
    if (!port.writable) await port.open({ baudRate: getPrintSettings().baudRate });
    if (!port.writable) throw new Error("A impressora não disponibilizou a conexão serial.");
    const writer = port.writable.getWriter();
    try {
      for (let offset = 0; offset < data.length; offset += 512) {
        await writer.write(data.slice(offset, offset + 512));
      }
    } finally {
      writer.releaseLock();
    }
  } else if (selectedDevice && selectedUsbEndpoint) {
    const device = selectedDevice;
    if (!device.opened) await device.open();
    for (let offset = 0; offset < data.length; offset += 512) {
      const result = await device.transferOut(
        selectedUsbEndpoint.endpointNumber,
        data.slice(offset, offset + 512),
      );
      if (result.status !== "ok") throw new Error(`Falha ao enviar dados USB: ${result.status}.`);
    }
  } else {
    throw new Error("A impressora direta não está conectada.");
  }
  publishStatus({ connected: true, error: null });
}

function enqueuePrint<T>(job: () => Promise<T>) {
  const result = printQueue.then(job, job);
  printQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function printDirectWithRetry(data: Uint8Array) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!selectedPort && !selectedDevice) {
      try {
        await reconnectPrinter();
      } catch (error) {
        lastError = error;
        if (attempt === 1) throw error;
        continue;
      }
    }
    try {
      await printDirect(data);
      return;
    } catch (error) {
      lastError = error;
      const failedPort = selectedPort;
      const failedDevice = selectedDevice;
      selectedPort = null;
      selectedDevice = null;
      selectedUsbEndpoint = null;
      publishStatus({ connected: false, error: errorMessage(error) });
      try {
        if (failedPort?.writable) await failedPort.close();
        if (failedDevice?.opened) await failedDevice.close();
      } catch (releaseCause) {
        lastError = new Error(
          `${errorMessage(error)} Não foi possível liberar a conexão: ${errorMessage(releaseCause)}`,
        );
        publishStatus({ error: errorMessage(lastError) });
      }
      if (attempt === 1) throw lastError;
    }
  }
  scheduleReconnect();
  throw new Error(errorMessage(lastError));
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return replacements[character] ?? character;
  });
}

async function assetDataUri(src: string) {
  if (src.startsWith("data:")) return src;
  const response = await fetch(new URL(src, window.location.href));
  if (!response.ok)
    throw new Error("Não foi possível carregar um recurso do recibo para impressão.");
  const blob = await response.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${blob.type || "image/png"};base64,${btoa(binary)}`;
}

async function receiptHtml(
  receipt: PrintReceipt,
  restaurant: PrintRestaurant,
  settings: PrintSettings,
) {
  const [logo, regularFont, boldFont] = await Promise.all([
    assetDataUri(restaurant.logo || defaultReceiptLogo),
    assetDataUri(receiptFontRegularUrl),
    assetDataUri(receiptFontBoldUrl),
  ]);
  const body = renderToStaticMarkup(
    createElement(ReceiptContent, {
      receipt,
      restaurant: { ...restaurant, logo },
      via2: Boolean(receipt.reprint),
      width: settings.paperWidth,
    }),
  );
  return `<!doctype html><html><head><meta charset="utf-8"><style>@font-face{font-family:"IBM Plex Mono";font-style:normal;font-weight:400;src:url("${regularFont}") format("woff2")}@font-face{font-family:"IBM Plex Mono";font-style:normal;font-weight:700;src:url("${boldFont}") format("woff2")}${receiptStyles}\n@page{size:${settings.paperWidth}mm auto;margin:0}html,body{width:${settings.paperWidth}mm;margin:0;padding:0;background:#fff;color:#000}.receipt-paper{width:${settings.paperWidth}mm!important;margin:0!important;padding:3mm!important;border:0!important;border-radius:0!important;background:#fff!important;color:#000!important;box-shadow:none!important;filter:none!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>${body}</body></html>`;
}

function kitchenTicketHtml(ticket: KitchenTicket, settings: PrintSettings) {
  if (ticket.external) return externalKitchenTicketHtml(ticket, settings);
  const fontSize = settings.fontSize === "small" ? 11 : settings.fontSize === "large" ? 18 : 14;
  const canShowPrices =
    settings.showKitchenPrices &&
    ticket.items.every(
      (item) => typeof item.unitPrice === "number" && Number.isFinite(item.unitPrice),
    );
  const items = ticket.items
    .map((item) => {
      const unitPrice = item.unitPrice ?? 0;
      return `<section class="item"><div class="item-main"><strong>${item.quantity}x&nbsp; ${escapeHtml(item.product)}</strong>${canShowPrices ? `<strong class="subtotal">${escapeHtml(money(item.quantity * unitPrice))}</strong>` : ""}</div>${canShowPrices ? `<div class="unit-price">${escapeHtml(money(unitPrice))} un.</div>` : ""}${item.note ? `<p class="note">&gt;&gt; ${escapeHtml(item.note)}</p>` : ""}</section>`;
    })
    .join("");
  const total = canShowPrices
    ? ticket.items.reduce((sum, item) => sum + item.quantity * (item.unitPrice ?? 0), 0)
    : null;
  const barLabel = ticket.sector === "bar" ? '<div class="sector">BAR</div>' : "";
  const tableLabel =
    ticket.table === null
      ? ""
      : `<div class="table">MESA ${String(ticket.table).padStart(2, "0")}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${settings.paperWidth}mm auto;margin:0}*{box-sizing:border-box}html,body{width:${settings.paperWidth}mm;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:${fontSize}px;line-height:1.25;color:#000}main{width:${settings.paperWidth}mm;padding:3mm;overflow-wrap:anywhere}.center{text-align:center}.header{text-align:center;font-weight:900;font-size:${fontSize + 3}px}.sector{text-align:center;font-size:${fontSize - 2}px;font-weight:700}.table{margin:4mm 0;text-align:center;font-weight:900;font-size:${fontSize * 2}px}.flag{padding:2mm;text-align:center;font-weight:900;border:1px solid #000}.meta{font-size:${fontSize - 2}px;margin-top:2mm}.dash{border-top:1px dashed #000;margin:3mm 0}.item{padding:2mm 0;font-size:${fontSize + 1}px}.item-main{display:flex;justify-content:space-between;gap:2mm}.item strong{font-weight:900}.subtotal{white-space:nowrap}.unit-price{font-size:${fontSize - 2}px;margin-top:1mm}.total{font-size:${fontSize + 2}px;font-weight:900}.note{margin:1mm 0 0 4mm;padding:1mm;font-size:${fontSize}px;font-weight:800;background:#eee}.cut{height:12mm}</style></head><body><main><header class="header">PEDIDO #${ticket.number}</header>${barLabel}${tableLabel}${ticket.additional ? '<div class="flag">** ADICIONAL **</div>' : ""}<div class="meta">${escapeHtml(new Date(ticket.createdAt).toLocaleString("pt-BR"))}</div><div class="meta">Garçom: ${escapeHtml(ticket.waiter)}</div><div class="dash"></div>${items}${total === null ? "" : `<div class="dash"></div><div class="total">TOTAL DO PEDIDO ${escapeHtml(money(total))}</div>`}<div class="cut"></div></main></body></html>`;
}

const deliveryChannelLabel = (channel: string) =>
  ({ whatsapp: "WhatsApp", telefone: "Telefone", papel: "Papel" })[channel] ?? channel;

function expectedPaymentLabel(payment: NonNullable<KitchenTicket["external"]>["payment"]) {
  if (payment.pago) return "JÁ PAGO";
  if (payment.forma === "pix") return "PIX";
  if (payment.forma === "credito" || payment.forma === "debito") return "CARTÃO NA ENTREGA";
  if (payment.forma === "dinheiro") {
    return payment.trocoPara !== null
      ? `DINHEIRO - TROCO PARA ${money(payment.trocoPara)}`
      : "DINHEIRO";
  }
  return "PAGAMENTO NÃO INFORMADO";
}

function externalKitchenTicketHtml(ticket: KitchenTicket, settings: PrintSettings) {
  const external = ticket.external!;
  const fontSize = settings.fontSize === "small" ? 11 : settings.fontSize === "large" ? 18 : 14;
  const items = ticket.items
    .map(
      (item) =>
        `<section class="item"><div class="item-main"><strong>${item.quantity}x ${escapeHtml(item.product)}</strong><strong>${escapeHtml(money(item.quantity * (item.unitPrice ?? 0)))}</strong></div>${item.note ? `<div class="note">&gt;&gt; ${escapeHtml(item.note)}</div>` : ""}</section>`,
    )
    .join("");
  const title = external.origin === "entrega" ? "ENTREGA" : "RETIRADA";
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${settings.paperWidth}mm auto;margin:0}*{box-sizing:border-box}html,body{width:${settings.paperWidth}mm;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:${fontSize}px;line-height:1.25;color:#000}main{width:${settings.paperWidth}mm;padding:3mm;overflow-wrap:anywhere}.center{text-align:center}.header{text-align:center;font-weight:900;font-size:${fontSize * 1.7}px}.meta{font-size:${fontSize - 2}px;margin-top:2mm}.client{margin-top:3mm;font-weight:800}.dash{border-top:1px dashed #000;margin:3mm 0}.item{padding:2mm 0;font-size:${fontSize}px}.item-main{display:flex;justify-content:space-between;gap:2mm}.item-main strong:last-child{white-space:nowrap}.note,.observation{margin:1mm 0 0 3mm;padding:1mm;font-weight:800;background:#eee}.totals p{display:flex;justify-content:space-between;margin:1mm 0}.total{font-size:${fontSize + 3}px;font-weight:900}.payment{margin-top:2mm;font-weight:900}.footer{text-align:center;font-size:${fontSize - 2}px}.cut{height:12mm}</style></head><body><main><header class="header">${title}<br>#${external.dayNumber}</header><div class="meta center">${escapeHtml(deliveryChannelLabel(external.channel))} · ${escapeHtml(new Date(ticket.createdAt).toLocaleTimeString("pt-BR"))}</div><div class="client">${escapeHtml(external.customerName)}</div>${external.phone ? `<div>Telefone: ${escapeHtml(external.phone)}</div>` : ""}${external.origin === "entrega" && external.address ? `<div>Endereço: ${escapeHtml(external.address)}</div>` : ""}<div class="dash"></div>${items}${external.observation ? `<div class="observation">OBSERVAÇÃO: ${escapeHtml(external.observation)}</div>` : ""}<div class="dash"></div><div class="totals"><p><span>Subtotal</span><strong>${escapeHtml(money(external.subtotal))}</strong></p>${external.origin === "entrega" ? `<p><span>Taxa de entrega</span><strong>${escapeHtml(money(external.deliveryFee))}</strong></p>` : ""}<p class="total"><span>TOTAL</span><strong>${escapeHtml(money(external.total))}</strong></p></div><div class="payment">${escapeHtml(expectedPaymentLabel(external.payment))}</div><div class="dash"></div><footer class="footer">Não é documento fiscal</footer><div class="cut"></div></main></body></html>`;
}

function escPosKitchenTicket(ticket: KitchenTicket, settings: PrintSettings) {
  if (ticket.external) return escPosExternalKitchenTicket(ticket, settings);
  const width = settings.columns;
  const canShowPrices =
    settings.showKitchenPrices &&
    ticket.items.every(
      (item) => typeof item.unitPrice === "number" && Number.isFinite(item.unitPrice),
    );
  const commands: number[] = [0x1b, 0x40, 0x1b, 0x74, codePageSelector[settings.characterTable]];
  const text = (value: string, align = 0, bold = false, size = 0) => {
    commands.push(0x1b, 0x61, align, 0x1b, 0x45, bold ? 1 : 0, 0x1d, 0x21, size);
    for (const fragment of wrapWords(value, Math.max(8, size ? Math.floor(width / 2) : width))) {
      commands.push(...encodeText(fragment, settings.characterTable), 0x0a);
    }
  };
  text(`PEDIDO #${ticket.number}`, 1, true);
  if (ticket.sector === "bar") text("BAR", 1);
  if (ticket.table !== null) text(`MESA ${String(ticket.table).padStart(2, "0")}`, 1, true, 0x11);
  if (ticket.additional) text("** ADICIONAL **", 1, true);
  text(new Date(ticket.createdAt).toLocaleString("pt-BR"));
  text(`Garçom: ${ticket.waiter || "—"}`);
  text("-".repeat(width));
  for (const item of ticket.items) {
    const itemName = `${item.quantity}x ${item.product}`;
    if (canShowPrices) {
      const price = money(item.quantity * (item.unitPrice ?? 0));
      text(
        `${itemName}${" ".repeat(Math.max(1, width - itemName.length - price.length))}${price}`,
        0,
        true,
      );
      text(`${money(item.unitPrice ?? 0)} un.`);
    } else {
      text(itemName, 0, true);
    }
    if (item.note) text(`>> ${item.note}`);
  }
  if (canShowPrices) {
    const total = ticket.items.reduce(
      (sum, item) => sum + item.quantity * (item.unitPrice ?? 0),
      0,
    );
    text("-".repeat(width));
    text(`TOTAL DO PEDIDO ${money(total)}`, 0, true);
  }
  commands.push(0x1b, 0x64, 3);
  if (settings.cutPaper) commands.push(0x1d, 0x56, 66, 3);
  return new Uint8Array(commands);
}

function escPosExternalKitchenTicket(ticket: KitchenTicket, settings: PrintSettings) {
  const external = ticket.external!;
  const width = settings.columns;
  const commands: number[] = [0x1b, 0x40, 0x1b, 0x74, codePageSelector[settings.characterTable]];
  const text = (value: string, align = 0, bold = false, size = 0) => {
    commands.push(0x1b, 0x61, align, 0x1b, 0x45, bold ? 1 : 0, 0x1d, 0x21, size);
    for (const fragment of wrapWords(value, Math.max(8, size ? Math.floor(width / 2) : width))) {
      commands.push(...encodeText(fragment, settings.characterTable), 0x0a);
    }
  };
  const rightLine = (label: string, value: number) =>
    `${label}${" ".repeat(Math.max(1, width - label.length - money(value).length))}${money(value)}`;
  text(external.origin === "entrega" ? "ENTREGA" : "RETIRADA", 1, true, 0x11);
  text(`#${external.dayNumber}`, 1, true, 0x11);
  text(
    `${deliveryChannelLabel(external.channel)} · ${new Date(ticket.createdAt).toLocaleTimeString("pt-BR")}`,
    1,
  );
  text(external.customerName, 0, true);
  if (external.phone) text(`Telefone: ${external.phone}`);
  if (external.origin === "entrega" && external.address)
    text(`Endereço: ${external.address}`, 0, true);
  text("-".repeat(width));
  for (const item of ticket.items) {
    const label = `${item.quantity}x ${item.product}`;
    text(rightLine(label, item.quantity * (item.unitPrice ?? 0)), 0, true);
    if (item.note) text(`  >> ${item.note}`, 0, true);
  }
  if (external.observation) {
    text("-".repeat(width));
    text(`OBSERVAÇÃO: ${external.observation}`, 0, true);
  }
  text("-".repeat(width));
  text(rightLine("Subtotal", external.subtotal));
  if (external.origin === "entrega") text(rightLine("Taxa de entrega", external.deliveryFee));
  text(rightLine("TOTAL", external.total), 2, true, 0x11);
  text(expectedPaymentLabel(external.payment), 1, true);
  text("-".repeat(width));
  text("Não é documento fiscal", 1);
  commands.push(0x1b, 0x64, 3);
  if (settings.cutPaper) commands.push(0x1d, 0x56, 66, 3);
  return new Uint8Array(commands);
}

export async function printKitchenTicket(
  ticket: KitchenTicket,
  settings = getPrintSettings(),
  allowBrowserFallback = true,
) {
  return enqueuePrint(async () => {
    const desktop = typeof window !== "undefined" ? window.mesariDesktop : undefined;
    if (desktop) {
      const desktopSettings = await desktop.getSettings();
      const result = await desktop.print({
        html: kitchenTicketHtml(ticket, settings),
        printerName: desktopSettings.printerComanda,
        widthMm: settings.paperWidth,
        copies: 1,
      });
      if (!result.ok)
        throw new Error(result.error || "O Windows não concluiu a impressão da comanda.");
      return { method: "desktop" as const };
    }
    if (settings.printerMode === "direct") {
      await printDirectWithRetry(escPosKitchenTicket(ticket, settings));
      return { method: "direct" as const };
    }
    if (!allowBrowserFallback) {
      throw new Error("Impressora térmica desconectada. Comanda mantida na lista de pendências.");
    }
    await printInHiddenFrame(kitchenTicketHtml(ticket, settings));
    return { method: "browser" as const };
  });
}

async function printInHiddenFrame(html: string) {
  if (typeof document === "undefined")
    throw new Error("A impressão pelo navegador requer uma página aberta.");
  const frame = document.createElement("iframe");
  let loadTimeout: number | undefined;
  let printTimeout: number | undefined;
  frame.setAttribute("aria-hidden", "true");
  frame.title = "Impressão Mesari";
  frame.style.position = "fixed";
  frame.style.width = "1px";
  frame.style.height = "1px";
  frame.style.opacity = "0";
  frame.style.pointerEvents = "none";
  frame.style.zIndex = "-1";
  frame.style.border = "0";

  try {
    await new Promise<void>((resolve, reject) => {
      loadTimeout = window.setTimeout(
        () => reject(new Error("Não foi possível carregar a impressão pelo navegador.")),
        15000,
      );
      frame.onload = () => {
        if (loadTimeout !== undefined) window.clearTimeout(loadTimeout);
        try {
          const frameWindow = frame.contentWindow;
          if (!frameWindow) throw new Error("Não foi possível iniciar a impressão pelo navegador.");
          frameWindow.onafterprint = () => resolve();
          frameWindow.focus();
          printTimeout = window.setTimeout(resolve, 60000);
          frameWindow.print();
        } catch (error) {
          reject(error);
        }
      };
      frame.srcdoc = html;
      document.body.append(frame);
    });
  } finally {
    if (loadTimeout !== undefined) window.clearTimeout(loadTimeout);
    if (printTimeout !== undefined) window.clearTimeout(printTimeout);
    frame.remove();
  }
}

export async function printReceipt(
  receipt: PrintReceipt,
  restaurant: PrintRestaurant,
  settings = getPrintSettings(),
): Promise<PrintResult> {
  return enqueuePrint(async () => {
    const desktop = typeof window !== "undefined" ? window.mesariDesktop : undefined;
    const desktopSettings = desktop ? await desktop.getSettings() : null;
    for (let copy = 0; copy < settings.copies; copy += 1) {
      const printableReceipt = {
        ...receipt,
        reprint: Boolean(receipt.reprint) || copy > 0,
      };
      const html = await receiptHtml(printableReceipt, restaurant, settings);
      if (desktop && desktopSettings) {
        const result = await desktop.print({
          html,
          printerName: desktopSettings.printerNota,
          widthMm: settings.paperWidth,
          copies: 1,
        });
        if (!result.ok) {
          throw new Error(result.error || `O Windows não concluiu a impressão da via ${copy + 1}.`);
        }
      } else {
        await printInHiddenFrame(html);
      }
    }
    return { method: desktop ? "desktop" : "browser" };
  });
}

export function printReceiptOnce(
  receipt: PrintReceipt,
  restaurant: PrintRestaurant,
  settings = getPrintSettings(),
) {
  const current = automaticPrints.get(receipt.id);
  if (current) return current;
  const operation = printReceipt(receipt, restaurant, settings);
  automaticPrints.set(receipt.id, operation);
  return operation;
}

export async function printTestPage(
  settings = getPrintSettings(),
  accentTest = false,
  restaurantName = "Mesari",
): Promise<PrintResult> {
  return enqueuePrint(async () => {
    const desktop = typeof window !== "undefined" ? window.mesariDesktop : undefined;
    if (desktop) {
      const desktopSettings = await desktop.getSettings();
      const result = await desktop.testPrint(
        desktopSettings.printerNota,
        settings.paperWidth,
        restaurantName,
      );
      if (!result.ok) throw new Error(result.error || "O Windows não concluiu a página de teste.");
      return { method: "desktop" };
    }
    let directError: string | undefined;
    if (settings.printerMode === "direct") {
      if (!selectedPort && !selectedDevice) await initializePrinter();
      if (selectedPort || selectedDevice) {
        try {
          const test = accentTest
            ? [
                "MESARI",
                "TESTE DE ACENTOS",
                "á é í ó ú à â ê ô ã õ ç",
                "Á É Í Ó Ú À Â Ê Ô Ã Õ Ç",
                "ñ º ª",
              ]
            : [
                "MESARI",
                "TESTE DE IMPRESSAO",
                "-".repeat(settings.columns),
                "Acentos: á é í ó ú à â ê ô ã õ ç",
                "ACENTOS: Á É Í Ó Ú À Â Ê Ô Ã Õ Ç",
                "Caract: ñ º ª",
                "Negrito",
                "Tamanho duplo",
                new Date().toLocaleString("pt-BR"),
              ];
          const bytes: number[] = [
            0x1b,
            0x40,
            0x1b,
            0x74,
            codePageSelector[settings.characterTable],
          ];
          for (const [index, value] of test.entries()) {
            const align = index < 2 || index === test.length - 1 ? 1 : 0;
            const scale = index === test.length - 2 ? 0x11 : 0;
            bytes.push(0x1b, 0x61, align, 0x1b, 0x45, index < 2 ? 1 : 0, 0x1d, 0x21, scale);
            bytes.push(...encodeText(value, settings.characterTable), 0x0a);
          }
          bytes.push(0x1b, 0x64, 3);
          if (settings.cutPaper) bytes.push(0x1d, 0x56, 66, 3);
          for (let copy = 0; copy < settings.copies; copy += 1) {
            await printDirectWithRetry(new Uint8Array(bytes));
          }
          return { method: "direct" };
        } catch (error) {
          directError = errorMessage(error);
        }
      } else {
        directError = "Nenhuma impressora direta autorizada está conectada.";
      }
    }
    const width = settings.paperWidth;
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${width}mm auto;margin:0}html,body{width:${width}mm;margin:0;padding:0}body{box-sizing:border-box;padding:3mm;font:12px monospace;text-align:center;color:#000}.dash{border-top:1px dashed #000;margin:3mm 0}</style></head><body><strong>MESARI</strong><div class="dash"></div><h2>TESTE DE IMPRESSÃO</h2><p>Impressora configurada com sucesso.</p><div class="dash"></div><p>${escapeHtml(new Date().toLocaleString("pt-BR"))}</p><strong>OK</strong></body></html>`;
    await printInHiddenFrame(html);
    return directError ? { method: "browser", fallbackReason: directError } : { method: "browser" };
  });
}
