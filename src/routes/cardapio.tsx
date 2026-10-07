import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { actions, brl, useStore, type MenuItem } from "@/lib/store";
import { AppShell, Btn, Field } from "@/components/ui-kit";

export const Route = createFileRoute("/cardapio")({
  head: () => ({
    meta: [
      { title: "Cardápio | Mesari" },
      { name: "description", content: "Gerencie categorias, itens e preços do cardápio." },
      { property: "og:title", content: "Cardápio | Mesari" },
      { property: "og:description", content: "Gerencie categorias, itens e preços do cardápio." },
    ],
  }),
  component: Cardapio,
});

type Draft = Omit<MenuItem, "id" | "price"> & { id?: string; price: string };

function Cardapio() {
  const cats = useStore((s) => s.categories);
  const items = useStore((s) => s.items);
  const [cat, setCat] = useState(cats[0]?.id ?? "");
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);

  const t = q.trim().toLowerCase();
  const list = items.filter((i) => (t ? i.name.toLowerCase().includes(t) : i.categoryId === cat));

  const newCat = () => {
    const n = prompt("Nome da nova categoria");
    if (n?.trim()) setCat(actions.addCategory(n.trim()));
  };
  const save = () => {
    if (!draft || !draft.name.trim()) return;
    const price = parseFloat(draft.price.replace(",", ".")) || 0;
    actions.saveItem({ ...draft, name: draft.name.trim(), price });
    setDraft(null);
  };

  return (
    <AppShell
      center="Cardápio"
      right={
        <>
          <input className="field h-8 w-52 text-sm" placeholder="Buscar item" value={q} onChange={(e) => setQ(e.target.value)} />
          <Btn variant="outline" size="sm" onClick={newCat}>Nova Categoria</Btn>
          <Btn size="sm" onClick={() => setDraft({ name: "", categoryId: cat, price: "", description: "", active: true })}>Novo Item</Btn>
        </>
      }
    >
      <div className="grid grid-cols-[220px_1fr] gap-5 p-5">
        <nav className="h-fit rounded-lg border bg-card py-1">
          {cats.map((c) => (
            <button key={c.id} onClick={() => { setCat(c.id); setQ(""); }}
              className={cn("flex w-full items-center justify-between px-4 py-2 text-left text-sm",
                cat === c.id && !t ? "bg-muted font-semibold text-ink" : "text-muted-foreground hover:text-ink")}>
              {c.name}
              <span className="num text-xs">{items.filter((i) => i.categoryId === c.id).length}</span>
            </button>
          ))}
        </nav>
        <div className="rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-4 py-2.5 text-left font-medium">Nome</th>
                <th className="px-4 py-2.5 text-right font-medium">Preço</th>
                <th className="px-4 py-2.5 text-left font-medium">Status</th>
                <th className="px-4 py-2.5 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {list.map((i) => (
                <tr key={i.id} className="border-b last:border-0">
                  <td className="px-4 py-2.5 text-ink">
                    {i.name}
                    {i.description && <div className="text-xs text-muted-foreground">{i.description}</div>}
                  </td>
                  <td className="num px-4 py-2.5 text-right text-ink">{brl(i.price)}</td>
                  <td className="px-4 py-2.5">
                    <span className={cn("rounded-sm px-2 py-0.5 text-xs font-semibold", i.active ? "bg-free-bg text-free" : "bg-muted text-muted-foreground")}>
                      {i.active ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button className="mr-3 text-primary hover:underline" onClick={() => setDraft({ ...i, price: i.price.toFixed(2).replace(".", ",") })}>Editar</button>
                    <button className="text-destructive hover:underline" onClick={() => confirm(`Excluir "${i.name}"?`) && actions.deleteItem(i.id)}>Excluir</button>
                  </td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">Nenhum item.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {draft && (
        <div className="fixed inset-0 z-20 grid place-items-center bg-ink/40 p-4" onClick={() => setDraft(null)}>
          <div className="w-full max-w-md rounded-lg border bg-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="border-b px-5 py-3 font-semibold text-ink">{draft.id ? "Editar item" : "Novo item"}</h2>
            <div className="space-y-4 p-5">
              <Field label="Nome do item"><input className="field" autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Categoria">
                  <select className="field" value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>
                    {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
                <Field label="Preço (R$)"><input className="field num" inputMode="decimal" placeholder="0,00" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} /></Field>
              </div>
              <Field label="Descrição (opcional)">
                <textarea className="field h-20 py-2" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </Field>
              <Field label="Status">
                <select className="field" value={draft.active ? "1" : "0"} onChange={(e) => setDraft({ ...draft, active: e.target.value === "1" })}>
                  <option value="1">Ativo</option><option value="0">Inativo</option>
                </select>
              </Field>
            </div>
            <div className="flex justify-end gap-2 border-t px-5 py-3">
              <Btn variant="outline" onClick={() => setDraft(null)}>Cancelar</Btn>
              <Btn variant="success" onClick={save}>Salvar</Btn>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
