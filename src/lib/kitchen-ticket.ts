import type { KitchenTicket } from "@/lib/printing";

/** Comanda de pedidos_cozinha com o horário em que foi impressa (null = ainda não). */
export type TicketRow = KitchenTicket & { printedAt: number | null };

/** Converte uma linha de public.pedidos_cozinha (mesa ou delivery) na comanda a imprimir. */
export function mapTicket(value: unknown): TicketRow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("O Supabase retornou uma comanda em formato inválido.");
  }
  const row = value as Record<string, unknown>;
  const origin = row["origem"];
  const externalOrder = origin === "entrega" || origin === "retirada";
  if (!externalOrder && row["setor"] !== "cozinha" && row["setor"] !== "bar") {
    throw new Error(`Setor inválido na comanda: ${String(row["setor"])}.`);
  }
  if (!Array.isArray(row["itens"])) throw new Error("A comanda não contém itens válidos.");
  const details =
    typeof row["dados"] === "object" && row["dados"] !== null && !Array.isArray(row["dados"])
      ? (row["dados"] as Record<string, unknown>)
      : {};
  const paymentValue = details["pagamento_previsto"];
  const payment =
    typeof paymentValue === "object" && paymentValue !== null && !Array.isArray(paymentValue)
      ? (paymentValue as Record<string, unknown>)
      : {};
  const getText = (key: string) => {
    const value = details[key];
    return typeof value === "string" ? value : "";
  };
  const getNumber = (key: string, fallback = 0) => {
    const value = Number(details[key]);
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    id: String(row["id"]),
    number: externalOrder ? getNumber("numero_dia", Number(row["numero"])) : Number(row["numero"]),
    table:
      row["mesa_numero"] === null || row["mesa_numero"] === undefined
        ? null
        : Number(row["mesa_numero"]),
    sector: row["setor"] === "bar" ? "bar" : "cozinha",
    waiter: typeof row["garcom_nome"] === "string" ? row["garcom_nome"] : "",
    additional: row["adicional"] === true,
    createdAt: new Date(String(row["criado_em"])).getTime(),
    printedAt: row["impresso_em"] ? new Date(String(row["impresso_em"])).getTime() : null,
    items: row["itens"].map((value: unknown) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("Um item da comanda está em formato inválido.");
      }
      const item = value as Record<string, unknown>;
      return {
        product: typeof item["produto"] === "string" ? item["produto"] : "",
        quantity: Number(item["quantidade"]),
        note: typeof item["observacao"] === "string" ? item["observacao"] : "",
        ...(typeof item["valor_unitario"] === "number" && Number.isFinite(item["valor_unitario"])
          ? { unitPrice: item["valor_unitario"] }
          : {}),
      };
    }),
    ...(externalOrder
      ? {
          external: {
            origin,
            dayNumber: getNumber("numero_dia", Number(row["numero"])),
            channel: getText("canal"),
            customerName:
              typeof details["cliente_nome"] === "string" ? details["cliente_nome"] : "",
            phone: getText("telefone"),
            address: getText("endereco"),
            observation: getText("observacao"),
            subtotal: getNumber("subtotal"),
            deliveryFee: getNumber("taxa_entrega"),
            total: getNumber("total"),
            payment: {
              forma: typeof payment["forma"] === "string" ? payment["forma"] : null,
              pago: payment["pago"] === true,
              trocoPara:
                payment["troco_para"] === null || payment["troco_para"] === undefined
                  ? null
                  : Number(payment["troco_para"]),
            },
          },
        }
      : {}),
  };
}
