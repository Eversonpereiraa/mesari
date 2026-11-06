/**
 * Transportes do app Android (Capacitor). Os plugins só são carregados dentro do app, então o
 * site no navegador não baixa nada disso.
 */
import {
  BaseTransport,
  PrinterError,
  isNativeApp,
  toBase64,
  withTimeout,
  type Availability,
} from "./base";

const NOT_NATIVE: Availability = {
  available: false,
  reason: "Disponível só no app Android do Mesari.",
};

/** Rede direta: socket TCP em IP:9100, sem agente. */
export class NativeTcpTransport extends BaseTransport {
  readonly kind = "rede" as const;

  constructor(
    private ip: string,
    private port: number,
  ) {
    super();
  }

  isAvailable(): Availability {
    return isNativeApp() ? { available: true } : NOT_NATIVE;
  }

  private async session<T>(work: (send: (bytes: Uint8Array) => Promise<void>) => Promise<T>) {
    this.requireAvailable();
    if (!this.ip) throw new PrinterError("Informe o IP da impressora.");
    const { TcpSocket, DataEncoding } = await import("capacitor-tcp-socket");
    const name = `${this.ip}:${this.port || 9100}`;
    this.setStatus({ state: "conectando", deviceName: name });
    let client: number;
    try {
      ({ client } = await withTimeout(
        TcpSocket.connect({ ipAddress: this.ip, port: this.port || 9100 }),
        8000,
        "A impressora não respondeu no endereço informado.",
      ));
    } catch (cause) {
      const message = "Não foi possível conectar à impressora pela rede. Confira o IP e a porta.";
      this.setStatus({ state: "erro", message, deviceName: name });
      throw new PrinterError(message, cause);
    }
    try {
      const result = await work((bytes) =>
        TcpSocket.send({ client, data: toBase64(bytes), encoding: DataEncoding.BASE64 }),
      );
      this.setStatus({ state: "conectado", deviceName: name });
      return result;
    } finally {
      await TcpSocket.disconnect({ client }).catch((cause: unknown) =>
        console.error("[impressão] erro ao fechar o socket", cause),
      );
    }
  }

  async connect() {
    if (this.status.state === "conectado") return;
    await this.session(async () => undefined);
  }

  async write(bytes: Uint8Array) {
    // Uma conexão por trabalho: a impressora fecha conexões paradas.
    await this.session((send) => send(bytes));
  }

  async disconnect() {
    this.setStatus({ state: "desconectado" });
  }
}

export type PairedDevice = { name: string; address: string };

async function thermalPrinter() {
  const { ThermalPrinter } = await import("@devlas/capacitor-thermal-printer");
  return ThermalPrinter;
}

/** Lista as impressoras Bluetooth já pareadas no Android. */
export async function listPairedBluetooth(): Promise<PairedDevice[]> {
  if (!isNativeApp()) return [];
  const plugin = await thermalPrinter();
  try {
    const { devices } = await plugin.list({ transport: "bluetooth" });
    return devices
      .filter((device) => device.address)
      .map((device) => ({ name: device.name || device.address!, address: device.address! }));
  } catch (cause) {
    throw new PrinterError(
      "Não foi possível listar os aparelhos pareados. Permita o acesso ao Bluetooth nas configurações do app.",
      cause,
    );
  }
}

/** Bluetooth clássico (SPP) pelo app Android. A impressora precisa estar pareada no Android. */
export class NativeBluetoothTransport extends BaseTransport {
  readonly kind = "bluetoothNativo" as const;

  constructor(
    private address: string | undefined,
    private name: string | undefined,
  ) {
    super();
  }

  isAvailable(): Availability {
    return isNativeApp() ? { available: true } : NOT_NATIVE;
  }

  private target() {
    if (!this.address) throw new PrinterError("Escolha a impressora na lista de pareados.");
    return { transport: "bluetooth" as const, address: this.address };
  }

  async connect() {
    this.requireAvailable();
    const target = this.target();
    const plugin = await thermalPrinter();
    const deviceName = this.name || target.address;
    this.setStatus({ state: "conectando", deviceName });
    try {
      const { granted } = await plugin.requestPermission(target);
      if (!granted) throw new PrinterError("Permita o acesso ao Bluetooth para imprimir.");
      this.setStatus({ state: "conectado", deviceName });
    } catch (cause) {
      const message =
        cause instanceof PrinterError ? cause.message : "Não foi possível acessar o Bluetooth.";
      this.setStatus({ state: "erro", message, deviceName });
      throw new PrinterError(message, cause);
    }
  }

  async write(bytes: Uint8Array) {
    const target = this.target();
    const plugin = await thermalPrinter();
    try {
      await plugin.print({ ...target, data: toBase64(bytes) });
      this.setStatus({ state: "conectado", deviceName: this.name || target.address });
    } catch (cause) {
      const message = "A impressora Bluetooth não recebeu os dados. Verifique se ela está ligada.";
      this.setStatus({ state: "erro", message, deviceName: this.name || target.address });
      throw new PrinterError(message, cause);
    }
  }

  async disconnect() {
    this.setStatus({ state: "desconectado" });
  }
}
