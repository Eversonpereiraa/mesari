/**
 * USB via WebUSB (Chrome no PC e no Android). Procura a interface de impressora (classe 7) e o
 * endpoint bulk OUT. No Windows, o driver do fabricante costuma "segurar" o aparelho: aí é
 * preciso trocar para WinUSB (Zadig) ou usar Web Serial / agente.
 */
import { BaseTransport, PrinterError, isSecureBrowser, type Availability } from "./base";

type UsbEndpoint = {
  direction: "in" | "out";
  type: string;
  endpointNumber: number;
  packetSize?: number;
};
type UsbAlternate = { interfaceClass: number; endpoints: UsbEndpoint[] };
type UsbInterface = {
  interfaceNumber: number;
  alternate: UsbAlternate;
  alternates?: UsbAlternate[];
};
export type UsbDeviceLike = {
  vendorId: number;
  productId: number;
  productName?: string;
  serialNumber?: string;
  configuration: { interfaces: UsbInterface[] } | null;
  opened: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(value: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  transferOut(endpointNumber: number, data: BufferSource): Promise<{ status: string }>;
};
type UsbApi = {
  getDevices(): Promise<UsbDeviceLike[]>;
  requestDevice(options: { filters: { classCode?: number }[] }): Promise<UsbDeviceLike>;
  addEventListener(type: "connect" | "disconnect", listener: (event: Event) => void): void;
};

export const WEBUSB_WINDOWS_HINT =
  'No Windows, o WebUSB pode exigir o driver WinUSB. Se não funcionar, use "USB (Web Serial)" ou "Impressora do Windows" com o agente.';

function usbApi(): UsbApi | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { usb?: UsbApi }).usb ?? null;
}

export function usbDeviceId(device: UsbDeviceLike) {
  return `${device.vendorId.toString(16).padStart(4, "0")}:${device.productId.toString(16).padStart(4, "0")}${device.serialNumber ? `:${device.serialNumber}` : ""}`;
}

function deviceName(device: UsbDeviceLike) {
  return device.productName || `Impressora USB ${usbDeviceId(device).toUpperCase()}`;
}

export class WebUsbTransport extends BaseTransport {
  readonly kind = "webusb" as const;
  private device: UsbDeviceLike | null = null;
  private endpoint: { number: number; packet: number } | null = null;
  private listening = false;

  constructor(
    private savedId: string | undefined,
    private onChosen: (id: string, name: string) => void = () => undefined,
  ) {
    super();
  }

  isAvailable(): Availability {
    if (!usbApi() || !isSecureBrowser()) {
      return { available: false, reason: "WebUSB não é suportado neste navegador. Use o Chrome." };
    }
    return { available: true };
  }

  private listen() {
    const api = usbApi();
    if (!api || this.listening) return;
    this.listening = true;
    api.addEventListener("disconnect", (event) => {
      const device = (event as Event & { device?: UsbDeviceLike }).device;
      if (!device || device === this.device) {
        this.device = null;
        this.endpoint = null;
        this.setStatus({ state: "desconectado", message: "A impressora foi desconectada." });
      }
    });
  }

  /** Abre o seletor do navegador. Precisa ser chamado num clique. */
  async choose(showAll = false) {
    this.requireAvailable();
    let device: UsbDeviceLike;
    try {
      device = await usbApi()!.requestDevice({ filters: showAll ? [] : [{ classCode: 7 }] });
    } catch (cause) {
      throw new PrinterError("Nenhum dispositivo USB foi escolhido.", cause);
    }
    await this.disconnect();
    this.savedId = usbDeviceId(device);
    this.onChosen(this.savedId, deviceName(device));
    await this.open(device);
  }

  private async open(device: UsbDeviceLike) {
    this.listen();
    this.setStatus({ state: "conectando", deviceName: deviceName(device) });
    try {
      if (!device.opened) await device.open();
      if (!device.configuration) await device.selectConfiguration(1);
      const candidates = (device.configuration?.interfaces ?? []).flatMap((iface) =>
        (iface.alternates?.length ? iface.alternates : [iface.alternate]).flatMap((alternate) => {
          const endpoint = alternate.endpoints.find(
            (entry) => entry.direction === "out" && entry.type === "bulk",
          );
          return endpoint ? [{ iface, endpoint, printer: alternate.interfaceClass === 7 }] : [];
        }),
      );
      // Prefere a interface de impressora (classe 7); senão, qualquer saída bulk.
      const found = candidates.find((entry) => entry.printer) ?? candidates[0];
      if (!found) {
        throw new PrinterError("Este dispositivo USB não parece ser uma impressora ESC/POS.");
      }
      await device.claimInterface(found.iface.interfaceNumber);
      this.device = device;
      this.endpoint = {
        number: found.endpoint.endpointNumber,
        packet: found.endpoint.packetSize || 64,
      };
      this.setStatus({ state: "conectado", deviceName: deviceName(device) });
    } catch (cause) {
      const message =
        cause instanceof PrinterError
          ? cause.message
          : `Não foi possível abrir a impressora USB. ${WEBUSB_WINDOWS_HINT}`;
      this.setStatus({ state: "erro", message, deviceName: deviceName(device) });
      throw new PrinterError(message, cause);
    }
  }

  async connect() {
    this.requireAvailable();
    if (this.device?.opened && this.endpoint) return;
    const devices = await usbApi()!.getDevices();
    const device =
      devices.find((candidate) => usbDeviceId(candidate) === this.savedId) ??
      (devices.length === 1 ? devices[0] : undefined);
    if (!device) {
      const message = 'Clique em "Escolher dispositivo USB" para autorizar a impressora.';
      this.setStatus({ state: "desconectado", message });
      throw new PrinterError(message);
    }
    await this.open(device);
  }

  async write(bytes: Uint8Array) {
    const device = this.device;
    const endpoint = this.endpoint;
    if (!device || !endpoint) throw new PrinterError("A impressora USB não está conectada.");
    const chunk = Math.max(64, endpoint.packet * 8);
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      const result = await device.transferOut(endpoint.number, bytes.slice(offset, offset + chunk));
      if (result.status !== "ok")
        throw new PrinterError("A impressora USB recusou os dados.", result.status);
    }
  }

  async disconnect() {
    const device = this.device;
    this.device = null;
    this.endpoint = null;
    if (device?.opened) {
      try {
        await device.close();
      } catch (cause) {
        console.error("[impressão] erro ao fechar o USB", cause);
      }
    }
    this.setStatus({ state: "desconectado" });
  }
}
