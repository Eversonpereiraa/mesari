import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WHATSAPP_WINDOW_NAME,
  defaultWhatsappOpenMode,
  getWhatsappOpenMode,
  markNotified,
  noticeForStatus,
  openWhatsapp,
  paymentSentence,
  resetNotifiedForTests,
  setWhatsappOpenMode,
  wasNotified,
  whatsappAppLink,
  whatsappMessage,
  whatsappWebLink,
  type WhatsappOrder,
} from "@/lib/whatsapp-notify";

const order: WhatsappOrder = {
  id: "p1",
  number: 12,
  type: "entrega",
  status: "saiu",
  customerName: "José Cícero",
  phone: "81997218844",
  total: 72.9,
  payment: { forma: "dinheiro", pago: false, trocoPara: 100 },
};

const setDesktop = (value: unknown) => {
  (window as { mesariDesktop?: unknown }).mesariDesktop = value;
};

beforeEach(() => {
  localStorage.clear();
  resetNotifiedForTests();
});

afterEach(() => {
  setDesktop(undefined);
  vi.restoreAllMocks();
});

describe("links do WhatsApp", () => {
  it("app: whatsapp://send com 55 + DDD + número, só dígitos", () => {
    expect(whatsappAppLink("81997218844", "oi")).toBe(
      "whatsapp://send?phone=5581997218844&text=oi",
    );
    expect(whatsappAppLink("(81) 9 9721-8844", "oi")).toBe(
      "whatsapp://send?phone=5581997218844&text=oi",
    );
    expect(whatsappAppLink("+55 81 3634-1234", "oi")).toBe(
      "whatsapp://send?phone=558136341234&text=oi",
    );
  });

  it("web: web.whatsapp.com/send com o mesmo telefone", () => {
    expect(whatsappWebLink("(81) 9 9721-8844", "oi")).toBe(
      "https://web.whatsapp.com/send?phone=5581997218844&text=oi",
    );
  });

  it("telefone vazio ou sem DDD não gera link", () => {
    for (const phone of ["", "99721-8844"]) {
      expect(whatsappAppLink(phone, "oi")).toBeNull();
      expect(whatsappWebLink(phone, "oi")).toBeNull();
    }
  });

  it("codifica acentos, emoji e símbolos do texto", () => {
    const text = `${whatsappMessage("confirmado", order, "Sabor & Cia")} Total: R$ 10,00 #1?`;
    for (const link of [whatsappAppLink(order.phone, text)!, whatsappWebLink(order.phone, text)!]) {
      expect(link).toContain("Ol%C3%A1%2C%20Jos%C3%A9%20C%C3%ADcero!");
      expect(link).toContain("%F0%9F%98%8A"); // 😊
      expect(link).toContain("Sabor%20%26%20Cia"); // & não quebra o parâmetro
      expect(link).not.toMatch(/[ áéíçã😊]/u);
      const params = new URL(link).searchParams;
      expect(params.get("phone")).toBe("5581997218844");
      expect(params.get("text")).toBe(text);
    }
  });
});

describe("como abrir o WhatsApp", () => {
  it("padrão: app no desktop, WhatsApp Web no navegador", () => {
    expect(defaultWhatsappOpenMode()).toBe("web");
    expect(getWhatsappOpenMode()).toBe("web");
    setDesktop({ isDesktop: true });
    expect(getWhatsappOpenMode()).toBe("app");
  });

  it("guarda a escolha neste computador", () => {
    setDesktop({ isDesktop: true });
    setWhatsappOpenMode("web");
    expect(getWhatsappOpenMode()).toBe("web");
    localStorage.setItem("mesari-whatsapp-modo", "qualquer");
    expect(getWhatsappOpenMode()).toBe("app");
  });

  it("sem localStorage, usa o padrão e não quebra", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    expect(() => setWhatsappOpenMode("app")).not.toThrow();
    expect(getWhatsappOpenMode()).toBe("web");
  });

  it("web: reaproveita sempre a mesma aba nomeada", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await openWhatsapp(order.phone, "oi", "web");
    await openWhatsapp(order.phone, "de novo", "web");
    expect(open).toHaveBeenCalledTimes(2);
    expect(open.mock.calls[0]).toEqual([
      "https://web.whatsapp.com/send?phone=5581997218844&text=oi",
      WHATSAPP_WINDOW_NAME,
    ]);
    expect(open.mock.calls[1]![1]).toBe("mesari-whatsapp");
  });

  it("app no desktop: chama openWhatsApp do preload, sem abrir aba", async () => {
    const openWhatsApp = vi.fn(async () => ({ ok: true }));
    setDesktop({ isDesktop: true, openWhatsApp });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await expect(openWhatsapp("(81) 99721-8844", "Olá 😊", "app")).resolves.toEqual({
      fellBack: false,
    });
    expect(openWhatsApp).toHaveBeenCalledWith("81997218844", "Olá 😊");
    expect(open).not.toHaveBeenCalled();
  });

  it("app não instalado: cai para o WhatsApp Web", async () => {
    const openWhatsApp = vi.fn(async () => ({ ok: false, error: "WhatsApp não encontrado." }));
    setDesktop({ isDesktop: true, openWhatsApp });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await expect(openWhatsapp(order.phone, "oi", "app")).resolves.toEqual({ fellBack: true });
    expect(open).toHaveBeenCalledWith(
      "https://web.whatsapp.com/send?phone=5581997218844&text=oi",
      WHATSAPP_WINDOW_NAME,
    );
  });

  it("telefone inválido não abre nada", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await expect(openWhatsapp("123", "oi", "web")).rejects.toThrow(/não é válido/);
    expect(open).not.toHaveBeenCalled();
  });
});

describe("mensagens", () => {
  it("confirmado, saiu para entrega e pronto para retirada", () => {
    expect(whatsappMessage("confirmado", order, "Sabor do Agreste")).toBe(
      "Olá, José Cícero! Recebemos seu pedido #12 no Sabor do Agreste. Já está em preparo. 😊",
    );
    expect(whatsappMessage("saiu", order, "Sabor do Agreste")).toBe(
      "Olá, José Cícero! Seu pedido #12 do Sabor do Agreste saiu para entrega. Total: R$ 72,90. Pagamento: Dinheiro — levar troco para R$ 100,00.",
    );
    expect(whatsappMessage("pronto", { ...order, type: "retirada" }, "Sabor do Agreste")).toBe(
      "Olá, José Cícero! Seu pedido #12 já está pronto para retirada no Sabor do Agreste.",
    );
  });

  it("sem nome do cliente, só 'Olá!'", () => {
    expect(whatsappMessage("pronto", { ...order, customerName: "  " }, "Sabor")).toMatch(
      /^Olá! Seu pedido #12/,
    );
  });

  it("pagamento igual à comanda", () => {
    expect(paymentSentence({ forma: "pix", pago: false, trocoPara: null })).toBe("Pix");
    expect(paymentSentence({ forma: "credito", pago: false, trocoPara: null })).toBe(
      "Cartão na entrega",
    );
    expect(paymentSentence({ forma: "debito", pago: false, trocoPara: null })).toBe(
      "Cartão na entrega",
    );
    expect(paymentSentence({ forma: "dinheiro", pago: false, trocoPara: null })).toBe("Dinheiro");
    expect(paymentSentence({ forma: "pix", pago: true, trocoPara: null })).toBe("Já pago");
  });
});

describe("qual aviso em cada etapa", () => {
  it("retirada nunca recebe 'saiu para entrega'", () => {
    expect(noticeForStatus("preparo", "retirada")).toBe("confirmado");
    expect(noticeForStatus("pronto", "retirada")).toBe("pronto");
    expect(noticeForStatus("saiu", "retirada")).toBeNull();
  });

  it("entrega: confirmado em preparo e aviso de saída em 'saiu'", () => {
    expect(noticeForStatus("novo", "entrega")).toBeNull();
    expect(noticeForStatus("preparo", "entrega")).toBe("confirmado");
    expect(noticeForStatus("pronto", "entrega")).toBeNull();
    expect(noticeForStatus("saiu", "entrega")).toBe("saiu");
    expect(noticeForStatus("entregue", "entrega")).toBeNull();
  });

  it("'Cliente avisado' fica guardado por pedido e por aviso", () => {
    expect(wasNotified("p1", "saiu")).toBe(false);
    markNotified("p1", "saiu");
    expect(wasNotified("p1", "saiu")).toBe(true);
    expect(wasNotified("p1", "confirmado")).toBe(false);
    resetNotifiedForTests();
    expect(wasNotified("p1", "saiu")).toBe(true); // continua no localStorage
  });
});
