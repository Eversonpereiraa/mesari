import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { actions, refreshData, useStore, type StaffMember } from "@/lib/store";
import { AppShell, Btn, Field } from "@/components/ui-kit";
import { useConfirm } from "@/components/system-dialog-provider";
import { supabase } from "@/lib/supabase";
import { DemoSeedPanel } from "@/components/demo-seed-panel";
import { demoRequested } from "@/lib/demo-mode";
import {
  CnpjCpfInput,
  InstagramInput,
  MoneyInput,
  PasswordInput,
  PercentInput,
  PhoneInput,
  TextInput,
  UsernameInput,
} from "@/components/inputs";
import {
  DELIVERY_FEE_MAX_CENTS,
  TEXT_LIMITS,
  cleanText,
  cpfCnpjError,
  instagramError,
  moneyError,
  passwordError,
  percentError,
  phoneError,
  requiredTextError,
  usernameError,
} from "@/lib/masks";

/** Rascunho do formulário de funcionário: a senha só existe aqui, nunca no perfil salvo. */
type StaffDraft = Partial<StaffMember> & { password?: string };

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
  const confirmar = useConfirm();
  const r = useStore((s) => s.restaurant);
  const staff = useStore((s) => s.staff);
  const role = useStore((s) => s.user?.role);
  const [f, setF] = useState(r);
  /** Centavos; null = vazio. */
  const [deliveryFee, setDeliveryFee] = useState<number | null>(0);
  const [triedSave, setTriedSave] = useState(false);
  const [staffTried, setStaffTried] = useState(false);
  const [resetTried, setResetTried] = useState(false);
  const [ok, setOk] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [tab, setTab] = useState<"dados" | "equipe">("dados");
  const [staffDraft, setStaffDraft] = useState<StaffDraft | null>(null);
  const [staffError, setStaffError] = useState("");
  const [passwordResetStaff, setPasswordResetStaff] = useState<StaffMember | null>(null);
  const [passwordResetDraft, setPasswordResetDraft] = useState("");
  const [passwordResetError, setPasswordResetError] = useState("");
  useEffect(() => setF(r), [r]);
  useEffect(() => {
    setDeliveryFee(Math.round(Number(r.deliveryFee || 0) * 100));
  }, [r.deliveryFee]);

  const onLogo = (file?: File) => {
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => setF((x) => ({ ...x, logo: String(rd.result) }));
    rd.readAsDataURL(file);
  };

  // NaN = campo do percentual apagado (o tipo do restaurante guarda número).
  const servicePercent = Number.isNaN(f.serviceChargePercent) ? null : f.serviceChargePercent;
  const dataErrors = {
    name: requiredTextError(f.name, "Informe o nome do restaurante."),
    phone: phoneError(f.phone),
    cnpj: cpfCnpjError(f.cnpj),
    instagram: instagramError(f.instagram),
    serviceCharge: f.serviceChargeEnabled ? percentError(servicePercent) : null,
    deliveryFee: moneyError(deliveryFee, { required: true, max: DELIVERY_FEE_MAX_CENTS }),
  };
  const staffErrors = staffDraft
    ? {
        name: requiredTextError(staffDraft.name ?? "", "Informe o nome do garçom."),
        username: usernameError(staffDraft.username ?? ""),
        password: staffDraft.id ? null : passwordError(staffDraft.password ?? ""),
      }
    : {};

  const saveStaff = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!staffDraft) return;
    setStaffTried(true);
    if (Object.values(staffErrors).some(Boolean)) return;
    const name = cleanText(staffDraft.name, TEXT_LIMITS.name);
    const username = staffDraft.username ?? "";
    const password = staffDraft.password ?? "";
    try {
      await actions.saveStaff({
        ...(staffDraft.id ? { id: staffDraft.id } : {}),
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
    setResetTried(true);
    if (passwordError(passwordResetDraft)) return;
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
              setSaveError("");
              setTriedSave(true);
              if (Object.values(dataErrors).some(Boolean) || deliveryFee === null) {
                setSaveError("Corrija os campos destacados antes de salvar.");
                return;
              }
              try {
                await actions.updateRestaurant({
                  ...f,
                  name: cleanText(f.name, TEXT_LIMITS.restaurantName),
                  address: cleanText(f.address, TEXT_LIMITS.address),
                  serviceChargePercent: servicePercent ?? 0,
                });
                const { error } = await supabase.rpc("definir_taxa_entrega", {
                  p_valor: deliveryFee / 100,
                });
                if (error) throw error;
                await refreshData();
                setOk(true);
                setTimeout(() => setOk(false), 2000);
              } catch (cause) {
                setSaveError(cause instanceof Error ? cause.message : String(cause));
              }
            }}
          >
            <Field label="Nome do restaurante">
              <TextInput
                autoComplete="organization"
                enterKeyHint="next"
                aria-required
                maxLength={TEXT_LIMITS.restaurantName}
                value={f.name}
                onChange={(name) => setF({ ...f, name })}
                error={dataErrors.name}
                showError={triedSave}
              />
            </Field>
            <Field label="Telefone">
              <PhoneInput
                value={f.phone}
                onChange={(phone) => setF({ ...f, phone })}
                showError={triedSave}
              />
            </Field>
            <Field label="Endereço">
              <TextInput
                autoComplete="street-address"
                enterKeyHint="next"
                maxLength={TEXT_LIMITS.address}
                value={f.address}
                onChange={(address) => setF({ ...f, address })}
              />
            </Field>
            <Field label="CNPJ" hint="Opcional. Aceita CPF para MEI.">
              <CnpjCpfInput
                value={f.cnpj}
                onChange={(cnpj) => setF({ ...f, cnpj })}
                showError={triedSave}
              />
            </Field>
            <Field
              label="Instagram"
              hint="Opcional. Será exibido no rodapé do cupom em vez do telefone."
            >
              <InstagramInput
                value={f.instagram}
                onChange={(instagram) => setF({ ...f, instagram })}
                showError={triedSave}
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
                <PercentInput
                  disabled={!f.serviceChargeEnabled}
                  aria-label="Percentual da taxa de serviço"
                  value={servicePercent}
                  onChange={(percent) => setF({ ...f, serviceChargePercent: percent ?? NaN })}
                  showError={triedSave}
                />
                <Field
                  label="Taxa de entrega (R$)"
                  hint="Valor fixo somado a todos os pedidos de entrega. Retirada não paga taxa."
                >
                  <MoneyInput
                    aria-label="Taxa de entrega"
                    required
                    max={DELIVERY_FEE_MAX_CENTS}
                    value={deliveryFee}
                    onChange={setDeliveryFee}
                    showError={triedSave}
                  />
                </Field>
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
              {saveError && (
                <span role="alert" className="text-sm text-destructive">
                  {saveError}
                </span>
              )}
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
                  setStaffTried(false);
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
                      setResetTried(false);
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
                      setStaffTried(false);
                    }}
                    className="grid h-10 w-10 place-items-center rounded-lg text-primary hover:bg-accent"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Excluir ${person.name}`}
                    onClick={async () => {
                      if (
                        await confirmar({
                          title: "Excluir acesso?",
                          description: `Remover o acesso de ${person.name}?`,
                          confirmText: "Excluir acesso",
                          variant: "danger",
                        })
                      ) {
                        await actions.deleteStaff(person.id);
                      }
                    }}
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
        {role === "caixa" && tab === "dados" && demoRequested() && <DemoSeedPanel />}
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
              <TextInput
                autoFocus
                autoComplete="off"
                enterKeyHint="next"
                aria-required
                maxLength={TEXT_LIMITS.name}
                value={staffDraft.name ?? ""}
                onChange={(name) => setStaffDraft({ ...staffDraft, name })}
                error={staffErrors.name}
                showError={staffTried}
              />
            </Field>
            <Field label="Usuário">
              <UsernameInput
                autoComplete="off"
                value={staffDraft.username ?? ""}
                onChange={(username) => setStaffDraft({ ...staffDraft, username })}
                showError={staffTried}
              />
            </Field>
            {!staffDraft.id && (
              <Field label="Senha">
                <PasswordInput
                  enterKeyHint="done"
                  value={staffDraft.password ?? ""}
                  onChange={(password) => setStaffDraft({ ...staffDraft, password })}
                  showError={staffTried}
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
              <PasswordInput
                autoFocus
                enterKeyHint="done"
                value={passwordResetDraft}
                onChange={setPasswordResetDraft}
                showError={resetTried}
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
