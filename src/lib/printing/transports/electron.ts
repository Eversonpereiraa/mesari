/**
 * Impressão nativa do app desktop (Electron): rede, impressora do Windows e porta COM vão
 * direto pelo processo main, sem agente. Usado automaticamente quando o app desktop 1.1+ está
 * presente (window.mesariDesktop.printer).
 */
import type { BaudRate, ConnectionKind } from "../config";
import { BaseTransport, PrinterError, withTimeout, type Availability } from "./base";

export function desktopPrinterApi(): MesariDesktopPrinterApi | null {
  if (typeof window === "undefined") return null;
  return window.mesariDesktop?.printer ?? null;
}

export function isDesktopApp() {
  return Boolean(desktopPrinterApi());
}

type Target =
  | { kind: "rede"; ip: string; porta: number }
  | { kind: "windows"; impressora: string }
  | { kind: "serial"; com: string; baud: BaudRate };

export class ElectronTransport extends BaseTransport {
  readonly kind: ConnectionKind;

  constructor(private target: Target) {
    super();
    this.kind = target.kind;
  }

  isAvailable(): Availability {
    return desktopPrinterApi()
      ? { available: true }
      : { available: false, reason: "Disponível só no app desktop do Mesari." };
  }

  private describe() {
    const target = this.target;
    if (target.kind === "rede") return `${target.ip}:${target.porta}`;
    if (target.kind === "windows") return target.impressora;
    return `${target.com} · ${target.baud}`;
  }

  private validate() {
    const target = this.target;
    if (target.kind === "rede" && !target.ip) throw new PrinterError("Informe o IP da impressora.");
    if (target.kind === "windows" && !target.impressora) {
      throw new PrinterError("Escolha a impressora do Windows.");
    }
    if (target.kind === "serial" && !target.com) {
      throw new PrinterError("Escolha a porta da impressora.");
    }
  }

  private async send(data: Uint8Array | null) {
    this.requireAvailable();
    this.validate();
    const api = desktopPrinterApi()!;
    const target = this.target;
    const outcome =
      target.kind === "rede"
        ? await api.network({ ip: target.ip, porta: target.porta }, data)
        : target.kind === "windows"
          ? await api.windows({ impressora: target.impressora }, data)
          : await api.serial({ com: target.com, baud: target.baud }, data);
    if (!outcome.ok) {
      this.setStatus({ state: "erro", message: outcome.mensagem, deviceName: this.describe() });
      throw new PrinterError(outcome.mensagem, outcome.detalhe);
    }
    this.setStatus({ state: "conectado", deviceName: this.describe() });
  }

  async connect() {
    if (this.status.state === "conectado") return;
    this.setStatus({ state: "conectando", deviceName: this.describe() });
    await withTimeout(this.send(null), 10_000, "A impressora não respondeu a tempo.");
  }

  async write(bytes: Uint8Array) {
    await this.send(bytes);
  }

  async disconnect() {
    this.setStatus({ state: "desconectado" });
  }
}
