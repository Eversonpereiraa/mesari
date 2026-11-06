import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConfig, resetConfigCache, saveConfig } from "@/lib/printing/config";
import { createTransport, imprimirComanda, resetPrinterForTests } from "@/lib/printing/printer";
import { ElectronTransport } from "@/lib/printing/transports/electron";
import { NetworkAgentTransport } from "@/lib/printing/transports/agent";
import { sampleDeliveryTicket, sampleKitchenTicket } from "@/lib/printing/comandas";
import { PrinterError } from "@/lib/printing/transports/base";

function installDesktop(printer: Partial<MesariDesktopPrinterApi>) {
  Object.defineProperty(window, "mesariDesktop", {
    configurable: true,
    value: {
      isDesktop: true,
      getSettings: vi.fn(),
      setSettings: vi.fn(),
      listPrinters: vi.fn(),
      print: vi.fn(),
      printer: {
        network: vi.fn(async () => ({ ok: true })),
        windows: vi.fn(async () => ({ ok: true })),
        serial: vi.fn(async () => ({ ok: true })),
        listWindows: vi.fn(async () => []),
        listSerial: vi.fn(async () => []),
        ...printer,
      },
    },
  });
  return window.mesariDesktop!.printer!;
}

beforeEach(() => {
  localStorage.clear();
  resetConfigCache();
  resetPrinterForTests();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  Reflect.deleteProperty(window, "mesariDesktop");
  vi.restoreAllMocks();
});

describe("ElectronTransport", () => {
  it("é usado automaticamente no app desktop; no navegador continua o agente", () => {
    const config = { ...defaultConfig(), connection: "rede" as const, ip: "10.0.0.9" };
    expect(createTransport(config)).toBeInstanceOf(NetworkAgentTransport);
    installDesktop({});
    expect(createTransport(config)).toBeInstanceOf(ElectronTransport);
    expect(createTransport({ ...config, connection: "windows" })).toBeInstanceOf(ElectronTransport);
    expect(createTransport({ ...config, connection: "serial" })).toBeInstanceOf(ElectronTransport);
  });

  it("app desktop antigo (sem API de impressora) continua no caminho do navegador", () => {
    Object.defineProperty(window, "mesariDesktop", {
      configurable: true,
      value: { isDesktop: true },
    });
    const config = { ...defaultConfig(), connection: "rede" as const, ip: "10.0.0.9" };
    expect(createTransport(config)).toBeInstanceOf(NetworkAgentTransport);
  });

  it("envia os bytes ESC/POS pela ponte nativa (teste de conexão + impressão)", async () => {
    const printer = installDesktop({});
    saveConfig({ ...defaultConfig(), connection: "serial", comPort: "COM5", comBaudRate: 9600 });
    await imprimirComanda(sampleKitchenTicket());
    expect(printer.serial).toHaveBeenNthCalledWith(1, { com: "COM5", baud: 9600 }, null);
    const [target, data] = vi.mocked(printer.serial).mock.calls[1]!;
    expect(target).toEqual({ com: "COM5", baud: 9600 });
    expect(Array.from((data as Uint8Array).slice(0, 2))).toEqual([0x1b, 0x40]);
  });

  it("repassa a mensagem amigável do processo main", async () => {
    installDesktop({
      network: vi.fn(async () => ({
        ok: false as const,
        mensagem: "Não foi possível conectar à impressora em 10.0.0.9:9100.",
        detalhe: "ECONNREFUSED",
      })),
    });
    saveConfig({ ...defaultConfig(), connection: "rede", ip: "10.0.0.9" });
    const error = await imprimirComanda(sampleDeliveryTicket()).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(PrinterError);
    expect((error as Error).message).toBe(
      "Não foi possível conectar à impressora em 10.0.0.9:9100.",
    );
  });
});
