import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { brl, useStore, type MenuItem } from "@/lib/store";
import { Btn } from "./ui-kit";

export function MenuPicker({ onAdd, mobile }: { onAdd: (item: MenuItem, qty: number, note: string) => void; mobile?: boolean }) {
  const cats = useStore((s) => s.categories);
  const items = useStore((s) => s.items);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<MenuItem | null>(null);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [flash, setFlash] = useState("");

  const groups = useMemo(() => {
    const t = q.trim().toLowerCase();
    return cats.map((c) => ({ c, list: items.filter((i) => i.active && i.categoryId === c.id && (!t || i.name.toLowerCase().includes(t))) }))
      .filter((g) => g.list.length);
  }, [cats, items, q]);

  const pick = (i: MenuItem) => { setSel(sel?.id === i.id ? null : i); setQty(1); setNote(""); };
  const commit = () => {
    if (!sel) return;
    onAdd(sel, qty, note.trim());
    setFlash(`${qty}× ${sel.name} adicionado`);
    setSel(null); setTimeout(() => setFlash(""), 2000);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b bg-card p-3">
        <input className="field" placeholder="Buscar item do cardápio" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">Nenhum item encontrado.</p>}
        {groups.map(({ c, list }) => (
          <section key={c.id}>
            <h3 className="sticky top-0 border-b bg-background px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{c.name}</h3>
            {list.map((i) => (
              <div key={i.id} className={cn("border-b bg-card", sel?.id === i.id && "bg-muted")}>
                <button className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" onClick={() => pick(i)}>
                  <span className="min-w-0">
                    <span className="block font-medium text-ink">{i.name}</span>
                    {i.description && <span className="block truncate text-xs text-muted-foreground">{i.description}</span>}
                  </span>
                  <span className="num shrink-0 text-sm font-medium text-ink">{brl(i.price)}</span>
                </button>
                {sel?.id === i.id && (
                  <div className="space-y-3 px-4 pb-4">
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground">Quantidade</span>
                      <div className="ml-auto flex items-center">
                        <Btn variant="outline" size={mobile ? "lg" : "md"} className="w-12 rounded-r-none" onClick={() => setQty(Math.max(1, qty - 1))}>−</Btn>
                        <span className={cn("num grid w-14 place-items-center border-y border-input bg-card font-semibold text-ink", mobile ? "h-12" : "h-10")}>{qty}</span>
                        <Btn variant="outline" size={mobile ? "lg" : "md"} className="w-12 rounded-l-none" onClick={() => setQty(qty + 1)}>+</Btn>
                      </div>
                    </div>
                    <input className="field" placeholder="Observação (ex.: sem cebola)" value={note} onChange={(e) => setNote(e.target.value)} />
                    {!mobile && <Btn className="w-full" onClick={commit}>Adicionar {qty}× — {brl(qty * i.price)}</Btn>}
                  </div>
                )}
              </div>
            ))}
          </section>
        ))}
      </div>
      {flash && <div className="border-t bg-free-bg px-4 py-2 text-sm font-medium text-free">{flash}</div>}
      {mobile && (
        <div className="border-t bg-card p-3">
          <Btn size="lg" className="w-full" disabled={!sel} onClick={commit}>
            {sel ? `Adicionar à Mesa — ${brl(qty * sel.price)}` : "Adicionar à Mesa"}
          </Btn>
        </div>
      )}
    </div>
  );
}
