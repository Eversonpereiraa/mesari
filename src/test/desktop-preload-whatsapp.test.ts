import { beforeEach, describe, expect, it, vi } from "vitest";

// O preload do app desktop, rodando com um Electron de mentira.
const electron = vi.hoisted(() => ({
  exposed: {} as Record<string, unknown>,
  invoke: vi.fn(async (..._args: unknown[]) => ({ ok: true }) as { ok: boolean }),
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, api: unknown) => {
      electron.exposed[key] = api;
    },
  },
  ipcRenderer: { invoke: electron.invoke },
}));

const { isAllowedWhatsappUrl, whatsappAppUrl } = await import("../../desktop/preload");

type ExposedApi = {
  openWhatsApp(phone: string, text: string): Promise<{ ok: boolean; error?: string }>;
};
const api = () => electron.exposed["mesariDesktop"] as ExposedApi;

beforeEach(() => electron.invoke.mockClear());

describe("preload: openWhatsApp", () => {
  it("monta whatsapp://send com 55 e manda para o processo principal", async () => {
    await expect(api().openWhatsApp("81997218844", "Olá, José! 😊 #12 & cia")).resolves.toEqual({
      ok: true,
    });
    expect(electron.invoke).toHaveBeenCalledWith(
      "mesari:open-whatsapp",
      "whatsapp://send?phone=5581997218844&text=Ol%C3%A1%2C%20Jos%C3%A9!%20%F0%9F%98%8A%20%2312%20%26%20cia",
    );
  });

  it("telefone inválido nem chega ao processo principal", async () => {
    for (const phone of ["", "123", "9972188", "abc", "5581997218844999"]) {
      await expect(api().openWhatsApp(phone, "oi")).resolves.toMatchObject({ ok: false });
    }
    expect(electron.invoke).not.toHaveBeenCalled();
  });

  it("não deixa o telefone injetar parâmetros ou outra URL", () => {
    expect(whatsappAppUrl("81997218844&text=x", "oi")).toBe(
      "whatsapp://send?phone=5581997218844&text=oi",
    );
    // Só os dígitos passam: o resultado é sempre whatsapp://send.
    expect(whatsappAppUrl("https://evil.example/81997218844", "oi")).toBe(
      "whatsapp://send?phone=5581997218844&text=oi",
    );
    expect(whatsappAppUrl("https://evil.example/", "oi")).toBeNull();
  });

  it("aceita o número já com 55", () => {
    expect(whatsappAppUrl("5581997218844", "oi")).toBe(
      "whatsapp://send?phone=5581997218844&text=oi",
    );
    expect(whatsappAppUrl("+55 (81) 3634-1234", "oi")).toBe(
      "whatsapp://send?phone=558136341234&text=oi",
    );
  });
});

describe("preload: só aceita whatsapp: e https://wa.me", () => {
  it.each(["whatsapp://send?phone=5581997218844&text=oi", "https://wa.me/5581997218844?text=oi"])(
    "aceita %s",
    (url) => {
      expect(isAllowedWhatsappUrl(url)).toBe(true);
    },
  );

  it.each([
    "https://evil.example/send?phone=55",
    "http://wa.me/5581997218844",
    "https://wa.me.evil.example/55",
    "https://user:pass@wa.me/55",
    "https://wa.me:8443/55",
    "https://web.whatsapp.com/send?phone=55",
    "whatsapp://outra-coisa",
    "file:///C:/Windows/System32/calc.exe",
    "javascript:alert(1)",
    "ms-settings:",
    "not a url",
    "",
  ])("recusa %s", (url) => {
    expect(isAllowedWhatsappUrl(url)).toBe(false);
  });

  it("recusa o que não é texto", () => {
    expect(isAllowedWhatsappUrl(undefined)).toBe(false);
    expect(isAllowedWhatsappUrl({ toString: () => "https://wa.me/55" })).toBe(false);
  });
});
