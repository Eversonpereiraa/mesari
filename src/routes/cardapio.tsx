import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BookOpen, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { actions, brl, errorMessage, useStore, type MenuItem } from "@/lib/store";
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
  const role = useStore((s) => s.user?.role);
  const navigate = useNavigate();
  const [cat, setCat] = useState(cats[0]?.id ?? "");
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [categoryError, setCategoryError] = useState("");
  useEffect(() => {
    if (role && role !== "caixa") void navigate({ to: "/garcom", replace: true });
  }, [navigate, role]);

  const t = q.trim().toLowerCase();
  const list = items.filter((i) => (t ? i.name.toLowerCase().includes(t) : i.categoryId === cat));

  const newCat = async () => {
    const n = prompt("Nome da nova categoria");
    if (n?.trim()) setCat(await actions.addCategory(n.trim()));
  };
  const save = async () => {
    if (!draft || !draft.name.trim()) return;
    const price = parseFloat(draft.price.replace(",", ".")) || 0;
    await actions.saveItem({ ...draft, name: draft.name.trim(), price });
    setDraft(null);
  };

  return (
    <AppShell
      center="Cardápio"
      right={
        <>
          <Btn variant="outline" size="sm" className="whitespace-nowrap" onClick={newCat}>
            <Plus className="h-4 w-4" />
            Nova Categoria
          </Btn>
          <Btn
            size="sm"
            className="whitespace-nowrap"
            onClick={() =>
              setDraft({ name: "", categoryId: cat, price: "", description: "", active: true })
            }
          >
            <Plus className="h-4 w-4" />
            Novo Item
          </Btn>
        </>
      }
    >
      <div className="px-4 pt-4 md:px-6">
        <label className="relative block">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <input
            className="field h-11 max-w-sm pl-10"
            aria-label="Buscar item"
            placeholder="Buscar item"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </div>
      <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-[220px_minmax(0,1fr)] md:gap-5 md:p-6">
        <nav className="h-fit rounded-[14px] border bg-card p-2 shadow-sm">
          <h2 className="px-3 pb-2 pt-1 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
            Categorias
          </h2>
          {cats.map((c) => (
            <div key={c.id} className="space-y-1">
              <button
                onClick={() => {
                  setCat(c.id);
                  setQ("");
                }}
                className={cn(
                  "flex min-h-11 w-full items-center justify-between rounded-lg px-3 text-left text-sm transition-colors",
                  cat === c.id && !t
                    ? "bg-accent font-bold text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-ink",
                )}
              >
                {c.name}
                <span className="num rounded-full bg-background px-2 py-0.5 text-xs">
                  {items.filter((i) => i.categoryId === c.id).length}
                </span>
              </button>
              {role === "caixa" && (
                <label className="flex items-center justify-between gap-2 px-3 pb-2 text-xs text-muted-foreground">
                  Setor
                  <select
                    aria-label={`Setor de ${c.name}`}
                    className="max-w-32 rounded-md border bg-background px-2 py-1.5 text-xs text-ink"
                    value={c.sector}
                    onChange={async (event) => {
                      const sector = event.target.value as typeof c.sector;
                      setCategoryError("");
                      try {
                        await actions.setCategorySector(c.id, sector);
                      } catch (cause) {
                        setCategoryError(errorMessage(cause));
                      }
                    }}
                  >
                    <option value="cozinha">Cozinha</option>
                    <option value="bar">Bar</option>
                    <option value="nenhum">Não imprimir</option>
                  </select>
                </label>
              )}
            </div>
          ))}
          {categoryError && (
            <p role="alert" className="px-3 py-2 text-xs text-destructive">
              {categoryError}
            </p>
          )}
        </nav>
        <div className="overflow-hidden rounded-[14px] border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
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
                  <tr key={i.id} className="border-b last:border-0 hover:bg-background/70">
                    <td className="px-4 py-2.5 text-ink">
                      {i.name}
                      {i.description && (
                        <div className="text-xs text-muted-foreground">{i.description}</div>
                      )}
                    </td>
                    <td className="num px-4 py-2.5 text-right text-ink">{brl(i.price)}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={cn(
                          "rounded-sm px-2 py-0.5 text-xs font-semibold",
                          i.active ? "bg-free-bg text-free" : "bg-muted text-muted-foreground",
                        )}
                      >
                        {i.active ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        aria-label={`Editar ${i.name}`}
                        className="mr-2 inline-flex h-9 w-9 items-center justify-center rounded-lg text-primary hover:bg-accent"
                        onClick={() =>
                          setDraft({ ...i, price: i.price.toFixed(2).replace(".", ",") })
                        }
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        aria-label={`Excluir ${i.name}`}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-destructive hover:bg-destructive/10"
                        onClick={() => confirm(`Excluir "${i.name}"?`) && actions.deleteItem(i.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {list.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-10 text-center text-muted-foreground">
                      <BookOpen className="mx-auto mb-2 h-7 w-7" />
                      Nenhum item nesta categoria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {draft && (
        <div
          className="fixed inset-0 z-20 grid place-items-center bg-ink/40 p-4"
          onClick={() => setDraft(null)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-[14px] border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="border-b bg-background px-5 py-4 font-display font-bold text-ink">
              {draft.id ? "Editar item" : "Novo item"}
            </h2>
            <div className="space-y-4 p-5">
              <Field label="Nome do item">
                <input
                  className="field"
                  autoFocus
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Categoria">
                  <select
                    className="field"
                    value={draft.categoryId}
                    onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
                  >
                    {cats.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Preço (R$)">
                  <input
                    className="field num"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={draft.price}
                    onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="Descrição (opcional)">
                <textarea
                  className="field h-20 py-2"
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </Field>
              <Field label="Status">
                <select
                  className="field"
                  value={draft.active ? "1" : "0"}
                  onChange={(e) => setDraft({ ...draft, active: e.target.value === "1" })}
                >
                  <option value="1">Ativo</option>
                  <option value="0">Inativo</option>
                </select>
              </Field>
            </div>
            <div className="flex justify-end gap-2 border-t px-5 py-3">
              <Btn variant="outline" onClick={() => setDraft(null)}>
                Cancelar
              </Btn>
              <Btn variant="success" onClick={save}>
                Salvar
              </Btn>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
