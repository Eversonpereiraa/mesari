import { useSyncExternalStore } from "react";

export type Shape = "retangular" | "redonda";
export type Table = { id: string; number: number; seats: number; shape: Shape; x: number; y: number };
export type Category = { id: string; name: string };
export type MenuItem = { id: string; name: string; categoryId: string; price: number; description: string; active: boolean };
export type OrderLine = { id: string; itemId: string; name: string; qty: number; price: number; note: string; at: number; waiter: string };
export type Status = "livre" | "ocupada" | "conta";

export type State = {
  user: { name: string; role: "caixa" | "garcom" } | null;
  restaurant: { name: string; phone: string; address: string; logo: string };
  tables: Table[];
  categories: Category[];
  items: MenuItem[];
  orders: Record<string, OrderLine[]>;
  billRequested: Record<string, boolean>;
  print: {
    connected: boolean; printer: string;
    kitchen: boolean; bill: boolean;
    kTable: boolean; kTime: boolean; kNotes: boolean; kWaiter: boolean;
    bName: boolean; bDate: boolean; bItems: boolean; bTotal: boolean; footer: string;
  };
};

const uid = () => Math.random().toString(36).slice(2, 10);

function seed(): State {
  const tables: Table[] = Array.from({ length: 16 }, (_, i) => ({
    id: `t${i + 1}`, number: i + 1, seats: i % 4 === 0 ? 6 : i % 3 === 0 ? 2 : 4,
    shape: i % 5 === 0 ? "redonda" : "retangular",
    x: 30 + (i % 4) * 150, y: 30 + Math.floor(i / 4) * 130,
  }));
  const categories: Category[] = [
    { id: "c1", name: "Entradas" }, { id: "c2", name: "Pratos" },
    { id: "c3", name: "Bebidas" }, { id: "c4", name: "Sobremesas" },
  ];
  const mk = (name: string, categoryId: string, price: number, description = ""): MenuItem =>
    ({ id: uid(), name, categoryId, price, description, active: true });
  const items = [
    mk("Bolinho de bacalhau (6 un.)", "c1", 38), mk("Pão de alho", "c1", 18), mk("Porção de fritas", "c1", 29),
    mk("Filé à parmegiana", "c2", 72, "Acompanha arroz e fritas"), mk("Picanha na chapa", "c2", 89),
    mk("Risoto de cogumelos", "c2", 64), mk("Feijoada (individual)", "c2", 54), mk("Salmão grelhado", "c2", 79),
    mk("Refrigerante lata", "c3", 7), mk("Suco natural", "c3", 12), mk("Água mineral", "c3", 5),
    mk("Cerveja long neck", "c3", 14), mk("Caipirinha", "c3", 22),
    mk("Pudim", "c4", 16), mk("Petit gâteau", "c4", 28), mk("Mousse de maracujá", "c4", 14),
  ];
  const line = (it: MenuItem, qty: number): OrderLine =>
    ({ id: uid(), itemId: it.id, name: it.name, qty, price: it.price, note: "", at: Date.now(), waiter: "Carlos" });
  return {
    user: null,
    restaurant: { name: "Mesari", phone: "(11) 3333-4444", address: "Rua das Flores, 120 — São Paulo/SP", logo: "" },
    tables, categories, items,
    orders: {
      t2: [line(items[3], 2), line(items[8], 2)],
      t5: [line(items[4], 1), line(items[11], 3), line(items[1], 1)],
      t7: [line(items[6], 4), line(items[9], 4), line(items[13], 2)],
      t11: [line(items[5], 1), line(items[10], 1)],
    },
    billRequested: { t7: true },
    print: {
      connected: false, printer: "",
      kitchen: true, bill: true,
      kTable: true, kTime: true, kNotes: true, kWaiter: true,
      bName: true, bDate: true, bItems: true, bTotal: true, footer: "Obrigado pela preferência!",
    },
  };
}

const KEY = "mesari-v1";
const initial = seed();
let state: State = initial;
let loaded = false;
const subs = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = { ...initial, ...JSON.parse(raw) };
  } catch { /* ignore */ }
}

export function setState(fn: (s: State) => State) {
  load();
  state = fn(state);
  localStorage.setItem(KEY, JSON.stringify(state));
  subs.forEach((f) => f());
}

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => subs.delete(cb); },
    () => { load(); return sel(state); },
    () => sel(initial),
  );
}

export const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function tableStatus(s: State, id: string): Status {
  if (s.billRequested[id]) return "conta";
  return (s.orders[id]?.length ?? 0) > 0 ? "ocupada" : "livre";
}
export const total = (lines: OrderLine[] = []) => lines.reduce((a, l) => a + l.qty * l.price, 0);
export const count = (lines: OrderLine[] = []) => lines.reduce((a, l) => a + l.qty, 0);

export const actions = {
  login(name: string, code: string): boolean {
    const n = name.trim().toLowerCase();
    if (n === "admin" && code === "1234") { setState((s) => ({ ...s, user: { name: "Admin", role: "caixa" } })); return true; }
    if (n === "garcom" && code === "1111") { setState((s) => ({ ...s, user: { name: "Garçom", role: "garcom" } })); return true; }
    return false;
  },
  logout() { setState((s) => ({ ...s, user: null })); },
  addLine(tableId: string, item: MenuItem, qty: number, note: string, waiter: string) {
    setState((s) => ({
      ...s,
      orders: { ...s.orders, [tableId]: [...(s.orders[tableId] ?? []),
        { id: uid(), itemId: item.id, name: item.name, qty, price: item.price, note, at: Date.now(), waiter }] },
    }));
  },
  removeLine(tableId: string, lineId: string) {
    setState((s) => ({ ...s, orders: { ...s.orders, [tableId]: (s.orders[tableId] ?? []).filter((l) => l.id !== lineId) } }));
  },
  requestBill(tableId: string) { setState((s) => ({ ...s, billRequested: { ...s.billRequested, [tableId]: true } })); },
  closeBill(tableId: string) {
    setState((s) => {
      const orders = { ...s.orders }; delete orders[tableId];
      const br = { ...s.billRequested }; delete br[tableId];
      return { ...s, orders, billRequested: br };
    });
  },
  saveTables(tables: Table[]) { setState((s) => ({ ...s, tables })); },
  saveItem(item: Omit<MenuItem, "id"> & { id?: string }) {
    setState((s) => item.id
      ? { ...s, items: s.items.map((i) => (i.id === item.id ? (item as MenuItem) : i)) }
      : { ...s, items: [...s.items, { ...item, id: uid() }] });
  },
  deleteItem(id: string) { setState((s) => ({ ...s, items: s.items.filter((i) => i.id !== id) })); },
  addCategory(name: string) { const id = uid(); setState((s) => ({ ...s, categories: [...s.categories, { id, name }] })); return id; },
  updatePrint(p: Partial<State["print"]>) { setState((s) => ({ ...s, print: { ...s.print, ...p } })); },
  updateRestaurant(r: State["restaurant"]) { setState((s) => ({ ...s, restaurant: r })); },
  newId: uid,
};
