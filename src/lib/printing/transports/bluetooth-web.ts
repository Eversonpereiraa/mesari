/**
 * Bluetooth BLE pelo navegador (Web Bluetooth: Chrome/Edge no PC e Chrome no Android).
 * Impressoras só Bluetooth clássico (SPP) não aparecem aqui: use o app Android.
 */
import { BaseTransport, PrinterError, sleep, type Availability } from "./base";

export const BLE_PRINTER_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
];
const CHUNK = 180;
const INTERVAL_MS = 20;

type Properties = { write: boolean; writeWithoutResponse: boolean };
type Characteristic = {
  properties: Properties;
  writeValueWithoutResponse?(value: BufferSource): Promise<void>;
  writeValueWithResponse?(value: BufferSource): Promise<void>;
  writeValue(value: BufferSource): Promise<void>;
};
type Service = { getCharacteristics(): Promise<Characteristic[]> };
type Gatt = {
  connected: boolean;
  connect(): Promise<Gatt>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<Service>;
  getPrimaryServices(): Promise<Service[]>;
};
export type BleDevice = EventTarget & { id: string; name?: string; gatt?: Gatt };
type BluetoothApi = {
  getAvailability?(): Promise<boolean>;
  requestDevice(options: {
    acceptAllDevices: boolean;
    optionalServices: string[];
  }): Promise<BleDevice>;
  getDevices?(): Promise<BleDevice[]>;
};

function bluetoothApi(): BluetoothApi | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { bluetooth?: BluetoothApi }).bluetooth ?? null;
}

export class BluetoothWebTransport extends BaseTransport {
  readonly kind = "bluetooth" as const;
  private device: BleDevice | null = null;
  private characteristic: Characteristic | null = null;

  constructor(
    private savedId: string | undefined,
    private onChosen: (id: string, name: string) => void = () => undefined,
  ) {
    super();
  }

  isAvailable(): Availability {
    if (!bluetoothApi() || typeof window === "undefined" || !window.isSecureContext) {
      return { available: false, reason: "Bluetooth não é suportado neste navegador." };
    }
    return { available: true };
  }

  /** Abre o seletor do navegador. Precisa ser chamado num clique. */
  async choose() {
    this.requireAvailable();
    let device: BleDevice;
    try {
      device = await bluetoothApi()!.requestDevice({
        acceptAllDevices: true,
        optionalServices: BLE_PRINTER_SERVICES,
      });
    } catch (cause) {
      throw new PrinterError("Nenhuma impressora Bluetooth foi escolhida.", cause);
    }
    await this.disconnect();
    this.savedId = device.id;
    this.onChosen(device.id, device.name || "Impressora Bluetooth");
    await this.open(device);
  }

  private async findWritable(gatt: Gatt) {
    const services: Service[] = [];
    for (const uuid of BLE_PRINTER_SERVICES) {
      try {
        services.push(await gatt.getPrimaryService(uuid));
      } catch {
        // Serviço ausente neste modelo: tenta o próximo.
      }
    }
    if (!services.length) {
      try {
        services.push(...(await gatt.getPrimaryServices()));
      } catch {
        // Sem permissão para listar os demais serviços.
      }
    }
    for (const service of services) {
      const characteristics = await service.getCharacteristics();
      const writable =
        characteristics.find((item) => item.properties.writeWithoutResponse) ??
        characteristics.find((item) => item.properties.write);
      if (writable) return writable;
    }
    return null;
  }

  private async open(device: BleDevice) {
    const name = device.name || "Impressora Bluetooth";
    this.setStatus({ state: "conectando", deviceName: name });
    try {
      if (!device.gatt) throw new PrinterError("Este dispositivo não oferece conexão BLE.");
      const gatt = device.gatt.connected ? device.gatt : await device.gatt.connect();
      const characteristic = await this.findWritable(gatt);
      if (!characteristic) {
        throw new PrinterError(
          "A impressora Bluetooth não tem um canal de escrita conhecido. Se ela for Bluetooth clássico, use o app Android.",
        );
      }
      if (this.device !== device) {
        device.addEventListener("gattserverdisconnected", () => {
          if (this.device !== device) return;
          this.characteristic = null;
          this.setStatus({ state: "desconectado", message: "A impressora Bluetooth desconectou." });
        });
      }
      this.device = device;
      this.characteristic = characteristic;
      this.setStatus({ state: "conectado", deviceName: name });
    } catch (cause) {
      const message =
        cause instanceof PrinterError
          ? cause.message
          : "Não foi possível conectar à impressora Bluetooth. Verifique se ela está ligada e por perto.";
      this.setStatus({ state: "erro", message, deviceName: name });
      throw new PrinterError(message, cause);
    }
  }

  async connect() {
    this.requireAvailable();
    if (this.device?.gatt?.connected && this.characteristic) return;
    let device = this.device;
    if (!device && this.savedId) {
      const known = (await bluetoothApi()!.getDevices?.()) ?? [];
      device = known.find((candidate) => candidate.id === this.savedId) ?? null;
    }
    if (!device) {
      const message = 'Clique em "Procurar impressora Bluetooth" para escolher a impressora.';
      this.setStatus({ state: "desconectado", message });
      throw new PrinterError(message);
    }
    await this.open(device);
  }

  async write(bytes: Uint8Array) {
    const characteristic = this.characteristic;
    if (!characteristic) throw new PrinterError("A impressora Bluetooth não está conectada.");
    const withoutResponse =
      characteristic.properties.writeWithoutResponse && characteristic.writeValueWithoutResponse;
    for (let offset = 0; offset < bytes.length; offset += CHUNK) {
      const part = bytes.slice(offset, offset + CHUNK);
      if (withoutResponse) await characteristic.writeValueWithoutResponse!(part);
      else if (characteristic.writeValueWithResponse)
        await characteristic.writeValueWithResponse(part);
      else await characteristic.writeValue(part);
      await sleep(INTERVAL_MS);
    }
  }

  async disconnect() {
    const device = this.device;
    this.device = null;
    this.characteristic = null;
    if (device?.gatt?.connected) device.gatt.disconnect();
    this.setStatus({ state: "desconectado" });
  }
}
