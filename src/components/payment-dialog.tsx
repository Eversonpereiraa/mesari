import { useState, type FormEvent } from "react";
import { Banknote, CreditCard, Plus, QrCode, Trash2, WalletCards, X } from "lucide-react";
import { brl, errorMessage, type PaymentInput } from "@/lib/store";
import { Btn } from "@/components/ui-kit";

type Method = PaymentInput["forma"];
type PaymentLine = {
  id: number;
  method: Method | null;
  amount: string;
  received: string;
};

const methods: { value: Method; label: string; Icon: typeof Banknote }[] = [
  { value: "dinheiro", label: "Dinheiro", Icon: Banknote },
  { value: "pix", label: "Pix", Icon: QrCode },
  { value: "credito", label: "Crédito", Icon: CreditCard },
  { value: "debito", label: "Débito", Icon: WalletCards },
];

const moneyToCents = (value: string) => {
  const normalized = value.trim().replace(/[^\d.,]/g, "");
  let whole = normalized;
  let fraction = "00";
  if (normalized.includes(",")) {
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{0,2})?$/.test(normalized)) return 0;
    const [integer = "", decimal = ""] = normalized.split(",");
    whole = integer.replace(/\./g, "");
    fraction = decimal.padEnd(2, "0");
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(normalized)) {
    whole = normalized.replace(/\./g, "");
  } else if (/^\d*(?:\.\d{0,2})?$/.test(normalized) && normalized.includes(".")) {
    const [integer = "", decimal = ""] = normalized.split(".");
    whole = integer;
    fraction = decimal.padEnd(2, "0");
  } else if (!/^\d+$/.test(normalized)) {
    return 0;
  }
  return (Number(whole) || 0) * 100 + (Number(fraction) || 0);
};
const inputValue = (cents: number) =>
  `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;

export function PaymentDialog({
  table,
  totalCents,
  onClose,
  onConfirm,
  title,
}: {
  table: number;
  totalCents: number;
  onClose: () => void;
  onConfirm: (payments: PaymentInput[]) => Promise<void>;
  title?: string;
}) {
  const [payments, setPayments] = useState<PaymentLine[]>([]);
  const [split, setSplit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const paidCents = payments.reduce((sum, payment) => sum + moneyToCents(payment.amount), 0);
  const cashUnderpaid = payments.some(
    (payment) =>
      payment.method === "dinheiro" &&
      moneyToCents(payment.received) < moneyToCents(payment.amount),
  );
  const canConfirm =
    !saving &&
    payments.length > 0 &&
    payments.every((payment) => payment.method !== null && moneyToCents(payment.amount) > 0) &&
    paidCents === totalCents &&
    !cashUnderpaid;

  const chooseFirstMethod = (method: Method) => {
    setPayments([
      {
        id: Date.now(),
        method,
        amount: inputValue(totalCents),
        received: method === "dinheiro" ? inputValue(totalCents) : "",
      },
    ]);
  };

  const updatePayment = (id: number, updates: Partial<PaymentLine>) => {
    setPayments((current) =>
      current.map((payment) => (payment.id === id ? { ...payment, ...updates } : payment)),
    );
  };

  const addPayment = () => {
    const remaining = Math.max(0, totalCents - paidCents);
    setPayments((current) => [
      ...current,
      { id: Date.now(), method: null, amount: inputValue(remaining), received: "" },
    ]);
    setSplit(true);
  };

  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    if (!canConfirm) return;
    setError("");
    setSaving(true);
    try {
      await onConfirm(
        payments.map((payment) => ({
          forma: payment.method!,
          valor: moneyToCents(payment.amount) / 100,
          ...(payment.method === "dinheiro" && payment.received
            ? { recebido: moneyToCents(payment.received) / 100 }
            : {}),
        })),
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-3"
      onClick={() => !saving && onClose()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-title"
        onSubmit={confirm}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[94vh] w-full max-w-xl space-y-5 overflow-y-auto rounded-2xl border bg-card p-5 shadow-2xl md:p-7"
      >
        <header className="flex items-start justify-between">
          <div>
            <h2 id="payment-title" className="font-display text-xl font-bold text-ink">
              {title ?? `Pagamento – Mesa ${table}`}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">Selecione uma ou mais formas.</p>
          </div>
          <button
            type="button"
            aria-label="Fechar pagamento"
            disabled={saving}
            onClick={onClose}
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="rounded-xl bg-accent px-4 py-5 text-center">
          <div className="text-sm font-medium text-muted-foreground">TOTAL A PAGAR</div>
          <div className="num mt-1 font-display text-4xl font-extrabold text-primary">
            {brl(totalCents / 100)}
          </div>
        </div>

        {payments.length === 0 ? (
          <div className="grid grid-cols-2 gap-3">
            {methods.map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => chooseFirstMethod(value)}
                className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border-2 border-border bg-background text-sm font-bold text-ink transition-colors hover:border-primary hover:bg-accent"
              >
                <Icon className="h-7 w-7 text-primary" />
                {label}
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {payments.map((payment, index) => {
              const amountCents = moneyToCents(payment.amount);
              const receivedCents = moneyToCents(payment.received);
              const selectedMethod = methods.find((method) => method.value === payment.method);
              return (
                <section key={payment.id} className="space-y-3 rounded-xl border p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-ink">Pagamento {index + 1}</span>
                    {payments.length > 1 && (
                      <button
                        type="button"
                        aria-label={`Remover pagamento ${index + 1}`}
                        onClick={() =>
                          setPayments((current) => current.filter((x) => x.id !== payment.id))
                        }
                        className="rounded-md p-1.5 text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {methods.map(({ value, label, Icon }) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={payment.method === value}
                        onClick={() =>
                          updatePayment(payment.id, {
                            method: value,
                            received:
                              value === "dinheiro" ? payment.received || payment.amount : "",
                          })
                        }
                        className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg border text-xs font-semibold ${payment.method === value ? "border-primary bg-accent text-primary" : "text-muted-foreground hover:bg-muted"}`}
                      >
                        <Icon className="h-5 w-5" />
                        {label}
                      </button>
                    ))}
                  </div>
                  <label className="block text-sm font-medium text-ink">
                    Valor do pagamento
                    <div className="mt-1 flex items-center rounded-lg border bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
                      <span className="text-muted-foreground">R$</span>
                      <input
                        aria-label={`Valor do pagamento ${index + 1}`}
                        inputMode="decimal"
                        className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-right font-semibold outline-none"
                        value={payment.amount}
                        onChange={(event) =>
                          updatePayment(payment.id, { amount: event.target.value })
                        }
                      />
                    </div>
                  </label>
                  {payment.method === "dinheiro" && (
                    <div className="space-y-3 rounded-lg bg-muted/60 p-3">
                      <label className="block text-sm font-medium text-ink">
                        Valor recebido
                        <div className="mt-1 flex items-center rounded-lg border bg-background px-3">
                          <span className="text-muted-foreground">R$</span>
                          <input
                            aria-label={`Valor recebido do pagamento ${index + 1}`}
                            inputMode="decimal"
                            className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-right font-semibold outline-none"
                            value={payment.received}
                            onChange={(event) =>
                              updatePayment(payment.id, { received: event.target.value })
                            }
                          />
                        </div>
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {[2000, 5000, 10000, 20000].map((note) => (
                          <button
                            key={note}
                            type="button"
                            onClick={() =>
                              updatePayment(payment.id, {
                                received: inputValue(receivedCents + note),
                              })
                            }
                            className="rounded-full border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-background"
                          >
                            + {brl(note / 100)}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() =>
                            updatePayment(payment.id, { received: inputValue(amountCents) })
                          }
                          className="rounded-full border border-primary/30 bg-card px-3 py-1.5 text-xs font-semibold text-primary hover:bg-background"
                        >
                          Valor exato
                        </button>
                      </div>
                      <div
                        className={`flex items-center justify-between rounded-lg px-3 py-2 font-bold ${receivedCents >= amountCents ? "bg-free-bg text-free" : "bg-destructive/10 text-destructive"}`}
                      >
                        <span>{receivedCents >= amountCents ? "TROCO" : "Valor insuficiente"}</span>
                        <span className="num text-lg">
                          {brl(Math.max(0, receivedCents - amountCents) / 100)}
                        </span>
                      </div>
                    </div>
                  )}
                  {selectedMethod && (
                    <span className="sr-only">Forma selecionada: {selectedMethod.label}</span>
                  )}
                </section>
              );
            })}
            {split && (
              <button
                type="button"
                onClick={addPayment}
                className="inline-flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold text-primary hover:bg-accent"
              >
                <Plus className="h-4 w-4" /> Adicionar forma de pagamento
              </button>
            )}
          </div>
        )}

        {payments.length > 0 && (
          <div
            aria-live="polite"
            className={`rounded-lg px-4 py-3 text-center text-sm font-bold ${paidCents === totalCents ? "bg-free-bg text-free" : "bg-bill-bg text-bill"}`}
          >
            {paidCents === totalCents
              ? "Pago"
              : paidCents < totalCents
                ? `Falta ${brl((totalCents - paidCents) / 100)}`
                : `Excedente ${brl((paidCents - totalCents) / 100)}`}
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          {payments.length > 0 && !split ? (
            <button
              type="button"
              onClick={() => {
                setSplit(true);
                addPayment();
              }}
              className="text-sm font-semibold text-primary underline-offset-4 hover:underline"
            >
              Dividir pagamento
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Btn type="button" variant="outline" disabled={saving} onClick={onClose}>
              Cancelar
            </Btn>
            <Btn type="submit" variant="success" disabled={!canConfirm}>
              {saving ? "Salvando..." : "Confirmar e imprimir"}
            </Btn>
          </div>
        </footer>
      </form>
    </div>
  );
}
