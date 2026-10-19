import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BookOpen, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  actions,
  brl,
  categorySectorOptions,
  errorMessage,
  useStore,
  type Category,
  type MenuItem,
} from "@/lib/store";
import { AppShell, Btn, Field } from "@/components/ui-kit";
import { AppSelect } from "@/components/app-select";
import { useConfirm } from "@/components/system-dialog-provider";

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
type CategoryDraft = { name: string; sector: Category["sector"]; saving: boolean; error: string };

function Cardapio() {
  const cats = useStore((s) => s.categories);
  const items = useStore((s) => s.items);
  const role = useStore((s) => s.user?.role);
  const navigate = useNavigate();
  const confirmar = useConfirm();
  const [cat, setCat] = useState(cats[0]?.id ?? "");
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [categoryError, setCategoryError] = useState("");
  const [newCategory, setNewCategory] = useState<CategoryDraft | null>(null);
  useEffect(() => {
    if (role && role !== "caixa") void navigate({ to: "/garcom", replace: true });
  }, [navigate, role]);

  const t = q.trim().toLowerCase();
  const list = items.filter((i) => (t ? i.name.toLowerCase().includes(t) : i.categoryId === cat));

  const newCat = () => setNewCategory({ name: "", sector: "cozinha", saving: false, error: "" });
  const createCategory = async () => {
    if (!newCategory || newCategory.saving || !newCategory.name.trim()) return;
    setNewCategory({ ...newCategory, saving: true, error: "" });
    try {
      setCat(await actions.addCategory(newCategory.name.trim(), newCategory.sector));
      setNewCategory(null);
    } catch (cause) {
      setNewCategory({ ...newCategory, saving: false, error: errorMessage(cause) });
    }
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
                <label className="flex flex-col gap-1 px-3 pb-2 text-xs text-muted-foreground">
                  Setor
                  <AppSelect
                    ariaLabel={`Setor de ${c.name}`}
                    className="h-8 w-full rounded-lg px-2 text-xs"
                    value={c.sector}
                    onValueChange={async (value) => {
                      const sector = value as typeof c.sector;
                      setCategoryError("");
                      try {
                        await actions.setCategorySector(c.id, sector);
                      } catch (cause) {
                        setCategoryError(errorMessage(cause));
                      }
                    }}
                    options={categorySectorOptions}
                  />
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
                        onClick={async () => {
                          if (
                            await confirmar({
                              title: "Excluir item?",
                              description: `Excluir "${i.name}" do cardápio?`,
                              confirmText: "Excluir",
                              variant: "danger",
                            })
                          ) {
                            await actions.deleteItem(i.id);
                          }
                        }}
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

      {newCategory && (
        <div
          className="fixed inset-0 z-20 grid place-items-center bg-ink/40 p-4"
          onClick={() => setNewCategory(null)}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="nova-categoria-titulo"
            className="w-full max-w-md overflow-hidden rounded-[14px] border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              void createCategory();
            }}
          >
            <h2
              id="nova-categoria-titulo"
              className="border-b bg-background px-5 py-4 font-display font-bold text-ink"
            >
              Nova categoria
            </h2>
            <div className="space-y-4 p-5">
              <Field label="Nome da categoria">
                <input
                  className="field"
                  autoFocus
                  required
                  maxLength={60}
                  placeholder="Ex.: Bebidas"
                  value={newCategory.name}
                  onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                />
              </Field>
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium text-ink">
                  Onde sai a comanda destes itens?
                </legend>
                <div className="grid gap-1.5">
                  {categorySectorOptions.map((option) => (
                    <label
                      key={option.value}
                      className={cn(
                        "flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm",
                        newCategory.sector === option.value
                          ? "border-primary bg-accent font-semibold text-primary"
                          : "text-ink hover:bg-muted",
                      )}
                    >
                      <input
                        type="radio"
                        name="setor-nova-categoria"
                        value={option.value}
                        checked={newCategory.sector === option.value}
                        onChange={() => setNewCategory({ ...newCategory, sector: option.value })}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              {newCategory.error && (
                <p role="alert" className="text-sm text-destructive">
                  {newCategory.error}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t bg-background px-5 py-3">
              <Btn type="button" variant="ghost" onClick={() => setNewCategory(null)}>
                Cancelar
              </Btn>
              <Btn type="submit" disabled={!newCategory.name.trim() || newCategory.saving}>
                {newCategory.saving ? "Criando..." : "Criar categoria"}
              </Btn>
            </div>
          </form>
        </div>
      )}

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
                  <AppSelect
                    className="field"
                    value={draft.categoryId}
                    onValueChange={(value) => setDraft({ ...draft, categoryId: value })}
                    options={cats.map((c) => ({ value: c.id, label: c.name }))}
                  />
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
                <AppSelect
                  className="field"
                  value={draft.active ? "1" : "0"}
                  onValueChange={(value) => setDraft({ ...draft, active: value === "1" })}
                  options={[
                    { value: "1", label: "Ativo" },
                    { value: "0", label: "Inativo" },
                  ]}
                />
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
