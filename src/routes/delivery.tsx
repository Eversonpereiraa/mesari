import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Banknote,
  Bike,
  Check,
  Clock3,
  CreditCard,
  PackageCheck,
  Plus,
  Printer,
  QrCode,
  WalletCards,
  X,
} from "lucide-react";
import { AppShell, Btn, Field } from "@/components/ui-kit";
import { AppSelect } from "@/components/app-select";
import { MenuPicker, type MenuCartEntry } from "@/components/menu-picker";
import { PaymentDialog } from "@/components/payment-dialog";
import { usePrompt } from "@/components/system-dialog-provider";
import { supabase } from "@/lib/supabase";
import { brl, errorMessage, type PaymentInput, type PaymentMethod, useStore } from "@/lib/store";
import { getPrintSettings, printKitchenTicket, type KitchenTicket } from "@/lib/printing";
import { toast } from "sonner";

export const Route = createFileRoute("/delivery")({
  head: () => ({
    meta: [
      { title: "Delivery | Mesari" },
      { name: "description", content: "Pedidos de entrega e retirada." },
    ],
  }),
  component: Delivery,
});

type Channel = "whatsapp" | "telefone" | "papel";
type OrderStatus = "novo" | "em_preparo" | "pronto" | "saiu" | "entregue" | "cancelado";
type OrderType = "entrega" | "retirada";
type ExtraItem = { id: string; name: string; price: number; quantity: number; note: string };
type DeliveryOrder = {
  id: string;
  number: number;
  channel: Channel;
  type: OrderType;
  customerName: string;
  phone: string;
  address: string;
  observation: string;
  subtotal: number;
  deliveryFee: number;
  total: number;
  status: OrderStatus;
  createdAt: number;
  courier: string;
  raw: Record<string, unknown>;
};

const channelLabel: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  telefone: "Telefone",
  papel: "Papel",
};
const statusLabel: Record<OrderStatus, string> = {
  novo: "Novo",
  em_preparo: "Em preparo",
  pronto: "Pronto",
  saiu: "Saiu",
  entregue: "Entregue",
  cancelado: "Cancelado",
};
const stageOrder: OrderStatus[] = ["novo", "em_preparo", "pronto", "saiu"];
const paymentOptions: { value: Exclude<PaymentMethod, "nao_informado">; label: string }[] = [
  { value: "dinheiro", label: "Dinheiro" },
  { value: "pix", label: "Pix" },
  { value: "credito", label: "Crédito" },
  { value: "debito", label: "Débito" },
];
const paymentIcons = {
  dinheiro: Banknote,
  pix: QrCode,
  credito: CreditCard,
  debito: WalletCards,
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numeric(value: unknown, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function mapOrder(value: unknown): DeliveryOrder {
  const row = asRecord(value);
  const type = row["tipo"];
  const channel = row["canal"];
  const status = row["status"];
  if (type !== "entrega" && type !== "retirada") {
    throw new Error("O pedido de delivery retornou um tipo inválido.");
  }
  if (channel !== "whatsapp" && channel !== "telefone" && channel !== "papel") {
    throw new Error("O pedido de delivery retornou uma origem inválida.");
  }
  if (
    status !== "novo" &&
    status !== "em_preparo" &&
    status !== "pronto" &&
    status !== "saiu" &&
    status !== "entregue" &&
    status !== "cancelado"
  ) {
    throw new Error(`Status de pedido de delivery inválido: ${String(status)}.`);
  }
  return {
    id: String(row["id"] ?? ""),
    number: numeric(row["numero_dia"]),
    channel,
    type,
    customerName: String(row["cliente_nome"] ?? ""),
    phone: String(row["telefone"] ?? ""),
    address: String(row["endereco"] ?? ""),
    observation: String(row["observacao"] ?? ""),
    subtotal: numeric(row["subtotal"]),
    deliveryFee: numeric(row["taxa_entrega"]),
    total: numeric(row["total"]),
    status,
    createdAt: new Date(String(row["criado_em"] ?? "")).getTime(),
    courier: String(row["entregador"] ?? ""),
    raw: row,
  };
}

function amountFromInput(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : null;
}

function paymentData(order: DeliveryOrder) {
  const raw = asRecord(order.raw["pagamento_previsto"]);
  const forma = raw["forma"];
  const payment =
    forma === "dinheiro" || forma === "pix" || forma === "credito" || forma === "debito"
      ? forma
      : null;
  const troco = raw["troco_para"];
  return {
    forma: payment,
    pago: raw["pago"] === true,
    trocoPara: troco === null || troco === undefined ? null : numeric(troco),
  };
}

function Delivery() {
  const pedirTexto = usePrompt();
  const snapshot = useStore((state) => state);
  const navigate = useNavigate();
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [listError, setListError] = useState("");
  const [notice, setNotice] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [showFinalized, setShowFinalized] = useState(false);
  const [paymentOrder, setPaymentOrder] = useState<DeliveryOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState<OrderType>("entrega");
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [observation, setObservation] = useState("");
  const [paymentForm, setPaymentForm] = useState<Exclude<PaymentMethod, "nao_informado"> | "">("");
  const [isPaid, setIsPaid] = useState(false);
  const [changeFor, setChangeFor] = useState("");
  const [menuCart, setMenuCart] = useState<MenuCartEntry[]>([]);
  const [extras, setExtras] = useState<ExtraItem[]>([]);
  const [extraOpen, setExtraOpen] = useState(false);
  const [extraName, setExtraName] = useState("");
  const [extraPrice, setExtraPrice] = useState("");
  const [extraQuantity, setExtraQuantity] = useState("1");
  const [formError, setFormError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  const loadOrders = useCallback(async () => {
    const { data, error } = await supabase
      .from("pedidos_externos")
      .select("*")
      .order("criado_em", { ascending: false })
      .limit(300);
    if (error) throw error;
    const next = (data ?? []).map(mapOrder);
    setOrders(next);
    setListError("");
    setLoadingOrders(false);
    return next;
  }, []);

  useEffect(() => {
    if (!snapshot.loading && !snapshot.user) void navigate({ to: "/", replace: true });
    if (snapshot.user && snapshot.user.role !== "caixa")
      void navigate({ to: "/garcom", replace: true });
  }, [navigate, snapshot.loading, snapshot.user]);

  useEffect(() => {
    if (snapshot.user?.role !== "caixa") return;
    let active = true;
    void loadOrders().catch((cause: unknown) => {
      if (!active) return;
      setListError(errorMessage(cause));
      setLoadingOrders(false);
    });
    const realtime = supabase
      .channel("pedidos-externos-delivery")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pedidos_externos" },
        (payload) => {
          try {
            if (payload.eventType === "DELETE") {
              const removed = asRecord(payload.old)["id"];
              setOrders((current) => current.filter((order) => order.id !== String(removed)));
              return;
            }
            const order = mapOrder(payload.new);
            setOrders((current) => [order, ...current.filter((entry) => entry.id !== order.id)]);
          } catch (cause) {
            setListError(errorMessage(cause));
          }
        },
      )
      .subscribe((status, cause) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setListError(cause ? errorMessage(cause) : "Falha na atualização em tempo real.");
        }
      });
    return () => {
      active = false;
      void supabase.removeChannel(realtime);
    };
  }, [loadOrders, snapshot.user?.id, snapshot.user?.role]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === "Enter" && formOpen) {
        event.preventDefault();
        formRef.current?.requestSubmit();
      } else if (
        !formOpen &&
        event.key.toLowerCase() === "n" &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement)
      ) {
        setFormOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [formOpen]);

  const menuSubtotal = menuCart.reduce((sum, entry) => sum + entry.item.price * entry.qty, 0);
  const extraSubtotal = extras.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const subtotal = Math.round((menuSubtotal + extraSubtotal) * 100) / 100;
  const deliveryFee = type === "entrega" ? Number(snapshot.restaurant.deliveryFee || 0) : 0;
  const totalAmount = Math.round((subtotal + deliveryFee) * 100) / 100;

  const resetForm = () => {
    setType("entrega");
    setChannel("whatsapp");
    setCustomerName("");
    setPhone("");
    setAddress("");
    setObservation("");
    setPaymentForm("");
    setIsPaid(false);
    setChangeFor("");
    setMenuCart([]);
    setExtras([]);
    setExtraOpen(false);
    setFormError("");
  };

  const saveOrder = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    if (!customerName.trim()) {
      setFormError("Informe o nome do cliente.");
      return;
    }
    if (type === "entrega" && !address.trim()) {
      setFormError("Informe o endereço para a entrega.");
      return;
    }
    if (menuCart.length + extras.length === 0) {
      setFormError("Adicione pelo menos um item ao pedido.");
      return;
    }
    const troco = changeFor.trim() ? amountFromInput(changeFor) : null;
    if (changeFor.trim() && (troco === null || paymentForm !== "dinheiro")) {
      setFormError("Informe um valor de troco válido para pagamento em dinheiro.");
      return;
    }
    setBusy(true);
    try {
      const p_dados = {
        canal: channel,
        tipo: type,
        cliente_nome: customerName.trim(),
        telefone: phone.replace(/\D/g, "") || null,
        endereco: type === "entrega" ? address.trim() : "",
        observacao: observation.trim(),
        pagamento_previsto: {
          forma: paymentForm || null,
          pago: isPaid,
          troco_para: paymentForm === "dinheiro" ? troco : null,
        },
        itens: [
          ...menuCart.map(({ item, qty, note }) => ({
            produto_id: item.id,
            quantidade: qty,
            observacao: note.trim(),
          })),
          ...extras.map((item) => ({
            nome: item.name,
            valor_unitario: item.price,
            quantidade: item.quantity,
            observacao: item.note.trim(),
          })),
        ],
      };
      const { data, error } = await supabase.rpc("criar_pedido_externo", {
        p_dados,
        p_imprimir: true,
      });
      if (error) throw error;
      const result = Array.isArray(data) ? asRecord(data[0]) : asRecord(data);
      const createdId = String(result["id"] ?? result["pedido_id"] ?? "");
      const expectedNumber = numeric(
        result["numero_dia"],
        orders.find((order) => order.id === createdId)?.number ?? 0,
      );
      setNotice(
        expectedNumber > 0
          ? `Pedido #${expectedNumber} enviado para impressão`
          : "Pedido enviado para impressão",
      );
      setFormOpen(false);
      resetForm();
      void loadOrders()
        .then((refreshed) => {
          if (expectedNumber > 0) return;
          const createdOrder = refreshed.find((order) => order.id === createdId);
          if (createdOrder) {
            setNotice(`Pedido #${createdOrder.number} enviado para impressão`);
          }
        })
        .catch((cause: unknown) => setListError(errorMessage(cause)));
    } catch (cause) {
      setFormError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const runOrderAction = async (
    order: DeliveryOrder,
    status: OrderStatus,
    courier: string | null = "",
    reason: string | null = null,
  ) => {
    setBusy(true);
    setListError("");
    try {
      const { error } = await supabase.rpc("atualizar_status_pedido_externo", {
        p_id: order.id,
        p_status: status,
        p_entregador: courier,
        p_motivo: reason,
      });
      if (error) throw error;
      if (status === "cancelado") toast.success(`Pedido #${order.number} cancelado.`);
      await loadOrders().catch((cause: unknown) => setListError(errorMessage(cause)));
    } catch (cause) {
      setListError(errorMessage(cause));
      if (status === "cancelado") {
        toast.error(`Não foi possível cancelar o pedido: ${errorMessage(cause)}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const advanceOrder = async (order: DeliveryOrder) => {
    const index = stageOrder.indexOf(order.status);
    const next = stageOrder[index + 1];
    if (!next) return;
    let courier: string | null = "";
    if (next === "saiu") {
      const answer = await pedirTexto({
        title: `Pedido #${order.number} saiu para entrega`,
        description: "Informe o nome do entregador, se desejar.",
        label: "Nome do entregador",
        placeholder: "Opcional",
        maxLength: 80,
        confirmText: "Confirmar saída",
      });
      if (answer === null) return;
      courier = answer.trim();
    }
    void runOrderAction(order, next, courier);
  };

  const cancelOrder = async (order: DeliveryOrder) => {
    const reason = await pedirTexto({
      title: `Cancelar pedido #${order.number}?`,
      description: (
        <span>
          {order.customerName} · Total {brl(order.total)}
        </span>
      ),
      label: "Motivo do cancelamento",
      placeholder: "Descreva o motivo",
      required: true,
      maxLength: 300,
      multiline: true,
      quickOptions: [
        "Cliente desistiu",
        "Endereço não atendido",
        "Sem estoque",
        "Pedido duplicado",
        "Outro",
      ],
      cancelText: "Voltar",
      confirmText: "Cancelar pedido",
      variant: "danger",
    });
    if (reason === null) return;
    await runOrderAction(order, "cancelado", null, reason);
  };

  const completeOrder = async (payments: PaymentInput[]) => {
    if (!paymentOrder) return;
    const { error } = await supabase.rpc("concluir_pedido_externo", {
      p_id: paymentOrder.id,
      p_pagamentos: payments.map((payment) => ({
        forma: payment.forma,
        valor: Math.round(payment.valor * 100) / 100,
        ...(payment.forma === "dinheiro" && payment.recebido !== undefined
          ? { recebido: Math.round(payment.recebido * 100) / 100 }
          : {}),
      })),
    });
    if (error) throw error;
    setPaymentOrder(null);
    await loadOrders();
    setNotice(`Pedido #${paymentOrder.number} concluído e recebido.`);
  };

  const addExtra = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const price = amountFromInput(extraPrice);
    const quantity = Number(extraQuantity);
    if (!extraName.trim() || price === null || !Number.isInteger(quantity) || quantity < 1) {
      setFormError("Informe nome, valor válido e quantidade do item avulso.");
      return;
    }
    setExtras((current) => [
      ...current,
      { id: crypto.randomUUID(), name: extraName.trim(), price, quantity, note: "" },
    ]);
    setExtraName("");
    setExtraPrice("");
    setExtraQuantity("1");
    setExtraOpen(false);
  };

  const reprintOrder = async (order: DeliveryOrder) => {
    setBusy(true);
    setListError("");
    try {
      const rawItems = order.raw["itens"];
      if (!Array.isArray(rawItems) || rawItems.length === 0) {
        throw new Error("Este pedido não contém itens salvos para reimpressão.");
      }
      const externalData = {
        ...asRecord(order.raw["dados"]),
        ...order.raw,
      };
      const payment = paymentData(order);
      const ticket: KitchenTicket = {
        id: order.id,
        number: order.number,
        table: null,
        sector: "cozinha",
        waiter: "",
        additional: false,
        createdAt: order.createdAt,
        items: rawItems.map((itemValue) => {
          const item = asRecord(itemValue);
          return {
            product: String(item["produto"] ?? item["nome"] ?? item["produto_nome"] ?? ""),
            quantity: numeric(item["quantidade"], 1),
            note: String(item["observacao"] ?? ""),
            unitPrice: numeric(item["valor_unitario"]),
          };
        }),
        external: {
          origin: order.type,
          dayNumber: order.number,
          channel: order.channel,
          customerName: order.customerName,
          phone: order.phone,
          address: order.address,
          observation: order.observation,
          subtotal: numeric(externalData["subtotal"], order.subtotal),
          deliveryFee: numeric(externalData["taxa_entrega"], order.deliveryFee),
          total: numeric(externalData["total"], order.total),
          payment: {
            forma: payment.forma,
            pago: payment.pago,
            trocoPara: payment.trocoPara,
          },
        },
      };
      await printKitchenTicket(ticket, getPrintSettings(), false);
      setNotice(`Pedido #${order.number} enviado para reimpressão.`);
    } catch (cause) {
      setListError(`Não foi possível reimprimir o pedido #${order.number}: ${errorMessage(cause)}`);
    } finally {
      setBusy(false);
    }
  };

  const addAvulsoQuantity = (id: string, change: number) =>
    setExtras((current) =>
      current
        .map((item) => (item.id === id ? { ...item, quantity: item.quantity + change } : item))
        .filter((item) => item.quantity > 0),
    );

  const finalizedToday = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return orders.filter(
      (order) =>
        (order.status === "entregue" || order.status === "cancelado") &&
        order.createdAt >= start.getTime() &&
        order.createdAt < end.getTime(),
    );
  }, [orders]);
  const activeOrders = orders.filter(
    (order) => order.status !== "entregue" && order.status !== "cancelado",
  );

  if (snapshot.user?.role !== "caixa") return null;

  return (
    <AppShell center="Delivery">
      {!formOpen ? (
        <div className="mx-auto max-w-[1440px] space-y-5 p-4 md:p-6">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-extrabold text-ink">Pedidos Delivery</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Pedidos recebidos por WhatsApp, telefone ou papel.
              </p>
            </div>
            <div className="flex gap-2">
              <Btn
                variant={showFinalized ? "neutral" : "outline"}
                onClick={() => setShowFinalized(!showFinalized)}
              >
                {showFinalized ? "Voltar aos pedidos ativos" : "Finalizados de hoje"}
              </Btn>
              <Btn
                onClick={() => {
                  setNotice("");
                  setFormOpen(true);
                }}
              >
                <Plus className="h-4 w-4" /> Novo pedido{" "}
                <span className="text-xs opacity-80">(N)</span>
              </Btn>
            </div>
          </header>
          {notice && (
            <div
              role="status"
              className="flex items-center gap-2 rounded-lg bg-free-bg px-4 py-3 text-sm font-semibold text-free"
            >
              <Check className="h-4 w-4" /> {notice}
              <button
                type="button"
                className="ml-auto"
                aria-label="Fechar mensagem"
                onClick={() => setNotice("")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {listError && (
            <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {listError}
            </p>
          )}
          {loadingOrders ? (
            <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
              Carregando pedidos...
            </div>
          ) : showFinalized ? (
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {finalizedToday.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  busy={busy}
                  onAdvance={advanceOrder}
                  onComplete={setPaymentOrder}
                  onReprint={() => void reprintOrder(order)}
                  onCancel={() => cancelOrder(order)}
                />
              ))}
              {finalizedToday.length === 0 && (
                <p className="col-span-full rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
                  Nenhum pedido finalizado hoje.
                </p>
              )}
            </section>
          ) : (
            <div className="overflow-x-auto pb-2">
              <div className="grid min-w-[1050px] grid-cols-4 gap-3">
                {stageOrder.map((stage) => {
                  const stageOrders = activeOrders.filter(
                    (order) =>
                      order.status === stage && (stage !== "saiu" || order.type === "entrega"),
                  );
                  return (
                    <section key={stage} className="min-h-[60vh] rounded-xl bg-muted/50 p-3">
                      <header className="mb-3 flex items-center justify-between">
                        <h2 className="font-display font-bold text-ink">{statusLabel[stage]}</h2>
                        <span className="rounded-full bg-card px-2 py-0.5 text-xs font-bold text-muted-foreground">
                          {stageOrders.length}
                        </span>
                      </header>
                      <div className="space-y-3">
                        {stageOrders.map((order) => (
                          <OrderCard
                            key={order.id}
                            order={order}
                            busy={busy}
                            onAdvance={advanceOrder}
                            onComplete={setPaymentOrder}
                            onReprint={() => void reprintOrder(order)}
                            onCancel={() => cancelOrder(order)}
                          />
                        ))}
                        {stageOrders.length === 0 && (
                          <p className="rounded-lg border border-dashed bg-card/70 p-4 text-center text-xs text-muted-foreground">
                            Nenhum pedido
                          </p>
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        <form
          ref={formRef}
          onSubmit={(event) => void saveOrder(event)}
          className="mx-auto flex h-[calc(100dvh-4rem)] min-h-[680px] max-w-[1440px] flex-col"
        >
          <div className="flex shrink-0 items-center justify-between border-b bg-background px-4 py-3 md:px-6">
            <h1 className="font-display text-xl font-extrabold text-ink">Novo pedido</h1>
            <Btn
              type="button"
              variant="outline"
              onClick={() => {
                setFormOpen(false);
                setFormError("");
              }}
            >
              <X className="h-4 w-4" /> Fechar
            </Btn>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-6 md:p-6">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="space-y-5">
                <section className="rounded-xl border bg-card p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    {(["entrega", "retirada"] as const).map((choice) => (
                      <button
                        key={choice}
                        type="button"
                        aria-pressed={type === choice}
                        onClick={() => setType(choice)}
                        className={`min-h-14 flex-1 rounded-xl border-2 px-4 text-base font-extrabold ${type === choice ? "border-primary bg-primary text-white" : "border-border text-ink hover:bg-muted"}`}
                      >
                        {choice === "entrega" ? "ENTREGA" : "RETIRADA"}
                      </button>
                    ))}
                    <Field label="Origem">
                      <AppSelect
                        className="h-11 min-w-32"
                        value={channel}
                        onValueChange={(value) => setChannel(value as Channel)}
                        options={[
                          { value: "whatsapp", label: "WhatsApp" },
                          { value: "telefone", label: "Telefone" },
                          { value: "papel", label: "Papel" },
                        ]}
                      />
                    </Field>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <Field label="Nome do cliente *">
                      <input
                        className="field"
                        autoComplete="name"
                        value={customerName}
                        onChange={(event) => setCustomerName(event.target.value)}
                        required
                      />
                    </Field>
                    <Field label="Telefone">
                      <input
                        className="field"
                        type="tel"
                        autoComplete="tel"
                        value={phone}
                        onChange={(event) => setPhone(event.target.value)}
                      />
                    </Field>
                    {type === "entrega" && (
                      <Field label="Endereço *">
                        <input
                          className="field"
                          autoComplete="street-address"
                          value={address}
                          onChange={(event) => setAddress(event.target.value)}
                          required
                        />
                      </Field>
                    )}
                    <Field label="Observação geral">
                      <input
                        className="field"
                        placeholder="Referência, instruções..."
                        value={observation}
                        onChange={(event) => setObservation(event.target.value)}
                      />
                    </Field>
                  </div>
                </section>
                <section className="rounded-xl border bg-card p-4">
                  <header className="mb-3 flex items-center justify-between">
                    <h2 className="font-display text-lg font-bold text-ink">Itens do pedido</h2>
                    <Btn
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setExtraOpen(true)}
                    >
                      <Plus className="h-4 w-4" /> Item avulso
                    </Btn>
                  </header>
                  <div className="h-[440px] min-h-[360px] overflow-hidden rounded-lg border">
                    <MenuPicker
                      onAdd={async () => {}}
                      onSubmit={async () => {}}
                      externalCart={menuCart}
                      onCartChange={setMenuCart}
                      hideCartControls
                    />
                  </div>
                  {extras.length > 0 && (
                    <div className="mt-3 divide-y rounded-lg border">
                      {extras.map((item) => (
                        <div key={item.id} className="flex items-center gap-3 p-3">
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-ink">{item.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {brl(item.price)} cada
                            </div>
                          </div>
                          <input
                            className="field h-10 w-24"
                            aria-label={`Observação de ${item.name}`}
                            placeholder="Observação"
                            value={item.note}
                            onChange={(event) =>
                              setExtras((current) =>
                                current.map((line) =>
                                  line.id === item.id
                                    ? { ...line, note: event.target.value }
                                    : line,
                                ),
                              )
                            }
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              aria-label={`Diminuir ${item.name}`}
                              className="grid h-9 w-9 place-items-center rounded-full border"
                              onClick={() => addAvulsoQuantity(item.id, -1)}
                            >
                              -
                            </button>
                            <span className="num min-w-5 text-center font-bold">
                              {item.quantity}
                            </span>
                            <button
                              type="button"
                              aria-label={`Aumentar ${item.name}`}
                              className="grid h-9 w-9 place-items-center rounded-full border"
                              onClick={() => addAvulsoQuantity(item.id, 1)}
                            >
                              +
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
              <aside className="space-y-4 rounded-xl border bg-card p-4">
                <h2 className="font-display text-lg font-bold text-ink">Pagamento previsto</h2>
                <Field label="Forma de pagamento">
                  <AppSelect
                    className="field"
                    value={paymentForm}
                    onValueChange={(value) => setPaymentForm(value as typeof paymentForm)}
                    options={[
                      { value: "", label: "Não informado" },
                      ...paymentOptions.map((option) => ({
                        ...option,
                        Icon: paymentIcons[option.value],
                      })),
                    ]}
                  />
                </Field>
                {paymentForm === "dinheiro" && (
                  <Field label="Troco para quanto?">
                    <input
                      className="field"
                      inputMode="decimal"
                      placeholder="Ex.: 100,00"
                      value={changeFor}
                      onChange={(event) => setChangeFor(event.target.value)}
                    />
                  </Field>
                )}
                <label className="flex items-center gap-3 rounded-lg bg-muted/60 p-3 text-sm font-semibold text-ink">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={isPaid}
                    onChange={(event) => setIsPaid(event.target.checked)}
                  />
                  Já está pago
                </label>
                <div className="rounded-lg bg-accent p-3 text-sm text-muted-foreground">
                  O pagamento é apenas uma previsão da comanda. A venda é registrada ao concluir e
                  receber o pedido.
                </div>
              </aside>
            </div>
            {formError && (
              <p
                role="alert"
                className="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
              >
                {formError}
              </p>
            )}
          </div>
          <footer className="sticky bottom-0 z-20 grid shrink-0 grid-cols-[1fr_auto] items-center gap-4 border-t bg-background/95 px-4 py-3 shadow-[0_-6px_20px_rgba(0,0,0,.08)] backdrop-blur md:px-6">
            <div className="grid grid-cols-2 gap-x-5 gap-y-1 text-sm sm:grid-cols-3">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Subtotal</span>
                <strong className="num text-ink">{brl(subtotal)}</strong>
              </div>
              {type === "entrega" && (
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Taxa de entrega</span>
                  <strong className="num text-ink">{brl(deliveryFee)}</strong>
                </div>
              )}
              <div className="col-span-2 flex justify-between gap-3 sm:col-span-1">
                <span className="font-bold text-ink">TOTAL</span>
                <strong className="num font-display text-xl font-extrabold text-primary">
                  {brl(totalAmount)}
                </strong>
              </div>
            </div>
            <Btn
              type="submit"
              size="lg"
              variant="success"
              disabled={busy || menuCart.length + extras.length === 0}
            >
              {busy ? "Salvando..." : "Salvar e imprimir"}{" "}
              <span className="text-xs opacity-80">Ctrl+Enter</span>
            </Btn>
          </footer>
          {extraOpen && (
            <div
              className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"
              onClick={() => setExtraOpen(false)}
            >
              <form
                onSubmit={addExtra}
                onClick={(event) => event.stopPropagation()}
                className="w-full max-w-md space-y-4 rounded-xl border bg-card p-5 shadow-2xl"
              >
                <h2 className="font-display text-xl font-bold text-ink">Adicionar item avulso</h2>
                <Field label="Nome do item">
                  <input
                    className="field"
                    autoFocus
                    value={extraName}
                    onChange={(event) => setExtraName(event.target.value)}
                    required
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Valor unitário (R$)">
                    <input
                      className="field"
                      inputMode="decimal"
                      placeholder="0,00"
                      value={extraPrice}
                      onChange={(event) => setExtraPrice(event.target.value)}
                      required
                    />
                  </Field>
                  <Field label="Quantidade">
                    <input
                      className="field"
                      type="number"
                      min="1"
                      step="1"
                      value={extraQuantity}
                      onChange={(event) => setExtraQuantity(event.target.value)}
                      required
                    />
                  </Field>
                </div>
                <div className="flex justify-end gap-2">
                  <Btn type="button" variant="outline" onClick={() => setExtraOpen(false)}>
                    Cancelar
                  </Btn>
                  <Btn type="submit">Adicionar</Btn>
                </div>
              </form>
            </div>
          )}
        </form>
      )}
      {paymentOrder && (
        <PaymentDialog
          table={paymentOrder.number}
          title={`Concluir pedido #${paymentOrder.number}`}
          totalCents={Math.round(paymentOrder.total * 100)}
          onClose={() => setPaymentOrder(null)}
          onConfirm={completeOrder}
        />
      )}
    </AppShell>
  );
}

function OrderCard({
  order,
  busy,
  onAdvance,
  onComplete,
  onReprint,
  onCancel,
}: {
  order: DeliveryOrder;
  busy: boolean;
  onAdvance: (order: DeliveryOrder) => void;
  onComplete: (order: DeliveryOrder) => void;
  onReprint: () => void;
  onCancel: () => void;
}) {
  const index = stageOrder.indexOf(order.status);
  const nextStatus = stageOrder[index + 1];
  const isFinalized = order.status === "entregue" || order.status === "cancelado";
  return (
    <article className="rounded-xl border bg-card p-4 shadow-sm">
      <header className="flex items-start justify-between gap-2">
        <div>
          <div className="font-display text-lg font-extrabold text-ink">#{order.number}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            <Clock3 className="mr-1 inline h-3.5 w-3.5" />
            {Number.isFinite(order.createdAt)
              ? new Date(order.createdAt).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—"}
            {" · "}
            {channelLabel[order.channel]}
          </div>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${order.type === "entrega" ? "bg-blue-100 text-blue-800" : "bg-purple-100 text-purple-800"}`}
        >
          {order.type === "entrega" ? "ENTREGA" : "RETIRADA"}
        </span>
      </header>
      <div className="mt-3 border-t pt-3">
        <div className="font-semibold text-ink">{order.customerName}</div>
        {order.phone && <div className="mt-0.5 text-xs text-muted-foreground">{order.phone}</div>}
        {order.type === "entrega" && order.address && (
          <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{order.address}</div>
        )}
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground">
            {statusLabel[order.status]}
          </span>
          <strong className="font-display text-lg font-extrabold text-ink">
            {brl(order.total)}
          </strong>
        </div>
        {order.courier && (
          <div className="mt-1 text-xs text-muted-foreground">Entregador: {order.courier}</div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
        {nextStatus && (
          <Btn size="sm" disabled={busy} onClick={() => onAdvance(order)}>
            {nextStatus === "saiu" ? (
              <Bike className="h-4 w-4" />
            ) : (
              <PackageCheck className="h-4 w-4" />
            )}
            {nextStatus === "saiu" ? "Saiu" : `Avançar: ${statusLabel[nextStatus]}`}
          </Btn>
        )}
        {!isFinalized && (
          <Btn size="sm" variant="success" disabled={busy} onClick={() => onComplete(order)}>
            <Check className="h-4 w-4" /> Concluir e receber
          </Btn>
        )}
        <Btn size="sm" variant="outline" disabled={busy} onClick={onReprint}>
          <Printer className="h-4 w-4" /> Reimprimir
        </Btn>
        {!isFinalized && (
          <Btn size="sm" variant="danger" disabled={busy} onClick={onCancel}>
            Cancelar
          </Btn>
        )}
      </div>
    </article>
  );
}
