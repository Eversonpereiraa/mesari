/**
 * Ponto único de impressão. Escolhe o transporte pela configuração salva neste aparelho e
 * expõe imprimirComanda, imprimirNota, imprimirTeste e abrirGaveta.
 *
 * - Fila: um trabalho por vez. O mesmo trabalho pedido de novo enquanto está na fila (clique
 *   duplo, evento repetido) devolve a mesma promessa em vez de imprimir duas vezes.
 * - Conexão com timeout de 8 s e uma nova tentativa automática; depois disso, erro.
 * - Quem chama só imprime depois que o banco confirmou a operação; uma falha aqui nunca deve
 *   desfazer status.
 */
import {
  CONNECTION_LABELS,
  loadConfig,
  subscribeConfig,
  updateConfig,
  type ConnectionKind,
  type PrinterConfig,
} from "./config";
import {
  drawerBytes,
  renderEscPos,
  renderHtml,
  calibrationEscPos,
  calibrationHtml,
  testPageDoc,
  type PrintDoc,
} from "./documents";
import {
  SAMPLE_PRINTED_AT,
  SAMPLE_RESTAURANT,
  comandaCozinha,
  comandaDelivery,
  contaMesa,
  sampleDeliveryTicket,
  sampleKitchenTicket,
  sampleReceipt,
} from "./comandas";
import { loadPrintLogo, type PrintLogo } from "./logo";
import { getPrintRestaurant } from "./restaurant";
import type { KitchenTicket, PrintReceipt, PrintRestaurant } from "./types";
import {
  BaseTransport,
  FRIENDLY_PRINT_ERROR,
  PrinterError,
  isNativeApp,
  withTimeout,
  type Availability,
  type PrinterTransport,
  type TransportState,
  type TransportStatus,
} from "./transports/base";
import {
  NetworkAgentTransport,
  SerialAgentTransport,
  WindowsPrinterAgentTransport,
} from "./transports/agent";
import { WebSerialTransport } from "./transports/web-serial";
import { WebUsbTransport } from "./transports/web-usb";
import { BluetoothWebTransport } from "./transports/bluetooth-web";
import { NativeBluetoothTransport, NativeTcpTransport } from "./transports/native";
import { BrowserPrintTransport } from "./transports/browser";
import { ElectronTransport, isDesktopApp } from "./transports/electron";

const CONNECT_TIMEOUT_MS = 8000;
const WRITE_TIMEOUT_MS = 30000;

export type PrinterStatus = {
  connection: ConnectionKind;
  label: string;
  state: TransportState;
  connected: boolean;
  name: string;
  /** Mensagem amigável do último problema, ou null. */
  error: string | null;
};

export type PrintResult = { connection: ConnectionKind };

function onChosen(field: "serialPortId" | "usbDeviceId" | "bluetoothDeviceId") {
  return (id: string, name: string) => updateConfig({ [field]: id, deviceName: name });
}

export function createTransport(
  config: PrinterConfig,
  purpose: "comanda" | "nota" = "comanda",
): PrinterTransport {
  // App desktop: rede, impressora do Windows e porta COM vão direto pelo Electron, sem agente.
  if (isDesktopApp()) {
    if (config.connection === "rede") {
      return new ElectronTransport({ kind: "rede", ip: config.ip, porta: config.port });
    }
    if (config.connection === "windows") {
      return new ElectronTransport({ kind: "windows", impressora: config.windowsPrinter });
    }
    if (config.connection === "serial") {
      return new ElectronTransport({
        kind: "serial",
        com: config.comPort,
        baud: config.comBaudRate,
      });
    }
  }
  switch (config.connection) {
    case "rede":
      return isNativeApp()
        ? new NativeTcpTransport(config.ip, config.port)
        : new NetworkAgentTransport(config.agentUrl, config.ip, config.port);
    case "webserial":
      return new WebSerialTransport(config.baudRate, config.serialPortId, onChosen("serialPortId"));
    case "webusb":
      return new WebUsbTransport(config.usbDeviceId, onChosen("usbDeviceId"));
    case "windows":
      return new WindowsPrinterAgentTransport(config.agentUrl, config.windowsPrinter);
    case "serial":
      return new SerialAgentTransport(config.agentUrl, config.comPort, config.comBaudRate);
    case "bluetooth":
      return new BluetoothWebTransport(config.bluetoothDeviceId, onChosen("bluetoothDeviceId"));
    case "bluetoothNativo":
      return new NativeBluetoothTransport(config.bluetoothAddress, config.deviceName);
    case "navegador":
      return new BrowserPrintTransport(purpose);
  }
}

/**
 * Chave que identifica "o mesmo transporte". IDs de dispositivo ficam de fora: quem os grava é o
 * próprio transporte ao escolher o aparelho, e recriá-lo fecharia a porta recém-aberta.
 */
function transportKey(config: PrinterConfig) {
  switch (config.connection) {
    case "rede":
      return `rede|${config.agentUrl}|${config.ip}|${config.port}`;
    case "webserial":
      return `webserial|${config.baudRate}`;
    case "windows":
      return `windows|${config.agentUrl}|${config.windowsPrinter}`;
    case "serial":
      return `serial|${config.agentUrl}|${config.comPort}|${config.comBaudRate}`;
    case "bluetoothNativo":
      return `bluetoothNativo|${config.bluetoothAddress ?? ""}`;
    default:
      return config.connection;
  }
}

let current: { key: string; transport: PrinterTransport; unsubscribe: () => void } | null = null;
let status: PrinterStatus = statusFrom("navegador", { state: "desconectado" });
const statusListeners = new Set<() => void>();

function statusFrom(connection: ConnectionKind, next: TransportStatus): PrinterStatus {
  return {
    connection,
    label: CONNECTION_LABELS[connection],
    state: next.state,
    connected: next.state === "conectado",
    name: next.deviceName ?? CONNECTION_LABELS[connection],
    error: next.state === "erro" || next.message ? (next.message ?? FRIENDLY_PRINT_ERROR) : null,
  };
}

function publish(connection: ConnectionKind, next: TransportStatus) {
  status = statusFrom(connection, next);
  statusListeners.forEach((listener) => listener());
}

/** Transporte da configuração atual. Troca (e fecha o anterior) quando a configuração muda. */
export function getTransport(): PrinterTransport {
  const config = loadConfig();
  const key = transportKey(config);
  if (current?.key === key) return current.transport;
  if (current) {
    const old = current;
    old.unsubscribe();
    void old.transport
      .disconnect()
      .catch((cause: unknown) =>
        console.error("[impressão] erro ao fechar a conexão anterior", cause),
      );
  }
  const transport = createTransport(config);
  const unsubscribe =
    transport instanceof BaseTransport
      ? transport.onStatus((next) => publish(transport.kind, next))
      : () => undefined;
  current = { key, transport, unsubscribe };
  publish(transport.kind, transport.getStatus());
  return transport;
}

subscribeConfig(() => {
  // Configuração mudou na tela "Impressão": atualiza o status para o novo transporte.
  if (current && current.key !== transportKey(loadConfig())) getTransport();
});

export function subscribePrinterStatus(listener: () => void) {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

export function getPrinterStatus() {
  return status;
}

export function transportAvailability(kind: ConnectionKind): Availability {
  return createTransport({ ...loadConfig(), connection: kind }).isAvailable();
}

// ---------------------------------------------------------------------------------------------
// Fila

let queue: Promise<unknown> = Promise.resolve();
const pending = new Map<string, Promise<unknown>>();

function enqueue<T>(key: string, job: () => Promise<T>): Promise<T> {
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;
  const result = queue.then(job, job);
  queue = result.catch(() => undefined);
  pending.set(key, result);
  void result.catch(() => undefined).finally(() => pending.delete(key));
  return result;
}

function friendly(cause: unknown) {
  console.error("[impressão]", cause);
  return cause instanceof PrinterError ? cause : new PrinterError(FRIENDLY_PRINT_ERROR, cause);
}

async function sendBytes(transport: PrinterTransport, bytes: Uint8Array) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await withTimeout(
        transport.connect(),
        CONNECT_TIMEOUT_MS,
        "A impressora não respondeu a tempo.",
      );
      await withTimeout(
        transport.write(bytes),
        WRITE_TIMEOUT_MS,
        "A impressora não terminou de receber os dados.",
      );
      return;
    } catch (cause) {
      lastError = cause;
      console.warn(`[impressão] tentativa ${attempt} falhou`, cause);
      await transport.disconnect().catch(() => undefined);
    }
  }
  throw lastError;
}

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

type DeliverOptions = {
  copies?: number;
  openDrawer?: boolean;
  /** HTML próprio para o navegador (página de calibração). */
  html?: () => Promise<string>;
  /** Bytes próprios para ESC/POS (página de calibração). */
  bytes?: () => Uint8Array;
  transport?: PrinterTransport;
};

async function deliver(
  docs: PrintDoc | PrintDoc[],
  options: DeliverOptions = {},
): Promise<PrintResult> {
  const config = loadConfig();
  const transport = options.transport ?? getTransport();
  const copies = Math.max(1, options.copies ?? 1);
  try {
    if (!transport.acceptsBytes) {
      const html = options.html ? await options.html() : renderHtml(docs, config);
      for (let copy = 0; copy < copies; copy += 1) {
        await transport.printHtml!(html, config.paperWidth);
      }
    } else {
      const one = options.bytes ? options.bytes() : renderEscPos(docs, config);
      const parts = Array.from({ length: copies }, () => one);
      if (options.openDrawer) parts.push(drawerBytes(config));
      await sendBytes(transport, concat(parts));
    }
    return { connection: transport.kind };
  } catch (cause) {
    throw friendly(cause);
  }
}

/** Logo processada (cache do aparelho), só se o restaurante pediu logo nas comandas. */
async function restaurantLogo(restaurant: PrintRestaurant): Promise<PrintLogo | null> {
  if (!restaurant.printLogoEnabled || !restaurant.printLogo) return null;
  try {
    return await loadPrintLogo(restaurant.printLogo);
  } catch (cause) {
    // Sem logo a comanda sai do mesmo jeito, começando pelo nome.
    console.warn("[impressão] logo indisponível; imprimindo sem logo", cause);
    return null;
  }
}

/** Comanda de cozinha e, no delivery/retirada, também a comanda que vai com o entregador. */
async function comandaDocs(ticket: KitchenTicket, restaurant: PrintRestaurant, now?: number) {
  const docs = [comandaCozinha(ticket, now === undefined ? {} : { now })];
  if (ticket.external) {
    docs.push(comandaDelivery(ticket, restaurant, { logo: await restaurantLogo(restaurant) }));
  }
  return docs;
}

// ---------------------------------------------------------------------------------------------
// API pública

/**
 * Comanda do pedido inteiro (modelo "Comanda de cozinha"); pedidos de delivery/retirada saem
 * também com a "Comanda de delivery". `force: "navegador"` imprime pela caixa do sistema.
 */
export function imprimirComanda(ticket: KitchenTicket, options: { force?: "navegador" } = {}) {
  return enqueue(`comanda:${ticket.id}:${options.force ?? ""}`, async () => {
    const config = loadConfig();
    return deliver(await comandaDocs(ticket, getPrintRestaurant()), {
      copies: config.copies,
      ...(options.force ? { transport: new BrowserPrintTransport("comanda") } : {}),
    });
  });
}

export type ExampleKind = "cozinha" | "delivery" | "conta";

/** Exemplos com os dados dos modelos; a logo é a do restaurante, se estiver ligada. */
export function imprimirExemplo(kind: ExampleKind) {
  return enqueue(`exemplo:${kind}`, async () => {
    const own = getPrintRestaurant();
    const restaurant: PrintRestaurant = {
      ...SAMPLE_RESTAURANT,
      ...(own.printLogo ? { printLogo: own.printLogo } : {}),
      printLogoEnabled: Boolean(own.printLogoEnabled),
    };
    if (kind === "cozinha") {
      return deliver(comandaCozinha(sampleKitchenTicket(), { now: SAMPLE_PRINTED_AT }));
    }
    const logo = await restaurantLogo(restaurant);
    if (kind === "delivery")
      return deliver(comandaDelivery(sampleDeliveryTicket(), restaurant, { logo }));
    const config = loadConfig();
    return deliver(contaMesa(sampleReceipt(), restaurant, { logo }), {
      transport:
        config.connection === "navegador" ? new BrowserPrintTransport("nota") : getTransport(),
    });
  });
}

export function imprimirTeste(restaurantName = "Mesari") {
  return enqueue("teste", () => {
    const config = loadConfig();
    const label = getTransport().getStatus().deviceName
      ? `${CONNECTION_LABELS[config.connection]} · ${getTransport().getStatus().deviceName}`
      : CONNECTION_LABELS[config.connection];
    return deliver(testPageDoc(config, restaurantName, label));
  });
}

/**
 * Página de calibração: régua em mm a partir da borda esquerda, régua de caracteres e as setas
 * ESQUERDA/DIREITA na área útil atual. As respostas do usuário ajustam o perfil de largura.
 */
export function imprimirCalibracao() {
  return enqueue("calibracao", () => {
    const config = loadConfig();
    return deliver(
      { title: "Calibrar impressora", lines: [] },
      { html: async () => calibrationHtml(config), bytes: () => calibrationEscPos(config) },
    );
  });
}

/** Conta da mesa / nota (modelo "Conta da mesa"), igual no navegador e na térmica. */
export function imprimirNota(
  receipt: PrintReceipt,
  restaurant: PrintRestaurant,
  options: { openDrawer?: boolean } = {},
) {
  return enqueue(`nota:${receipt.id}:${receipt.reprint ? "2" : "1"}`, async () => {
    const config = loadConfig();
    const transport =
      config.connection === "navegador" ? new BrowserPrintTransport("nota") : getTransport();
    const full = { ...getPrintRestaurant(), ...restaurant };
    const doc = contaMesa(receipt, full, { logo: await restaurantLogo(full) });
    return deliver(doc, {
      transport,
      copies: config.copies,
      openDrawer: Boolean(options.openDrawer),
    });
  });
}

/** Abre a gaveta ligada à impressora (ESC p). No navegador não há como enviar o pulso. */
export function abrirGaveta() {
  return enqueue("gaveta", async () => {
    const transport = getTransport();
    if (!transport.acceptsBytes) {
      throw new PrinterError(
        "A gaveta só abre com a impressora conectada direto (não pelo navegador).",
      );
    }
    try {
      await sendBytes(transport, drawerBytes(loadConfig()));
    } catch (cause) {
      throw friendly(cause);
    }
  });
}

/** Testa a conexão sem imprimir. */
export async function testarConexao() {
  const transport = getTransport();
  try {
    // Conexões sem estado (agente, rede, navegador): força uma checagem nova.
    if (["rede", "windows", "serial", "navegador"].includes(transport.kind)) {
      await transport.disconnect();
    }
    await withTimeout(
      transport.connect(),
      CONNECT_TIMEOUT_MS,
      "A impressora não respondeu a tempo.",
    );
    return transport.getStatus();
  } catch (cause) {
    throw friendly(cause);
  }
}

export async function desconectar() {
  await getTransport().disconnect();
}

/**
 * Ao abrir o Mesari: reconecta em silêncio a impressora já autorizada (USB, Bluetooth) ou
 * confere o agente. Erros só mudam o status.
 */
let initializing: Promise<void> | null = null;
export function initializePrinter() {
  if (initializing) return initializing;
  initializing = (async () => {
    const config = loadConfig();
    const transport = getTransport();
    const authorized =
      (config.connection === "webserial" && config.serialPortId) ||
      (config.connection === "webusb" && config.usbDeviceId) ||
      (config.connection === "bluetooth" && config.bluetoothDeviceId) ||
      (config.connection === "rede" && config.ip) ||
      (config.connection === "windows" && config.windowsPrinter) ||
      (config.connection === "serial" && config.comPort);
    if (!authorized || !transport.isAvailable().available) return;
    try {
      await withTimeout(
        transport.connect(),
        CONNECT_TIMEOUT_MS,
        "A impressora não respondeu a tempo.",
      );
    } catch (cause) {
      console.warn("[impressão] reconexão automática falhou", cause);
    }
  })().finally(() => {
    initializing = null;
  });
  return initializing;
}

/** Só para testes. */
export function resetPrinterForTests() {
  current?.unsubscribe();
  current = null;
  pending.clear();
  queue = Promise.resolve();
}
