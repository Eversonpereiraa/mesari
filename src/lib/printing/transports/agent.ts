/**
 * Transportes que passam pelo agente local (/print-agent): rede no PC, impressora instalada no
 * Windows e porta COM. O agente roda em http://localhost:9123 e faz o acesso que o navegador
 * não consegue fazer sozinho.
 */
import type { BaudRate, ConnectionKind } from "../config";
import { DEFAULT_AGENT_URL } from "../config";
import { BaseTransport, PrinterError, toBase64, withTimeout, type Availability } from "./base";

export type AgentHealth = { ok: true; versao: string } | { ok: false };
export type WindowsPrinterInfo = { nome: string; padrao: boolean; porta: string; driver: string };

export const AGENT_NOT_FOUND =
  "Agente de impressão não encontrado. Abra o Mesari Print Agent neste computador.";

function agentBase(url: string) {
  return (url || DEFAULT_AGENT_URL).replace(/\/+$/, "").replace(/\/print$/, "");
}

async function agentFetch(baseUrl: string, path: string, init: RequestInit = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${agentBase(baseUrl)}${path}`, { ...init, signal: controller.signal });
  } catch (cause) {
    throw new PrinterError(AGENT_NOT_FOUND, cause);
  } finally {
    clearTimeout(timer);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // Resposta sem JSON: tratada pelo status abaixo.
  }
  if (!response.ok || body["ok"] === false) {
    // O agente devolve "mensagem" amigável e "detalhe" técnico.
    const message =
      typeof body["mensagem"] === "string" && body["mensagem"]
        ? body["mensagem"]
        : "O agente de impressão não conseguiu concluir o pedido.";
    throw new PrinterError(message, body["detalhe"] ?? `HTTP ${response.status}`);
  }
  return body;
}

export async function agentHealth(baseUrl: string): Promise<AgentHealth> {
  try {
    const body = await agentFetch(baseUrl, "/health", {}, 2500);
    return { ok: true, versao: String(body["versao"] ?? "") };
  } catch {
    return { ok: false };
  }
}

export async function listWindowsPrinters(baseUrl: string): Promise<WindowsPrinterInfo[]> {
  const body = await agentFetch(baseUrl, "/printers", {}, 15000);
  const list = Array.isArray(body["impressoras"]) ? body["impressoras"] : [];
  return list.map((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    return {
      nome: String(item["nome"] ?? ""),
      padrao: item["padrao"] === true,
      porta: String(item["porta"] ?? ""),
      driver: String(item["driver"] ?? ""),
    };
  });
}

export async function listSerialPorts(baseUrl: string): Promise<string[]> {
  const body = await agentFetch(baseUrl, "/serial-ports", {}, 15000);
  return Array.isArray(body["portas"]) ? body["portas"].map(String) : [];
}

type Target =
  | { tipo: "rede"; ip: string; porta: number }
  | { tipo: "windows"; impressora: string }
  | { tipo: "serial"; com: string; baud: BaudRate };

abstract class AgentTransport extends BaseTransport {
  constructor(protected agentUrl: string) {
    super();
  }

  protected abstract target(): Target;
  protected abstract describe(): string;

  isAvailable(): Availability {
    if (typeof fetch === "undefined") {
      return { available: false, reason: "Este navegador não consegue falar com o agente." };
    }
    return { available: true };
  }

  /** Confere se o agente está rodando e se ele alcança a impressora. */
  async connect() {
    this.requireAvailable();
    const target = this.target();
    // Já conferido e nada falhou desde então: não repete a checagem a cada impressão.
    if (this.status.state === "conectado") return;
    this.setStatus({ state: "conectando", deviceName: this.describe() });
    try {
      await withTimeout(
        agentFetch(this.agentUrl, "/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(target),
        }),
        8000,
        "A impressora não respondeu a tempo.",
      );
      this.setStatus({ state: "conectado", deviceName: this.describe() });
    } catch (cause) {
      const message = cause instanceof PrinterError ? cause.message : AGENT_NOT_FOUND;
      this.setStatus({ state: "erro", message, deviceName: this.describe() });
      throw cause instanceof PrinterError ? cause : new PrinterError(message, cause);
    }
  }

  async write(bytes: Uint8Array) {
    try {
      await agentFetch(
        this.agentUrl,
        "/print",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...this.target(), dados: toBase64(bytes) }),
        },
        30000,
      );
      this.setStatus({ state: "conectado", deviceName: this.describe() });
    } catch (cause) {
      const message = cause instanceof PrinterError ? cause.message : AGENT_NOT_FOUND;
      this.setStatus({ state: "erro", message, deviceName: this.describe() });
      throw cause;
    }
  }

  async disconnect() {
    this.setStatus({ state: "desconectado" });
  }
}

export class NetworkAgentTransport extends AgentTransport {
  readonly kind: ConnectionKind = "rede";
  constructor(
    agentUrl: string,
    private ip: string,
    private port: number,
  ) {
    super(agentUrl);
  }
  protected target(): Target {
    if (!this.ip) throw new PrinterError("Informe o IP da impressora.");
    return { tipo: "rede", ip: this.ip, porta: this.port || 9100 };
  }
  protected describe() {
    return `${this.ip}:${this.port || 9100}`;
  }
}

export class WindowsPrinterAgentTransport extends AgentTransport {
  readonly kind: ConnectionKind = "windows";
  constructor(
    agentUrl: string,
    private printer: string,
  ) {
    super(agentUrl);
  }
  protected target(): Target {
    if (!this.printer) throw new PrinterError("Escolha a impressora do Windows.");
    return { tipo: "windows", impressora: this.printer };
  }
  protected describe() {
    return this.printer;
  }
}

export class SerialAgentTransport extends AgentTransport {
  readonly kind: ConnectionKind = "serial";
  constructor(
    agentUrl: string,
    private com: string,
    private baud: BaudRate,
  ) {
    super(agentUrl);
  }
  protected target(): Target {
    if (!this.com) throw new PrinterError("Escolha a porta COM da impressora.");
    return { tipo: "serial", com: this.com, baud: this.baud };
  }
  protected describe() {
    return `${this.com} · ${this.baud}`;
  }
}
