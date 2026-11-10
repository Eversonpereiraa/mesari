import { useState, type FormEvent } from "react";
import { Banknote, CreditCard, Plus, QrCode, Trash2, WalletCards, X } from "lucide-react";
import { brl, errorMessage, type PaymentInput } from "@/lib/store";
import { Btn } from "@/components/ui-kit";
import { MoneyInput } from "@/components/masked-input";

type Method = PaymentInput["forma"];
type PaymentLine = {
  id: number;
  method: Method | null;
  /** Centavos; null = campo vazio. */
  amount: number | null;
};

const methods: { value: Method; label: string; Icon: typeof Banknote }[] = [
  { value: "dinheiro", label: "Dinheiro", Icon: Banknote },
  { value: "pix", label: "Pix", Icon: QrCode },
  { value: "credito", label: "Crédito", Icon: CreditCard },
  { value: "debito", label: "Débito", Icon: WalletCards },
];


/**
 * Converte as linhas em pagamentos. Pix/cartão entram pelo valor digitado; o troco sai do
 * dinheiro (da última linha em dinheiro para a primeira), que vai com o valor recebido.
 */
function toPayments(lines: { method: Method; cents: number }[], totalCents: number) {
  const paid = lines.reduce((sum, line) => sum + line.cents, 0);
  let change = Math.max(0, paid - totalCents);
  const applied = [...lines].reverse().map((line) => {
    if (line.method !== "dinheiro" || change === 0) return { ...line, applied: line.cents };
    const used = Math.min(change, line.cents);
    change -= used;
    return { ...line, applied: line.cents - used };
  });
  return applied
    .reverse()
    .filter((line) => line.applied > 0)
    .map(
      (line): PaymentInput => ({
        forma: line.method,
        valor: line.applied / 100,
        ...(line.method === "dinheiro" ? { recebido: line.cents / 100 } : {}),
      }),
    );
}

export function PaymentDialog({
  table,
  totalCents,
  onClose,
  onConfirm,
  title,
  confirmLabel = "Confirmar e imprimir",
}: {
  table: number;
  totalCents: number;
  onClose: () => void;
  onConfirm: (payments: PaymentInput[]) => Promise<void>;
  title?: string;
  confirmLabel?: string;
}) {
  const [payments, setPayments] = useState<PaymentLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const cents = payments.map((payment) => payment.amount ?? 0);
  const paidCents = cents.reduce((sum, value) => sum + value, 0);
  const remainingCents = Math.max(0, totalCents - paidCents);
  const hasCash = payments.some((payment) => payment.method === "dinheiro");
  const changeCents = hasCash ? Math.max(0, paidCents - totalCents) : 0;
  /** Quanto essa linha pode ter sem passar do total (o que as outras ainda não pagaram). */
  const maxFor = (index: number) => Math.max(0, totalCents - (paidCents - (cents[index] ?? 0)));
  const overLimit = payments.map(
    (payment, index) =>
      payment.method !== null &&
      payment.method !== "dinheiro" &&
      (cents[index] ?? 0) > maxFor(index),
  );
  const canConfirm =
    !saving &&
    payments.length > 0 &&
    payments.every((payment, index) => payment.method !== null && (cents[index] ?? 0) > 0) &&
    !overLimit.some(Boolean) &&
    paidCents >= totalCents &&
    (paidCents === totalCents || hasCash);

  const chooseFirstMethod = (method: Method) => {
    setPayments([{ id: Date.now(), method, amount: totalCents }]);
  };

  const updatePayment = (id: number, updates: Partial<PaymentLine>) => {
    setPayments((current) =>
      current.map((payment) => (payment.id === id ? { ...payment, ...updates } : payment)),
    );
  };

  const addPayment = () => {
    setPayments((current) => [
      ...current,
      { id: Date.now(), method: null, amount: remainingCents },
    ]);
  };

  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    if (!canConfirm) return;
    setError("");
    setSaving(true);
    try {
      await onConfirm(
        toPayments(
          payments.map((payment, index) => ({
            method: payment.method ?? "dinheiro",
            cents: cents[index] ?? 0,
          })),
          totalCents,
        ),
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const status =
    paidCents < totalCents
      ? { tone: "bg-bill-bg text-ink", label: "Restante", value: remainingCents }
      : changeCents > 0
        ? { tone: "bg-free-bg text-free", label: "Troco", value: changeCents }
        : paidCents > totalCents
          ? { tone: "bg-destructive/10 text-destructive", label: "Acima do total", value: paidCents - totalCents }
          : { tone: "bg-free-bg text-free", label: "Restante", value: 0 };

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
        className="flex max-h-[94vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl"
      >
        <div className="space-y-5 overflow-y-auto p-5 md:p-7">
          <header className="flex items-start justify-between">
            <div>
              <h2 id="payment-title" className="font-display text-xl font-bold text-ink">
                {title ?? `Pagamento – Mesa ${table}`}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Selecione uma ou mais formas de pagamento.
              </p>
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
                const amountCents = cents[index] ?? 0;
                const max = maxFor(index);
                const isCash = payment.method === "dinheiro";
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
                          onClick={() => updatePayment(payment.id, { method: value })}
                          className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg border text-xs font-semibold ${payment.method === value ? "border-primary bg-accent text-primary" : "text-muted-foreground hover:bg-muted"}`}
                        >
                          <Icon className="h-5 w-5" />
                          {label}
                        </button>
                      ))}
                    </div>
                    <label className="block text-sm font-medium text-ink">
                      {isCash ? "Valor recebido em dinheiro" : "Valor do pagamento"}
                      <div
                        className={`mt-1 flex items-center rounded-lg border bg-background px-3 focus-within:ring-2 focus-within:ring-ring ${overLimit[index] ? "border-destructive" : ""}`}
                      >
                        <span className="text-muted-foreground">R$</span>
                        <MoneyInput
                          currency={false}
                          aria-label={`Valor do pagamento ${index + 1}`}
                          aria-invalid={overLimit[index]}
                          className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-right font-semibold outline-none"
                          value={payment.amount === null ? null : payment.amount / 100}
                          onValueChange={(value) =>
                            updatePayment(payment.id, {
                              amount: value === null ? null : Math.round(value * 100),
                            })
                          }
                        />
                      </div>
                    </label>
                    {overLimit[index] && (
                      <p role="alert" className="text-xs font-medium text-destructive">
                        {selectedMethod?.label} não pode passar do restante ({brl(max / 100)}).
                        Troco só em dinheiro.
                      </p>
                    )}
                    {isCash && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => updatePayment(payment.id, { amount: max })}
                          className="rounded-full border border-primary/30 bg-card px-3 py-1.5 text-xs font-semibold text-primary hover:bg-background"
                        >
                          Valor exato
                        </button>
                        {[2000, 5000, 10000, 20000].map((note) => (
                          <button
                            key={note}
                            type="button"
                            onClick={() =>
                              updatePayment(payment.id, { amount: amountCents + note })
                            }
                            className="rounded-full border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-background"
                          >
                            + {brl(note / 100)}
                          </button>
                        ))}
                      </div>
                    )}
                    {selectedMethod && (
                      <span className="sr-only">Forma selecionada: {selectedMethod.label}</span>
                    )}
                  </section>
                );
              })}
              <button
                type="button"
                onClick={addPayment}
                className="inline-flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold text-primary hover:bg-accent"
              >
                <Plus className="h-4 w-4" /> Adicionar forma de pagamento
              </button>
            </div>
          )}
          {error && (
            <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        {/* Sempre visível, fora da área que rola. */}
        <footer className="space-y-3 border-t bg-card px-5 py-4 md:px-7">
          <div
            aria-live="polite"
            className={`flex items-center justify-between rounded-lg px-4 py-3 font-bold ${status.tone}`}
          >
            <span className={status.label === "Troco" ? "text-base" : "text-sm"}>
              {status.label === "Troco" ? "TROCO" : `${status.label}:`}
            </span>
            <span className={`num ${status.label === "Troco" ? "text-2xl" : "text-lg"}`}>
              {brl(status.value / 100)}
            </span>
          </div>
          <div className="flex justify-end gap-2">
            <Btn type="button" variant="outline" disabled={saving} onClick={onClose}>
              Cancelar
            </Btn>
            <Btn type="submit" variant="success" disabled={!canConfirm}>
              {saving ? "Salvando..." : confirmLabel}
            </Btn>
          </div>
        </footer>
      </form>
    </div>
  );
}
