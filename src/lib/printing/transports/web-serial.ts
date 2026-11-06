/**
 * USB via Web Serial (Chrome/Edge no PC). Para impressoras cujo driver cria uma porta COM
 * virtual. A porta autorizada fica lembrada pelo navegador (navigator.serial.getPorts()).
 */
import type { BaudRate } from "../config";
import { BaseTransport, PrinterError, isSecureBrowser, type Availability } from "./base";

type SerialInfo = { usbVendorId?: number; usbProductId?: number };
export type SerialPortLike = {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  getInfo(): SerialInfo;
};
type SerialApi = {
  getPorts(): Promise<SerialPortLike[]>;
  requestPort(options?: { filters: SerialInfo[] }): Promise<SerialPortLike>;
  addEventListener(type: "connect" | "disconnect", listener: (event: Event) => void): void;
};

function serialApi(): SerialApi | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { serial?: SerialApi }).serial ?? null;
}

export function serialPortId(port: SerialPortLike) {
  const { usbVendorId, usbProductId } = port.getInfo();
  return usbVendorId === undefined
    ? "serial"
    : `${usbVendorId.toString(16).padStart(4, "0")}:${(usbProductId ?? 0).toString(16).padStart(4, "0")}`;
}

function portName(port: SerialPortLike) {
  const id = serialPortId(port);
  return id === "serial" ? "Porta serial" : `Porta USB ${id.toUpperCase()}`;
}

export class WebSerialTransport extends BaseTransport {
  readonly kind = "webserial" as const;
  private port: SerialPortLike | null = null;
  private listening = false;

  constructor(
    private baudRate: BaudRate,
    private savedId: string | undefined,
    private onChosen: (id: string, name: string) => void = () => undefined,
  ) {
    super();
  }

  isAvailable(): Availability {
    if (!serialApi() || !isSecureBrowser()) {
      return {
        available: false,
        reason: "Web Serial não é suportado neste navegador. Use Chrome ou Edge no computador.",
      };
    }
    return { available: true };
  }

  private listen() {
    const api = serialApi();
    if (!api || this.listening) return;
    this.listening = true;
    api.addEventListener("disconnect", (event) => {
      const target = (event as Event & { target?: SerialPortLike }).target;
      if (!target || target === this.port) {
        this.port = null;
        this.setStatus({ state: "desconectado", message: "A impressora foi desconectada." });
      }
    });
  }

  /** Abre o seletor do navegador. Precisa ser chamado num clique. */
  async choose() {
    this.requireAvailable();
    const api = serialApi()!;
    let port: SerialPortLike;
    try {
      port = await api.requestPort();
    } catch (cause) {
      throw new PrinterError("Nenhuma porta foi escolhida.", cause);
    }
    await this.disconnect();
    this.savedId = serialPortId(port);
    this.onChosen(this.savedId, portName(port));
    await this.open(port);
  }

  private async open(port: SerialPortLike) {
    this.listen();
    this.setStatus({ state: "conectando", deviceName: portName(port) });
    try {
      if (!port.writable) await port.open({ baudRate: this.baudRate });
    } catch (cause) {
      const message =
        "Não foi possível abrir a porta. Feche outros programas ou abas que estejam usando a impressora.";
      this.setStatus({ state: "erro", message, deviceName: portName(port) });
      throw new PrinterError(message, cause);
    }
    this.port = port;
    this.setStatus({ state: "conectado", deviceName: portName(port) });
  }

  async connect() {
    this.requireAvailable();
    if (this.port?.writable) return;
    const ports = await serialApi()!.getPorts();
    const port =
      ports.find((candidate) => serialPortId(candidate) === this.savedId) ??
      (ports.length === 1 ? ports[0] : undefined);
    if (!port) {
      const message = 'Clique em "Escolher porta USB" para autorizar a impressora.';
      this.setStatus({ state: "desconectado", message });
      throw new PrinterError(message);
    }
    await this.open(port);
  }

  async write(bytes: Uint8Array) {
    const port = this.port;
    if (!port?.writable) throw new PrinterError("A porta da impressora não está aberta.");
    const writer = port.writable.getWriter();
    try {
      for (let offset = 0; offset < bytes.length; offset += 1024) {
        await writer.ready;
        await writer.write(bytes.slice(offset, offset + 1024));
      }
      await writer.ready;
    } finally {
      writer.releaseLock();
    }
  }

  async disconnect() {
    const port = this.port;
    this.port = null;
    if (port?.writable || port?.readable) {
      try {
        await port.close();
      } catch (cause) {
        console.error("[impressão] erro ao fechar a porta serial", cause);
      }
    }
    this.setStatus({ state: "desconectado" });
  }
}
