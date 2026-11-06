import type { Codepage, PaperWidth } from "./escpos";

/** Formas de conexão que aparecem na tela "Impressão". */
export type ConnectionKind =
  | "rede"
  | "webserial"
  | "webusb"
  | "windows"
  | "serial"
  | "bluetooth"
  | "bluetoothNativo"
  | "navegador";

export const CONNECTION_LABELS: Record<ConnectionKind, string> = {
  rede: "Rede (IP)",
  webserial: "USB (Web Serial)",
  webusb: "USB (WebUSB)",
  windows: "Impressora do Windows",
  serial: "Porta serial (COM)",
  bluetooth: "Bluetooth",
  bluetoothNativo: "Bluetooth (app Android)",
  navegador: "Navegador",
};

export const BAUD_RATES = [9600, 19200, 38400, 115200] as const;
export type BaudRate = (typeof BAUD_RATES)[number];

export const DEFAULT_AGENT_URL = "http://localhost:9123";

export const COLUMN_OPTIONS = [32, 42, 48, 56, 64] as const;
export type FontSize = "pequeno" | "medio" | "grande";

/** Predefinições de largura. Preenchem papel, área útil e colunas; o usuário ainda ajusta. */
export const PRINT_PRESETS = [
  {
    id: "80-padrao",
    label:
      "80mm padrão (Elgin i9/i8, Epson TM-T20, Bematech MP-4200, Daruma, Tanca, Knup, genéricas)",
    paperWidth: 80,
    printableMm: 72,
    columns: 42,
  },
  { id: "80-larga", label: "80mm área larga", paperWidth: 80, printableMm: 76, columns: 48 },
  { id: "80-estreita", label: "80mm área estreita", paperWidth: 80, printableMm: 64, columns: 42 },
  {
    id: "58-padrao",
    label: "58mm padrão (portáteis e genéricas)",
    paperWidth: 58,
    printableMm: 48,
    columns: 32,
  },
  { id: "58-estreita", label: "58mm área estreita", paperWidth: 58, printableMm: 46, columns: 32 },
] as const satisfies readonly {
  id: string;
  label: string;
  paperWidth: PaperWidth;
  printableMm: number;
  columns: number;
}[];

/** Predefinição que corresponde ao perfil atual, ou "personalizado". */
export function presetOf(config: Pick<PrinterConfig, "paperWidth" | "printableMm" | "columns">) {
  return (
    PRINT_PRESETS.find(
      (preset) =>
        preset.paperWidth === config.paperWidth &&
        preset.printableMm === config.printableMm &&
        preset.columns === config.columns,
    )?.id ?? "personalizado"
  );
}

/** Área útil e colunas padrão de cada papel. */
export function layoutDefaults(paperWidth: PaperWidth) {
  return paperWidth === 58 ? { printableMm: 48, columns: 32 } : { printableMm: 72, columns: 42 };
}

/** Arredonda para a opção de colunas válida mais próxima, para baixo (mínimo 32). */
export function columnsAtMost(value: number) {
  const options = COLUMN_OPTIONS.filter((option) => option <= value);
  return options.length ? options[options.length - 1]! : COLUMN_OPTIONS[0];
}

export type PrinterConfig = {
  connection: ConnectionKind;
  // Rede
  ip: string;
  port: number;
  agentUrl: string;
  // Web Serial
  baudRate: BaudRate;
  serialPortId?: string;
  // WebUSB
  usbDeviceId?: string;
  // Impressora do Windows (agente)
  windowsPrinter: string;
  // Porta COM (agente)
  comPort: string;
  comBaudRate: BaudRate;
  // Bluetooth do navegador
  bluetoothDeviceId?: string;
  // Bluetooth do app Android
  bluetoothAddress?: string;
  /** Nome amigável do último dispositivo escolhido (USB, Bluetooth). */
  deviceName?: string;
  /** App desktop: qual das três abas (Bluetooth, Rede, Cabo USB) está em uso. */
  desktopGroup?: "bluetooth" | "rede" | "usb";
  // Formato
  paperWidth: PaperWidth;
  /** Largura imprimível real (mm). */
  printableMm: number;
  /** Colunas de texto do ESC/POS (e base do tamanho de fonte no HTML). */
  columns: (typeof COLUMN_OPTIONS)[number];
  /** Ajuste fino horizontal, de -5 a +5 mm. */
  offsetMm: number;
  fontSize: FontSize;
  codepage: Codepage;
  autoCut: boolean;
  /** Linhas de avanço antes do corte (3 a 8). */
  feedBeforeCut: number;
  copies: 1 | 2 | 3;
  openDrawerOnPayment: boolean;
  autoPrintOnPreparing: boolean;
  /** Este aparelho imprime as comandas que chegam das mesas e do delivery. */
  printKitchenEnabled: boolean;
  showKitchenPrices: boolean;
};

const STORAGE_KEY = "mesari-impressora";
const LEGACY_KEY = "mesari-print-settings";

export function defaultConfig(): PrinterConfig {
  return {
    connection: "navegador",
    ip: "",
    port: 9100,
    agentUrl: DEFAULT_AGENT_URL,
    baudRate: 115200,
    windowsPrinter: "",
    comPort: "",
    comBaudRate: 115200,
    paperWidth: 80,
    printableMm: 72,
    columns: 42,
    offsetMm: 0,
    fontSize: "medio",
    codepage: "CP850",
    autoCut: true,
    feedBeforeCut: 4,
    copies: 1,
    openDrawerOnPayment: false,
    autoPrintOnPreparing: false,
    printKitchenEnabled: false,
    showKitchenPrices: true,
  };
}

const KINDS = Object.keys(CONNECTION_LABELS) as ConnectionKind[];

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function optionalText(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

function baud(value: unknown, fallback: BaudRate): BaudRate {
  return (BAUD_RATES as readonly number[]).includes(Number(value))
    ? (Number(value) as BaudRate)
    : fallback;
}

/** Aceita qualquer coisa vinda do localStorage e devolve uma configuração válida. */
export function normalizeConfig(value: unknown): PrinterConfig {
  const base = defaultConfig();
  if (typeof value !== "object" || value === null || Array.isArray(value)) return base;
  const raw = value as Record<string, unknown>;
  const port = Number(raw["port"]);
  const copies = Number(raw["copies"]);
  const paperWidth: PaperWidth = raw["paperWidth"] === 58 ? 58 : 80;
  const defaults = layoutDefaults(paperWidth);
  const printable = Number(raw["printableMm"]);
  const columns = Number(raw["columns"]);
  const offset = Number(raw["offsetMm"]);
  const feed = Number(raw["feedBeforeCut"]);
  const config: PrinterConfig = {
    ...base,
    connection: KINDS.includes(raw["connection"] as ConnectionKind)
      ? (raw["connection"] as ConnectionKind)
      : base.connection,
    ip: text(raw["ip"]).trim(),
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : base.port,
    agentUrl: text(raw["agentUrl"], base.agentUrl).trim() || base.agentUrl,
    baudRate: baud(raw["baudRate"], base.baudRate),
    windowsPrinter: text(raw["windowsPrinter"]),
    comPort: text(raw["comPort"]),
    comBaudRate: baud(raw["comBaudRate"], base.comBaudRate),
    paperWidth,
    printableMm:
      Number.isFinite(printable) && printable >= 30
        ? Math.min(paperWidth, Math.round(printable * 2) / 2)
        : defaults.printableMm,
    columns: (COLUMN_OPTIONS as readonly number[]).includes(columns)
      ? (columns as PrinterConfig["columns"])
      : (defaults.columns as PrinterConfig["columns"]),
    offsetMm: Number.isFinite(offset) ? Math.max(-5, Math.min(5, Math.round(offset * 2) / 2)) : 0,
    fontSize:
      raw["fontSize"] === "pequeno" || raw["fontSize"] === "grande" ? raw["fontSize"] : "medio",
    feedBeforeCut: Number.isInteger(feed) ? Math.max(3, Math.min(8, feed)) : 4,
    codepage: (["CP850", "CP860", "CP437", "WPC1252"] as const).includes(
      raw["codepage"] as Codepage,
    )
      ? (raw["codepage"] as Codepage)
      : base.codepage,
    autoCut: raw["autoCut"] !== false,
    copies: copies === 2 || copies === 3 ? copies : 1,
    openDrawerOnPayment: raw["openDrawerOnPayment"] === true,
    autoPrintOnPreparing: raw["autoPrintOnPreparing"] === true,
    printKitchenEnabled: raw["printKitchenEnabled"] === true,
    showKitchenPrices: raw["showKitchenPrices"] !== false,
  };
  const optional = {
    serialPortId: optionalText(raw["serialPortId"]),
    usbDeviceId: optionalText(raw["usbDeviceId"]),
    bluetoothDeviceId: optionalText(raw["bluetoothDeviceId"]),
    bluetoothAddress: optionalText(raw["bluetoothAddress"]),
    deviceName: optionalText(raw["deviceName"]),
    desktopGroup: ["bluetooth", "rede", "usb"].includes(String(raw["desktopGroup"]))
      ? optionalText(raw["desktopGroup"])
      : undefined,
  };
  for (const [key, entry] of Object.entries(optional)) {
    if (entry !== undefined) (config as Record<string, unknown>)[key] = entry;
  }
  return config;
}

/** Converte a configuração da versão anterior (Web Serial/WebUSB/driver) para a nova. */
function migrateLegacy(raw: Record<string, unknown>): PrinterConfig {
  const legacyType = raw["connectionType"];
  const direct = raw["printerMode"] === "direct";
  return normalizeConfig({
    connection:
      direct && legacyType === "usb"
        ? "webusb"
        : direct && legacyType === "serial"
          ? "webserial"
          : "navegador",
    paperWidth: raw["paperWidth"],
    codepage: raw["characterTable"],
    autoCut: raw["cutPaper"],
    copies: raw["copies"],
    openDrawerOnPayment: raw["openCashDrawer"],
    printKitchenEnabled: raw["printKitchenEnabled"],
    showKitchenPrices: raw["showKitchenPrices"],
    baudRate: raw["baudRate"],
    serialPortId: legacyType === "serial" ? raw["printerDeviceId"] : undefined,
    usbDeviceId: legacyType === "usb" ? raw["printerDeviceId"] : undefined,
    deviceName: raw["printerName"],
  });
}

function readStorage(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

let cached: PrinterConfig | null = null;
const listeners = new Set<() => void>();

export function loadConfig(): PrinterConfig {
  if (cached) return cached;
  let result = defaultConfig();
  try {
    const stored = readStorage(STORAGE_KEY);
    if (stored) result = normalizeConfig(JSON.parse(stored));
    else {
      const legacy = readStorage(LEGACY_KEY);
      if (legacy) {
        const parsed: unknown = JSON.parse(legacy);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          result = migrateLegacy(parsed as Record<string, unknown>);
        }
      }
    }
  } catch (cause) {
    console.error("[impressão] configuração local inválida; usando o padrão", cause);
  }
  cached = result;
  return result;
}

/** Salva a configuração deste aparelho. Sem localStorage, vale só enquanto a página estiver aberta. */
export function saveConfig(next: PrinterConfig) {
  cached = normalizeConfig(next);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(cached));
  } catch (cause) {
    console.error("[impressão] não foi possível salvar a configuração", cause);
  }
  listeners.forEach((listener) => listener());
  return cached;
}

export function updateConfig(patch: Partial<PrinterConfig>) {
  return saveConfig({ ...loadConfig(), ...patch });
}

export function subscribeConfig(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Só para testes. */
export function resetConfigCache() {
  cached = null;
}
