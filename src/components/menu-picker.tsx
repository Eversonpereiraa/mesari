import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
  Utensils,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { brl, errorMessage, useStore, type MenuItem } from "@/lib/store";
import { getKitchenStationStatus, startKitchenPresenceObserver } from "@/lib/kitchen-presence";
import { Btn } from "./ui-kit";
import { TextInput } from "@/components/inputs";
import { TEXT_LIMITS } from "@/lib/masks";

/** Limite de quantidade por item aceito pelo banco. */
const MAX_QTY = 99;

function sendErrorMessage(cause: unknown) {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  const message = errorMessage(cause);
  if (offline || /failed to fetch|network|fetch failed/i.test(message)) {
    return "Sem internet: o pedido NÃO foi enviado. Os itens continuam no carrinho.";
  }
  return `O pedido NÃO foi enviado: ${message}. Os itens continuam no carrinho.`;
}

function SendErrorNotice({
  message,
  retrying,
  onRetry,
}: {
  message: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="mt-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3"
    >
      <p className="text-center text-sm font-semibold text-destructive">{message}</p>
      <Btn
        type="button"
        size="lg"
        variant="outline"
        className="mt-2 w-full"
        disabled={retrying}
        onClick={onRetry}
      >
        {retrying ? "Enviando..." : "Tentar de novo"}
      </Btn>
    </div>
  );
}

export type MenuCartEntry = { item: MenuItem; qty: number; note: string };

export function MenuPicker({
  onAdd,
  onSubmit,
  mobile,
  showPrintOption,
  externalCart,
  onCartChange,
  hideCartControls = false,
}: {
  onAdd: (item: MenuItem, qty: number, note: string, print?: boolean) => Promise<void>;
  onSubmit?: (entries: MenuCartEntry[], print?: boolean) => Promise<void>;
  mobile?: boolean;
  showPrintOption?: boolean;
  externalCart?: MenuCartEntry[];
  onCartChange?: (entries: MenuCartEntry[]) => void;
  hideCartControls?: boolean;
}) {
  const cats = useStore((s) => s.categories);
  const items = useStore((s) => s.items);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<MenuItem | null>(null);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [flash, setFlash] = useState("");
  const [localCart, setLocalCart] = useState<MenuCartEntry[]>([]);
  const cart = externalCart ?? localCart;
  const setCart = (update: MenuCartEntry[] | ((current: MenuCartEntry[]) => MenuCartEntry[])) => {
    const next = typeof update === "function" ? update(cart) : update;
    if (onCartChange) onCartChange(next);
    else setLocalCart(next);
  };
  const [cartOpen, setCartOpen] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [sending, setSending] = useState(false);
  const [printOrders, setPrintOrders] = useState(true);
  const [activeCategory, setActiveCategory] = useState(cats[0]?.id ?? "");
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  useEffect(() => startKitchenPresenceObserver(), []);

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    return cats
      .map((category) => ({
        category,
        items: items.filter(
          (item) =>
            item.active &&
            item.categoryId === category.id &&
            (!term || item.name.toLowerCase().includes(term)),
        ),
      }))
      .filter((group) => group.items.length);
  }, [cats, items, q]);

  const cartCount = cart.reduce((sum, entry) => sum + entry.qty, 0);
  const cartTotal = cart.reduce((sum, entry) => sum + entry.qty * entry.item.price, 0);

  const pick = (item: MenuItem) => {
    if (selected?.id === item.id) {
      setSelected(null);
      return;
    }
    const existing = cart.find((entry) => entry.item.id === item.id);
    setSelected(item);
    setQty(existing?.qty ?? 1);
    setNote(existing?.note ?? "");
  };

  const adjustCart = (item: MenuItem, delta: number) => {
    setCart((current) => {
      const existing = current.find((entry) => entry.item.id === item.id);
      const nextQty = Math.min(MAX_QTY, (existing?.qty ?? 0) + delta);
      if (nextQty <= 0) return current.filter((entry) => entry.item.id !== item.id);
      const nextNote = existing?.note ?? (selected?.id === item.id ? note.trim() : "");
      if (existing)
        return current.map((entry) =>
          entry.item.id === item.id ? { ...entry, qty: nextQty } : entry,
        );
      return [...current, { item, qty: nextQty, note: nextNote }];
    });
    setSubmitError("");
  };

  const updateNote = (value: string) => {
    setNote(value);
    if (selected) {
      setCart((current) =>
        current.map((entry) => (entry.item.id === selected.id ? { ...entry, note: value } : entry)),
      );
    }
  };

  const addSelected = async () => {
    if (!selected) return;
    if (onSubmit || onCartChange) {
      setCart((current) => {
        const existing = current.some((entry) => entry.item.id === selected.id);
        return existing
          ? current.map((entry) =>
              entry.item.id === selected.id ? { ...entry, qty, note: note.trim() } : entry,
            )
          : [...current, { item: selected, qty, note: note.trim() }];
      });
      setSelected(null);
      return;
    }
    setSending(true);
    setSubmitError("");
    // "desconhecido" (canal ainda sincronizando) não é offline: sem aviso falso.
    const stationOffline = getKitchenStationStatus() === "offline";
    try {
      await onAdd(selected, qty, note.trim(), true);
      setFlash(
        printOrders
          ? stationOffline
            ? "Impressora desconectada. O pedido foi enviado, avise o caixa."
            : "Pedido enviado para a cozinha"
          : "Pedido enviado para a mesa.",
      );
      setSelected(null);
    } catch (cause) {
      setSubmitError(sendErrorMessage(cause));
    } finally {
      setSending(false);
    }
    window.setTimeout(() => setFlash(""), 4000);
  };

  const sendCart = async () => {
    if (!cart.length || sending) return;
    setSending(true);
    setSubmitError("");
    // "desconhecido" (canal ainda sincronizando) não é offline: sem aviso falso.
    const stationOffline = getKitchenStationStatus() === "offline";
    try {
      if (onSubmit) await onSubmit(cart, printOrders);
      else for (const entry of cart) await onAdd(entry.item, entry.qty, entry.note, true);
      setCart([]);
      setCartOpen(false);
      setSelected(null);
      setFlash(
        !printOrders
          ? "Pedido enviado para a mesa."
          : stationOffline
            ? "Impressora desconectada. O pedido foi enviado, avise o caixa."
            : "Pedido enviado para a cozinha",
      );
      window.setTimeout(() => setFlash(""), 4000);
    } catch (cause) {
      setSubmitError(sendErrorMessage(cause));
    } finally {
      setSending(false);
    }
  };

  const jumpToCategory = (id: string) => {
    setActiveCategory(id);
    sectionRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b bg-background p-3">
        <label className="relative block">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <input
            className="field h-11 pl-10"
            type="search"
            enterKeyHint="search"
            maxLength={60}
            aria-label="Buscar item do cardápio"
            placeholder="Buscar item do cardápio"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
        </label>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {cats.map((category) => (
            <button
              type="button"
              key={category.id}
              onClick={() => jumpToCategory(category.id)}
              className={cn(
                "min-h-9 shrink-0 rounded-full border px-3 text-xs font-semibold",
                activeCategory === category.id
                  ? "border-primary bg-primary text-white"
                  : "border-border bg-card text-muted-foreground hover:text-ink",
              )}
            >
              {category.name}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.length === 0 && (
          <div className="grid min-h-48 place-items-center p-6 text-center text-sm text-muted-foreground">
            <p>
              <Utensils className="mx-auto mb-2 h-7 w-7" />
              Nenhum item encontrado.
            </p>
          </div>
        )}
        {groups.map(({ category, items: categoryItems }) => (
          <section
            key={category.id}
            ref={(node) => {
              if (node) sectionRefs.current.set(category.id, node);
              else sectionRefs.current.delete(category.id);
            }}
            className="scroll-mt-2"
          >
            <h3 className="sticky top-0 z-[1] border-b bg-background/95 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.08em] text-primary backdrop-blur">
              {category.name}
            </h3>
            {categoryItems.map((item) => {
              const entry = cart.find((line) => line.item.id === item.id);
              return (
                <div
                  key={item.id}
                  className={cn(
                    "border-b bg-card transition-colors",
                    selected?.id === item.id && "border-l-4 border-l-primary bg-accent",
                  )}
                >
                  <div className="flex min-h-14 items-center gap-2 px-3">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center justify-between gap-3 py-3 text-left"
                      onClick={() => pick(item)}
                    >
                      <span className="min-w-0">
                        <span className="block font-semibold text-ink">{item.name}</span>
                        {item.description && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {item.description}
                          </span>
                        )}
                      </span>
                      <span className="num shrink-0 text-sm font-bold text-ink">
                        {brl(item.price)}
                      </span>
                    </button>
                    {(mobile || onSubmit || onCartChange) && (
                      <div className="flex shrink-0 items-center gap-1">
                        {entry && (
                          <button
                            type="button"
                            aria-label={`Diminuir ${item.name}`}
                            onClick={() => adjustCart(item, -1)}
                            className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-muted"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                        )}
                        {entry && (
                          <span className="num min-w-7 text-center text-xs font-bold text-primary">
                            {entry.qty}×
                          </span>
                        )}
                        <button
                          type="button"
                          aria-label={`Adicionar ${item.name}`}
                          onClick={() => adjustCart(item, 1)}
                          className="grid h-10 w-10 place-items-center rounded-full bg-accent text-primary hover:bg-primary hover:text-white"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                  {selected?.id === item.id && (
                    <div className="space-y-3 px-4 pb-4">
                      {!mobile && !onSubmit && !onCartChange && (
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-medium text-ink">Quantidade</span>
                          <div className="ml-auto flex items-center">
                            <Btn
                              variant="outline"
                              size="lg"
                              className="h-12 w-12 rounded-r-none"
                              aria-label="Diminuir quantidade"
                              type="button"
                              onClick={() => setQty(Math.max(1, qty - 1))}
                            >
                              <Minus className="h-4 w-4" />
                            </Btn>
                            <span className="num grid h-12 w-14 place-items-center border-y border-input bg-card font-bold text-ink">
                              {qty}
                            </span>
                            <Btn
                              variant="outline"
                              size="lg"
                              className="h-12 w-12 rounded-l-none"
                              aria-label="Aumentar quantidade"
                              type="button"
                              onClick={() => setQty(Math.min(MAX_QTY, qty + 1))}
                            >
                              <Plus className="h-4 w-4" />
                            </Btn>
                          </div>
                        </div>
                      )}
                      <TextInput
                        className="h-11"
                        aria-label={`Observação para ${item.name}`}
                        placeholder="Observação (ex.: sem cebola)"
                        enterKeyHint="done"
                        maxLength={TEXT_LIMITS.note}
                        counterFrom={100}
                        value={note}
                        onChange={updateNote}
                      />
                      {!mobile && (
                        <Btn
                          type="button"
                          size="lg"
                          className="w-full"
                          disabled={sending}
                          onClick={addSelected}
                        >
                          <Check className="h-4 w-4" />
                          {onSubmit || onCartChange
                            ? "Adicionar ao pedido"
                            : `Adicionar ${qty}× — ${brl(qty * item.price)}`}
                        </Btn>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>

      {flash && (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 border-t bg-free-bg px-4 py-3 text-sm font-semibold text-free"
        >
          <Check className="h-4 w-4" />
          {flash}
        </div>
      )}
      {!hideCartControls && (mobile || onSubmit) && (
        <div className="shrink-0 border-t bg-card p-3">
          {showPrintOption && (
            <label className="mb-2 flex min-h-10 cursor-pointer items-center gap-2 px-2 text-sm font-medium text-ink">
              <input
                type="checkbox"
                checked={printOrders}
                onChange={(event) => setPrintOrders(event.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Enviar para a cozinha
            </label>
          )}
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="mb-2 flex min-h-11 w-full items-center gap-2 rounded-xl px-2 text-left text-sm font-semibold text-ink hover:bg-muted"
          >
            <ShoppingBag className="h-5 w-5 text-primary" />
            <span>
              {cartCount} {cartCount === 1 ? "item" : "itens"} · {brl(cartTotal)}
            </span>
            <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground" />
          </button>
          <Btn
            type="button"
            size="lg"
            variant={cartCount ? "success" : "neutral"}
            className="w-full"
            disabled={!cartCount || sending}
            onClick={() => void sendCart()}
          >
            {sending ? "Enviando..." : "Enviar pedido"}
          </Btn>
          {submitError && (
            <SendErrorNotice
              message={submitError}
              retrying={sending}
              onRetry={() => void sendCart()}
            />
          )}
        </div>
      )}

      {!hideCartControls && (mobile || onSubmit) && cartOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/45"
          onClick={() => setCartOpen(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="cart-title"
            onClick={(event) => event.stopPropagation()}
            className="max-h-[82dvh] w-full max-w-2xl overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl"
          >
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <h2 id="cart-title" className="font-display text-lg font-bold text-ink">
                  Seu pedido
                </h2>
                <p className="text-xs text-muted-foreground">
                  {cartCount} {cartCount === 1 ? "item" : "itens"} · {brl(cartTotal)}
                </p>
              </div>
              <button
                aria-label="Fechar pedido"
                onClick={() => setCartOpen(false)}
                className="grid h-11 w-11 place-items-center rounded-full hover:bg-muted"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[58dvh] overflow-y-auto divide-y">
              {cart.map((entry) => (
                <div key={entry.item.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-ink">{entry.item.name}</div>
                      <div className="num mt-1 text-sm font-bold text-ink">
                        {brl(entry.qty * entry.item.price)}
                      </div>
                    </div>
                    <button
                      aria-label={`Remover ${entry.item.name}`}
                      onClick={() => adjustCart(entry.item, -entry.qty)}
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      aria-label={`Diminuir ${entry.item.name}`}
                      onClick={() => adjustCart(entry.item, -1)}
                      className="grid h-11 w-11 place-items-center rounded-xl border bg-card"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="num min-w-10 text-center font-bold text-ink">
                      {entry.qty}×
                    </span>
                    <button
                      aria-label={`Aumentar ${entry.item.name}`}
                      onClick={() => adjustCart(entry.item, 1)}
                      className="grid h-11 w-11 place-items-center rounded-xl border bg-card"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                    <span className="ml-auto block w-full max-w-[190px]">
                      <TextInput
                        className="h-11"
                        aria-label={`Observação para ${entry.item.name}`}
                        placeholder="Observação"
                        enterKeyHint="done"
                        maxLength={TEXT_LIMITS.note}
                        counterFrom={100}
                        value={entry.note}
                        onChange={(note) =>
                          setCart((current) =>
                            current.map((line) =>
                              line.item.id === entry.item.id ? { ...line, note } : line,
                            ),
                          )
                        }
                      />
                    </span>
                  </div>
                </div>
              ))}
              {cart.length === 0 && (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Seu pedido está vazio.
                </div>
              )}
            </div>
            <div className="border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <Btn
                type="button"
                size="lg"
                variant="success"
                className="w-full"
                disabled={!cartCount || sending}
                onClick={() => void sendCart()}
              >
                {sending
                  ? "Enviando..."
                  : `Enviar ${cartCount} ${cartCount === 1 ? "item" : "itens"} — ${brl(cartTotal)}`}
              </Btn>
              {submitError && (
                <SendErrorNotice
                  message={submitError}
                  retrying={sending}
                  onRetry={() => void sendCart()}
                />
              )}
              <Btn
                type="button"
                size="lg"
                variant="outline"
                className="mt-2 w-full"
                disabled={sending}
                onClick={() => setCartOpen(false)}
              >
                Voltar ao cardápio
              </Btn>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
