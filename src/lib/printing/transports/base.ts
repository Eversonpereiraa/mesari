import { Capacitor } from "@capacitor/core";
import type { ConnectionKind } from "../config";

export const FRIENDLY_PRINT_ERROR =
  "Não foi possível imprimir. Verifique se a impressora está ligada e conectada.";

/**
 * Erro com mensagem pronta para o usuário. O detalhe técnico fica em `cause` e só vai para o
 * console.
 */
export class PrinterError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "PrinterError";
  }
}

export type TransportState = "conectado" | "desconectado" | "conectando" | "erro";

export type TransportStatus = {
  state: TransportState;
  /** Mensagem amigável (sem detalhes técnicos). */
  message?: string;
  deviceName?: string;
};

export type Availability = { available: true } | { available: false; reason: string };

export interface PrinterTransport {
  readonly kind: ConnectionKind;
  /** Envia bytes ESC/POS? O navegador recebe HTML (printHtml) em vez de bytes. */
  readonly acceptsBytes: boolean;
  isAvailable(): Availability;
  connect(): Promise<void>;
  write(bytes: Uint8Array): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): TransportStatus;
  printHtml?(html: string, widthMm: number): Promise<void>;
}

type Listener = (status: TransportStatus) => void;

/** Guarda o status e avisa quem estiver ouvindo (a tela "Impressão" e o printer.ts). */
export abstract class BaseTransport implements PrinterTransport {
  abstract readonly kind: ConnectionKind;
  readonly acceptsBytes: boolean = true;
  protected status: TransportStatus = { state: "desconectado" };
  private listeners = new Set<Listener>();

  abstract isAvailable(): Availability;
  abstract connect(): Promise<void>;
  abstract write(bytes: Uint8Array): Promise<void>;
  abstract disconnect(): Promise<void>;

  getStatus() {
    return this.status;
  }

  onStatus(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  protected setStatus(next: TransportStatus) {
    this.status = next;
    this.listeners.forEach((listener) => listener(next));
  }

  protected requireAvailable() {
    const availability = this.isAvailable();
    if (!availability.available) throw new PrinterError(availability.reason);
  }
}

export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PrinterError(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/** Rodando como app Android (Capacitor), e não no navegador. */
export function isNativeApp() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function isSecureBrowser() {
  return typeof window !== "undefined" && window.isSecureContext;
}
