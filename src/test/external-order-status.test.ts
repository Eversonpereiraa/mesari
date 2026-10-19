import { describe, expect, it } from "vitest";
import {
  EXTERNAL_ORDER_BOARD,
  EXTERNAL_ORDER_STATUS_LABEL,
  belongsToColumn,
  nextExternalOrderStatus,
  parseExternalOrderStatus,
} from "@/lib/external-order-status";

describe("status do pedido externo", () => {
  it("usa exatamente os valores que o banco aceita", () => {
    expect(EXTERNAL_ORDER_BOARD).toEqual(["novo", "preparo", "pronto", "saiu"]);
    expect(EXTERNAL_ORDER_STATUS_LABEL).toEqual({
      novo: "Novo",
      preparo: "Em preparo",
      pronto: "Pronto",
      saiu: "Saiu para entrega",
      entregue: "Entregue",
      cancelado: "Cancelado",
    });
  });

  it("entrega: novo → preparo → pronto → saiu, e depois só concluir", () => {
    expect(nextExternalOrderStatus("novo", "entrega")).toBe("preparo");
    expect(nextExternalOrderStatus("preparo", "entrega")).toBe("pronto");
    expect(nextExternalOrderStatus("pronto", "entrega")).toBe("saiu");
    expect(nextExternalOrderStatus("saiu", "entrega")).toBeNull();
  });

  it("retirada: novo → preparo → pronto, sem etapa 'saiu'", () => {
    expect(nextExternalOrderStatus("novo", "retirada")).toBe("preparo");
    expect(nextExternalOrderStatus("preparo", "retirada")).toBe("pronto");
    expect(nextExternalOrderStatus("pronto", "retirada")).toBeNull();
    expect(belongsToColumn("saiu", "retirada", "saiu")).toBe(false);
  });

  it("finalizados não avançam", () => {
    expect(nextExternalOrderStatus("entregue", "entrega")).toBeNull();
    expect(nextExternalOrderStatus("cancelado", "retirada")).toBeNull();
  });

  it("lê nomes antigos de 'preparo' e ignora status desconhecido", () => {
    expect(parseExternalOrderStatus("preparo")).toBe("preparo");
    expect(parseExternalOrderStatus("em_preparo")).toBe("preparo");
    expect(parseExternalOrderStatus("preparando")).toBe("preparo");
    expect(parseExternalOrderStatus("qualquer")).toBeNull();
  });
});
