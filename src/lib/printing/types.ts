export type PrintReceipt = {
  id: string;
  at: number;
  table: number;
  saleNumber: number;
  lines: {
    id: string;
    name: string;
    qty: number;
    price: number;
    note: string;
    waiter: string;
  }[];
  subtotal: number;
  serviceCharge: number;
  total: number;
  payments?: {
    forma: "dinheiro" | "pix" | "credito" | "debito" | "nao_informado";
    valor: number;
    recebido?: number;
    troco?: number;
  }[];
  partial?: boolean;
  /** Percentual da taxa de serviço (para "Taxa de serviço (10%)"). */
  serviceChargePercent?: number;
  /** Nota de consumo (pré-conta): sem número de venda nem pagamentos. */
  preBill?: boolean;
  reprint?: boolean;
  origin?: "mesa" | "entrega" | "retirada" | "balcao";
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  deliveryFee?: number;
  discount?: number;
};

export type PrintRestaurant = {
  name: string;
  address: string;
  phone: string;
  cnpj: string;
  instagram: string;
  logo?: string;
  /** PNG preto e branco já processado para a impressora (Storage). */
  printLogo?: string;
  /** Imprimir a logo na conta e na comanda de delivery. */
  printLogoEnabled?: boolean;
  /** Rodapé da conta; cada quebra de linha vira uma linha centralizada. */
  receiptFooter?: string;
  serviceChargePercent?: number;
};

/** Pedido a imprimir como comanda (mesa ou delivery). */
export type KitchenTicket = {
  id: string;
  number: number;
  table: number | null;
  sector: "cozinha" | "bar";
  waiter: string;
  additional: boolean;
  createdAt: number;
  items: { product: string; quantity: number; note: string; unitPrice?: number }[];
  external?: {
    origin: "entrega" | "retirada";
    dayNumber: number;
    channel: "whatsapp" | "telefone" | "papel" | "balcao" | string;
    customerName: string;
    phone: string;
    address: string;
    /** Endereço já separado em linhas (senão é separado a partir de `address`). */
    addressLines?: string[];
    reference?: string;
    observation: string;
    subtotal: number;
    deliveryFee: number;
    discount?: number;
    total: number;
    payment: { forma: string | null; pago: boolean; trocoPara: number | null };
  };
};
