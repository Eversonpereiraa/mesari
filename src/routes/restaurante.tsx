import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { actions, useStore, type StaffMember } from "@/lib/store";
import { AppShell, Btn, Field } from "@/components/ui-kit";

export const Route = createFileRoute("/restaurante")({
  head: () => ({
    meta: [
      { title: "Dados do restaurante | Mesari" },
      { name: "description", content: "Nome, telefone, endereço e logo do restaurante." },
      { property: "og:title", content: "Dados do restaurante | Mesari" },
      { property: "og:description", content: "Nome, telefone, endereço e logo do restaurante." },
    ],
  }),
  component: Restaurante,
});

function Restaurante() {
  const r = useStore((s) => s.restaurant);
  const staff = useStore((s) => s.staff);
  const role = useStore((s) => s.user?.role);
  const [f, setF] = useState(r);
  const [ok, setOk] = useState(false);
  const [tab, setTab] = useState<"dados" | "equipe">("dados");
  const [staffDraft, setStaffDraft] = useState<Partial<StaffMember> | null>(null);
  const [staffError, setStaffError] = useState("");
  const [passwordResetStaff, setPasswordResetStaff] = useState<StaffMember | null>(null);
  const [passwordResetDraft, setPasswordResetDraft] = useState("");
  const [passwordResetError, setPasswordResetError] = useState("");
  useEffect(() => setF(r), [r]);

  const onLogo = (file?: File) => {
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => setF((x) => ({ ...x, logo: String(rd.result) }));
    rd.readAsDataURL(file);
  };

  const saveStaff = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = staffDraft?.name?.trim() ?? "";
    const username = staffDraft?.username ?? "";
    const password = staffDraft?.password ?? "";
    if (!name) {
      setStaffError("Nome obrigatório.");
      return;
    }
    if (
      username.length < 3 ||
      username.length > 30 ||
      username !== username.toLowerCase() ||
      /\s/.test(username)
    ) {
      setStaffError("O usuário deve ter de 3 a 30 caracteres, em minúsculas e sem espaços.");
      return;
    }
    if (!staffDraft?.id && password.length < 6) {
      setStaffError("A senha deve ter no mínimo 6 caracteres.");
      return;
    }
    try {
      await actions.saveStaff({
        id: staffDraft.id,
        name,
        username,
        password: staffDraft.id ? "" : password,
      });
      setStaffDraft(null);
      setStaffError("");
    } catch (error) {
      setStaffError(error instanceof Error ? error.message : String(error));
    }
  };

  const resetStaffPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (passwordResetDraft.length < 6) {
      setPasswordResetError("A senha deve ter no mínimo 6 caracteres.");
      return;
    }
    if (!passwordResetStaff) return;
    try {
      await actions.resetStaffPassword(passwordResetStaff.username, passwordResetDraft);
      setPasswordResetStaff(null);
      setPasswordResetDraft("");
      setPasswordResetError("");
    } catch (error) {
      setPasswordResetError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <AppShell center="Configurações do Restaurante">
      <div className="mx-auto max-w-3xl p-5">
        <div
          role="tablist"
          aria-label="Configurações do restaurante"
          className="mb-5 inline-flex rounded-xl border bg-card p-1"
        >
          <button
            role="tab"
            aria-selected={tab === "dados"}
            onClick={() => setTab("dados")}
            className={`min-h-10 rounded-lg px-4 text-sm font-semibold ${tab === "dados" ? "bg-primary text-white" : "text-muted-foreground hover:text-ink"}`}
          >
            Dados do restaurante
          </button>
          {role === "caixa" && (
            <button
              role="tab"
              aria-selected={tab === "equipe"}
              onClick={() => setTab("equipe")}
              className={`min-h-10 rounded-lg px-4 text-sm font-semibold ${tab === "equipe" ? "bg-primary text-white" : "text-muted-foreground hover:text-ink"}`}
            >
              Equipe
            </button>
          )}
        </div>
        {tab === "dados" || role !== "caixa" ? (
          <form
            className="space-y-4 rounded-lg border bg-card p-6"
            onSubmit={async (e) => {
              e.preventDefault();
              await actions.updateRestaurant(f);
              setOk(true);
              setTimeout(() => setOk(false), 2000);
            }}
          >
            <Field label="Nome do restaurante">
              <input
                className="field"
                value={f.name}
                onChange={(e) => setF({ ...f, name: e.target.value })}
              />
            </Field>
            <Field label="Telefone">
              <input
                className="field"
                value={f.phone}
                onChange={(e) => setF({ ...f, phone: e.target.value })}
              />
            </Field>
            <Field label="Endereço">
              <input
                className="field"
                value={f.address}
                onChange={(e) => setF({ ...f, address: e.target.value })}
              />
            </Field>
            <Field label="CNPJ">
              <input
                className="field"
                value={f.cnpj}
                onChange={(e) => setF({ ...f, cnpj: e.target.value })}
              />
            </Field>
            <Field
              label="Instagram"
              hint="Opcional. Será exibido no rodapé do cupom em vez do telefone."
            >
              <input
                className="field"
                placeholder="@restaurante"
                value={f.instagram}
                onChange={(e) => setF({ ...f, instagram: e.target.value })}
              />
            </Field>
            <div className="space-y-3 border-t pt-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={f.serviceChargeEnabled}
                  onChange={(e) => setF({ ...f, serviceChargeEnabled: e.target.checked })}
                />
                Cobrar taxa de serviço
              </label>
              <Field label="Percentual da taxa de serviço">
                <div className="relative">
                  <input
                    className="field pr-10"
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    disabled={!f.serviceChargeEnabled}
                    value={f.serviceChargePercent}
                    onChange={(e) =>
                      setF({
                        ...f,
                        serviceChargePercent: e.target.value === "" ? 0 : Number(e.target.value),
                      })
                    }
                  />
                  <span className="absolute right-3 top-2.5 text-sm text-muted-foreground">%</span>
                </div>
              </Field>
            </div>
            <Field label="Logo" hint="PNG ou JPG, até 1 MB.">
              <div className="flex items-center gap-3">
                <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-md border bg-background text-xs text-muted-foreground">
                  {f.logo ? (
                    <img src={f.logo} alt="Logo" className="h-full w-full object-contain" />
                  ) : (
                    "—"
                  )}
                </div>
                <input
                  type="file"
                  accept="image/*"
                  className="text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-card file:px-3 file:py-1.5 file:text-sm file:text-ink"
                  onChange={(e) => onLogo(e.target.files?.[0])}
                />
              </div>
            </Field>
            <div className="flex items-center justify-end gap-3 border-t pt-4">
              {ok && <span className="text-sm text-free">Dados salvos.</span>}
              <Btn type="submit" variant="success">
                Salvar
              </Btn>
            </div>
          </form>
        ) : (
          <section className="overflow-hidden rounded-[14px] border bg-card shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b p-5">
              <div>
                <h2 className="font-display text-xl font-bold text-ink">Equipe</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Gerencie os acessos do app do garçom.
                </p>
              </div>
              <Btn
                onClick={() => {
                  setStaffDraft({ name: "", username: "", password: "" });
                  setStaffError("");
                }}
              >
                <Plus className="h-4 w-4" />
                Adicionar garçom
              </Btn>
            </div>
            <div className="divide-y">
              {staff.map((person) => (
                <div key={person.id} className="flex items-center gap-3 px-5 py-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-primary">
                    <Users className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-ink">{person.name}</div>
                    <div className="truncate text-sm text-muted-foreground">@{person.username}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPasswordResetStaff(person);
                      setPasswordResetDraft("");
                      setPasswordResetError("");
                    }}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-primary hover:bg-accent"
                  >
                    Redefinir senha
                  </button>
                  <button
                    type="button"
                    aria-label={`Editar ${person.name}`}
                    onClick={() => {
                      setStaffDraft({
                        id: person.id,
                        name: person.name,
                        username: person.username,
                        password: "",
                      });
                      setStaffError("");
                    }}
                    className="grid h-10 w-10 place-items-center rounded-lg text-primary hover:bg-accent"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Excluir ${person.name}`}
                    onClick={() =>
                      confirm(`Excluir o acesso de ${person.name}?`) &&
                      actions.deleteStaff(person.id)
                    }
                    className="grid h-10 w-10 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {staff.length === 0 && (
                <div className="p-10 text-center text-sm text-muted-foreground">
                  Nenhum garçom cadastrado.
                </div>
              )}
            </div>
          </section>
        )}
      </div>
      {staffDraft && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          onClick={() => setStaffDraft(null)}
        >
          <form
            onSubmit={saveStaff}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-md space-y-4 rounded-[14px] border bg-card p-6 shadow-2xl"
          >
            <h2 className="font-display text-xl font-bold text-ink">
              {staffDraft.id ? "Editar garçom" : "Novo garçom"}
            </h2>
            <Field label="Nome">
              <input
                autoFocus
                className="field"
                value={staffDraft.name ?? ""}
                onChange={(event) => setStaffDraft({ ...staffDraft, name: event.target.value })}
              />
            </Field>
            <Field label="Usuário">
              <input
                autoComplete="username"
                className="field"
                minLength={3}
                maxLength={30}
                value={staffDraft.username ?? ""}
                onChange={(event) =>
                  setStaffDraft({ ...staffDraft, username: event.target.value.toLowerCase() })
                }
              />
            </Field>
            {!staffDraft.id && (
              <Field label="Senha">
                <input
                  autoComplete="new-password"
                  type="password"
                  minLength={6}
                  required
                  className="field"
                  value={staffDraft.password ?? ""}
                  onChange={(event) =>
                    setStaffDraft({ ...staffDraft, password: event.target.value })
                  }
                />
              </Field>
            )}
            {staffError && (
              <p role="alert" className="text-sm text-destructive">
                {staffError}
              </p>
            )}
            <div className="flex justify-end gap-2 border-t pt-4">
              <Btn type="button" variant="outline" onClick={() => setStaffDraft(null)}>
                Cancelar
              </Btn>
              <Btn type="submit" variant="success">
                Salvar
              </Btn>
            </div>
          </form>
        </div>
      )}
      {passwordResetStaff && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          onClick={() => setPasswordResetStaff(null)}
        >
          <form
            onSubmit={resetStaffPassword}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-md space-y-4 rounded-[14px] border bg-card p-6 shadow-2xl"
          >
            <h2 className="font-display text-xl font-bold text-ink">
              Redefinir senha de {passwordResetStaff.name}
            </h2>
            <Field label="Nova senha">
              <input
                autoFocus
                autoComplete="new-password"
                type="password"
                minLength={6}
                required
                className="field"
                value={passwordResetDraft}
                onChange={(event) => setPasswordResetDraft(event.target.value)}
              />
            </Field>
            {passwordResetError && (
              <p role="alert" className="text-sm text-destructive">
                {passwordResetError}
              </p>
            )}
            <div className="flex justify-end gap-2 border-t pt-4">
              <Btn type="button" variant="outline" onClick={() => setPasswordResetStaff(null)}>
                Cancelar
              </Btn>
              <Btn type="submit" variant="success">
                Redefinir senha
              </Btn>
            </div>
          </form>
        </div>
      )}
    </AppShell>
  );
}
