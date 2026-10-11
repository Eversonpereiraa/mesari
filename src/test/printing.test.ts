import { afterEach, describe, expect, it, vi } from "vitest";
import {
  connectPrinter,
  connectUsbPrinter,
  disconnectPrinter,
  getDefaultPrintSettings,
  getPrintSettings,
  printReceipt,
  printReceiptOnce,
  printKitchenTicket,
  printTestPage,
  savePrintSettings,
  type KitchenTicket,
  type PrintReceipt,
  type PrintSettings,
} from "@/lib/printing";
import type { PrintRestaurant } from "@/lib/printing";

const restaurant: PrintRestaurant = {
  name: "Mesari",
  address: "Rua de teste",
  phone: "",
  cnpj: "",
  instagram: "",
};

function sampleReceipt(id = "sale-1"): PrintReceipt {
  return {
    id,
    at: new Date("2025-01-01T12:00:00").getTime(),
    table: 3,
    saleNumber: 8,
    lines: [
      {
        id: "item-1",
        name: "Café",
        qty: 2,
        price: 5,
        note: "Sem açúcar",
        waiter: "Ana",
      },
    ],
    subtotal: 10,
    serviceCharge: 1,
    total: 11,
  };
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serial");
  Reflect.deleteProperty(navigator, "usb");
  Reflect.deleteProperty(window, "mesariDesktop");
});

describe("configurações da impressora", () => {
  it("persiste localmente e aplica os valores padrão às preferências ausentes", () => {
    const settings: PrintSettings = {
      ...getDefaultPrintSettings(),
      paperWidth: 58,
      copies: 2,
      printerMode: "browser",
    };
    savePrintSettings(settings);

    expect(getPrintSettings()).toMatchObject({
      paperWidth: 58,
      copies: 2,
      printerMode: "browser",
      autoPrintOnClose: true,
      showKitchenPrices: true,
    });
  });

  it("apresenta o motivo quando a conexão direta não está disponível", async () => {
    await expect(connectPrinter()).rejects.toThrow(
      "Seu navegador não oferece suporte à conexão direta da impressora.",
    );
  });

  it("usa a fila de impressão do desktop para notas e comandas sem tentar USB/serial", async () => {
    const nativePrint = vi.fn().mockResolvedValue({ ok: true });
    Object.defineProperty(window, "mesariDesktop", {
      configurable: true,
      value: {
        isDesktop: true,
        print: nativePrint,
        getSettings: vi.fn().mockResolvedValue({
          printerNota: "Elgin Nota",
          printerComanda: "Elgin Cozinha",
          iniciarComWindows: true,
          manterEmSegundoPlano: true,
          impedirSuspensao: true,
        }),
      },
    });

    const receiptResult = await printReceipt(sampleReceipt(), restaurant, {
      ...getDefaultPrintSettings(),
      paperWidth: 80,
      copies: 2,
    });
    const ticket: KitchenTicket = {
      id: "kitchen-1",
      number: 7,
      table: 4,
      sector: "cozinha",
      waiter: "Ana",
      additional: false,
      createdAt: Date.now(),
      items: [{ product: "Café", quantity: 1, note: "" }],
    };
    const ticketResult = await printKitchenTicket(ticket, getDefaultPrintSettings(), false);

    expect(receiptResult).toEqual({ method: "desktop" });
    expect(ticketResult).toEqual({ method: "desktop" });
    expect(nativePrint).toHaveBeenCalledTimes(2);
    expect(nativePrint.mock.calls[0]?.[0]).toMatchObject({
      printerName: "Elgin Nota",
      widthMm: 80,
      copies: 2,
    });
    expect(nativePrint.mock.calls[0]?.[0].html.match(/<article>/g)).toHaveLength(1);
    expect(nativePrint.mock.calls[1]?.[0]).toMatchObject({
      printerName: "Elgin Cozinha",
      widthMm: 58,
      copies: 1,
    });
    expect(nativePrint.mock.calls[1]?.[0].html).toContain("PEDIDO #7");

    nativePrint.mockResolvedValueOnce({ ok: false, error: "Falha do driver" });
    await expect(printKitchenTicket(ticket, getDefaultPrintSettings(), false)).rejects.toThrow(
      "Falha do driver",
    );
  });

  it("envia ESC/POS direto e evita duplicar a mesma impressão automática", async () => {
    const written: Uint8Array[] = [];
    const writable = new WritableStream<Uint8Array>({
      write(chunk) {
        written.push(chunk);
      },
    });
    const port: {
      readable: ReadableStream<Uint8Array> | null;
      writable: WritableStream<Uint8Array> | null;
      open: () => Promise<void>;
      close: () => Promise<void>;
      getInfo: () => { usbVendorId: number; usbProductId: number };
    } = {
      readable: null,
      writable: null,
      open: async () => {
        port.writable = writable;
      },
      close: async () => {
        port.writable = null;
      },
      getInfo: () => ({ usbVendorId: 1234, usbProductId: 5678 }),
    };
    const serial = {
      getPorts: vi.fn(async () => [port]),
      requestPort: vi.fn(async () => port),
      addEventListener: vi.fn(),
    };
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "serial", { configurable: true, value: serial });
    savePrintSettings(getDefaultPrintSettings());

    await connectPrinter();
    const receipt = sampleReceipt();
    await Promise.all([
      printReceiptOnce(receipt, restaurant),
      printReceiptOnce(receipt, restaurant),
    ]);

    expect(written.length).toBeGreaterThan(1);
    expect(written.every((chunk) => chunk.length <= 512)).toBe(true);
    const receiptData = written.flatMap((chunk) => Array.from(chunk));
    expect(receiptData).toContain(0x1d);
    expect(receiptData).toContain(130);
    expect(
      receiptData.filter((byte, index) => byte === 0x1b && receiptData[index + 1] === 0x40),
    ).toHaveLength(1);
    expect(serial.requestPort).toHaveBeenCalledTimes(1);
    await disconnectPrinter();
  });

  it("conecta pela interface USB classe 7 e envia ESC/POS em blocos de 512 bytes", async () => {
    const transfers: Uint8Array[] = [];
    const device = {
      vendorId: 1234,
      productId: 5678,
      productName: "Impressora USB",
      configuration: null as null | {
        interfaces: {
          interfaceNumber: number;
          alternate: {
            interfaceClass: number;
            endpoints: { direction: "out"; type: string; endpointNumber: number }[];
          };
        }[];
      },
      opened: false,
      open: async () => {
        device.opened = true;
      },
      close: async () => {
        device.opened = false;
      },
      selectConfiguration: async () => {
        device.configuration = {
          interfaces: [
            {
              interfaceNumber: 0,
              alternate: {
                interfaceClass: 7,
                endpoints: [{ direction: "out", type: "bulk", endpointNumber: 1 }],
              },
            },
          ],
        };
      },
      claimInterface: vi.fn(async () => {}),
      transferOut: vi.fn(async (_endpoint: number, data: BufferSource) => {
        transfers.push(new Uint8Array(data as ArrayBuffer));
        return { status: "ok" };
      }),
    };
    const usb = {
      getDevices: vi.fn(async () => [device]),
      requestDevice: vi.fn(async (options: { filters: { classCode?: number }[] }) => {
        expect(options.filters).toEqual([{ classCode: 7 }]);
        return device;
      }),
      addEventListener: vi.fn(),
    };
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "usb", { configurable: true, value: usb });

    await connectUsbPrinter();
    await printKitchenTicket(
      {
        id: "usb-ticket",
        number: 7,
        table: 5,
        sector: "cozinha",
        waiter: "Ana",
        additional: false,
        createdAt: Date.now(),
        items: Array.from({ length: 30 }, (_, index) => ({
          product: `Prato quente com acompanhamentos variados ${index + 1}`,
          quantity: 1,
          note: "",
        })),
      },
      getDefaultPrintSettings(),
      false,
    );

    expect(device.claimInterface).toHaveBeenCalledWith(0);
    expect(transfers.length).toBeGreaterThan(0);
    expect(transfers.every((chunk) => chunk.length <= 512)).toBe(true);
    await disconnectPrinter();
  });

  it("usa a prévia de impressão do navegador como método alternativo", async () => {
    const printed = vi.fn(function (this: { onafterprint: (() => void) | null }) {
      this.onafterprint?.();
    });
    const append = vi.spyOn(document.body, "append").mockImplementation((...nodes) => {
      const frame = nodes[0] as HTMLIFrameElement;
      Object.defineProperty(frame, "contentWindow", {
        configurable: true,
        value: { focus: vi.fn(), print: printed, onafterprint: null },
      });
      frame.onload?.(new Event("load"));
    });

    const result = await printTestPage({ ...getDefaultPrintSettings(), printerMode: "browser" });

    expect(result.method).toBe("browser");
    expect(printed).toHaveBeenCalledOnce();
    append.mockRestore();
  });

  it("mantém a nota identificada pelo restaurante, sem atribuí-la ao Mesari", async () => {
    let printedHtml = "";
    const printed = vi.fn(function (this: { onafterprint: (() => void) | null }) {
      this.onafterprint?.();
    });
    const append = vi.spyOn(document.body, "append").mockImplementation((...nodes) => {
      const frame = nodes[0] as HTMLIFrameElement;
      printedHtml = frame.srcdoc;
      Object.defineProperty(frame, "contentWindow", {
        configurable: true,
        value: { focus: vi.fn(), print: printed, onafterprint: null },
      });
      frame.onload?.(new Event("load"));
    });

    await printReceipt(
      sampleReceipt("sale-separated"),
      {
        ...restaurant,
        name: "Sabor da Roça",
      },
      { ...getDefaultPrintSettings(), printerMode: "browser" },
    );

    expect(printedHtml).toContain("Sabor da Roça");
    expect(printedHtml).not.toContain("MESARI");
    append.mockRestore();
  });

  it("imprime as formas de pagamento e os valores de troco", async () => {
    let printedHtml = "";
    const printed = vi.fn(function (this: { onafterprint: (() => void) | null }) {
      this.onafterprint?.();
    });
    const append = vi.spyOn(document.body, "append").mockImplementation((...nodes) => {
      const frame = nodes[0] as HTMLIFrameElement;
      printedHtml = frame.srcdoc;
      Object.defineProperty(frame, "contentWindow", {
        configurable: true,
        value: { focus: vi.fn(), print: printed, onafterprint: null },
      });
      frame.onload?.(new Event("load"));
    });

    await printReceipt(
      {
        ...sampleReceipt("sale-payments"),
        payments: [
          { forma: "pix", valor: 5 },
          { forma: "dinheiro", valor: 6, recebido: 10, troco: 4 },
        ],
      },
      restaurant,
      { ...getDefaultPrintSettings(), printerMode: "browser" },
    );

    expect(printedHtml).toContain("Pix");
    expect(printedHtml).toContain("Dinheiro");
    expect(printedHtml).toContain("Recebido");
    expect(printedHtml).toContain("Troco");
    append.mockRestore();
  });

  it("imprime comanda de cozinha com setor omitido, mesa e observação destacados", async () => {
    let printedHtml = "";
    const printed = vi.fn(function (this: { onafterprint: (() => void) | null }) {
      this.onafterprint?.();
    });
    const append = vi.spyOn(document.body, "append").mockImplementation((...nodes) => {
      const frame = nodes[0] as HTMLIFrameElement;
      printedHtml = frame.srcdoc;
      Object.defineProperty(frame, "contentWindow", {
        configurable: true,
        value: { focus: vi.fn(), print: printed, onafterprint: null },
      });
      frame.onload?.(new Event("load"));
    });

    await printKitchenTicket(
      {
        id: "kitchen-1",
        number: 19,
        table: 5,
        sector: "cozinha",
        waiter: "Ana",
        additional: true,
        createdAt: new Date("2026-10-08T12:00:00").getTime(),
        items: [{ product: "Picanha na chapa", quantity: 2, note: "sem cebola" }],
      },
      { ...getDefaultPrintSettings(), printerMode: "browser", paperWidth: 58 },
    );

    expect(printedHtml).not.toContain("COZINHA");
    expect(printedHtml).not.toContain(">BAR<");
    expect(printedHtml).toContain("PEDIDO #19");
    expect(printedHtml).toContain("MESA 05");
    expect(printedHtml).toContain("** ADICIONAL **");
    expect(printedHtml).toContain("2x&nbsp; Picanha na chapa");
    expect(printedHtml).toContain("&gt;&gt; sem cebola");
    expect(printedHtml).not.toContain("R$");
    expect(printedHtml).toContain("58mm");
    append.mockRestore();
  });

  it("imprime valores por item e o total do pedido quando habilitado", async () => {
    let printedHtml = "";
    const printed = vi.fn(function (this: { onafterprint: (() => void) | null }) {
      this.onafterprint?.();
    });
    const append = vi.spyOn(document.body, "append").mockImplementation((...nodes) => {
      const frame = nodes[0] as HTMLIFrameElement;
      printedHtml = frame.srcdoc;
      Object.defineProperty(frame, "contentWindow", {
        configurable: true,
        value: { focus: vi.fn(), print: printed, onafterprint: null },
      });
      frame.onload?.(new Event("load"));
    });

    await printKitchenTicket(
      {
        id: "bar-order",
        number: 20,
        table: 5,
        sector: "bar",
        waiter: "Ana",
        additional: false,
        createdAt: new Date("2026-10-08T12:00:00").getTime(),
        items: [{ product: "Suco de laranja", quantity: 2, note: "", unitPrice: 12.5 }],
      },
      { ...getDefaultPrintSettings(), printerMode: "browser" },
    );

    expect(printedHtml).toContain("PEDIDO #20");
    expect(printedHtml).toContain(">BAR</div>");
    expect(printedHtml).toContain("2x&nbsp; Suco de laranja");
    expect(printedHtml).toContain("R$\u00a025,00");
    expect(printedHtml).toContain("R$\u00a012,50 un.");
    expect(printedHtml).toContain("TOTAL DO PEDIDO R$\u00a025,00");
    append.mockRestore();
  });

  it("omite valores quando desabilitados ou quando a comanda antiga não tem preços", async () => {
    let printedHtml = "";
    const printed = vi.fn(function (this: { onafterprint: (() => void) | null }) {
      this.onafterprint?.();
    });
    const append = vi.spyOn(document.body, "append").mockImplementation((...nodes) => {
      const frame = nodes[0] as HTMLIFrameElement;
      printedHtml = frame.srcdoc;
      Object.defineProperty(frame, "contentWindow", {
        configurable: true,
        value: { focus: vi.fn(), print: printed, onafterprint: null },
      });
      frame.onload?.(new Event("load"));
    });
    const ticket: KitchenTicket = {
      id: "legacy-order",
      number: 21,
      table: 2,
      sector: "cozinha",
      waiter: "Bia",
      additional: false,
      createdAt: Date.now(),
      items: [{ product: "Café", quantity: 1, note: "" }],
    };

    await printKitchenTicket(ticket, {
      ...getDefaultPrintSettings(),
      printerMode: "browser",
      showKitchenPrices: false,
    });
    expect(printedHtml).not.toContain("R$");
    expect(printedHtml).not.toContain("TOTAL DO PEDIDO");

    await printKitchenTicket(ticket, {
      ...getDefaultPrintSettings(),
      printerMode: "browser",
      showKitchenPrices: true,
    });
    expect(printedHtml).not.toContain("R$");
    expect(printedHtml).not.toContain("TOTAL DO PEDIDO");
    append.mockRestore();
  });
});
