import { beforeEach, describe, expect, it } from "vitest";
import {
  markNotified,
  noticeForStatus,
  paymentSentence,
  resetNotifiedForTests,
  wasNotified,
  whatsappLink,
  whatsappMessage,
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

beforeEach(() => {
  localStorage.clear();
  resetNotifiedForTests();
});

describe("link do WhatsApp", () => {
  it("usa 55 + DDD + número, só dígitos", () => {
    expect(whatsappLink("81997218844", "oi")).toBe("https://wa.me/5581997218844?text=oi");
    expect(whatsappLink("(81) 9 9721-8844", "oi")).toBe("https://wa.me/5581997218844?text=oi");
    expect(whatsappLink("+55 81 3634-1234", "oi")).toBe("https://wa.me/558136341234?text=oi");
  });

  it("telefone vazio ou sem DDD não gera link", () => {
    expect(whatsappLink("", "oi")).toBeNull();
    expect(whatsappLink("99721-8844", "oi")).toBeNull();
  });

  it("codifica acentos e emoji corretamente", () => {
    const text = whatsappMessage("confirmado", order, "Restaurante Sabor do Agreste");
    const link = whatsappLink(order.phone, text)!;
    expect(link).toContain("Ol%C3%A1%2C%20Jos%C3%A9%20C%C3%ADcero!");
    expect(link).toContain("%F0%9F%98%8A"); // 😊
    expect(link).not.toMatch(/[ áéíçã😊]/u);
    expect(decodeURIComponent(link.split("?text=")[1]!)).toBe(text);
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
