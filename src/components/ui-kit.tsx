import { cva, type VariantProps } from "class-variance-authority";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import {
  BookOpen,
  Bike,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  LogOut,
  Map,
  Printer,
  ReceiptText,
  Settings2,
  Smartphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { actions, useStore, type Status } from "@/lib/store";
import { MesariLogo } from "@/components/mesari-logo";
import { getPrintSettings } from "@/lib/printing";
import { KitchenPrintStation } from "@/components/kitchen-print-station";
import { useConfirm } from "@/components/system-dialog-provider";

export const btn = cva(
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary/90",
        success: "bg-success text-success-foreground hover:bg-success/90",
        neutral: "bg-neutral text-neutral-foreground hover:bg-neutral/90",
        danger: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-card text-foreground hover:bg-muted",
        ghost: "text-muted-foreground hover:text-ink hover:bg-muted",
      },
      size: { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm", lg: "h-12 px-5 text-base" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Btn({
  className,
  variant,
  size,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof btn>) {
  return <button className={cn(btn({ variant, size }), className)} {...p} />;
}

const statusMap: Record<Status, { label: string; cls: string }> = {
  livre: { label: "Livre", cls: "bg-free text-white" },
  ocupada: { label: "Ocupada", cls: "bg-busy text-white" },
  conta: { label: "Conta solicitada", cls: "bg-bill text-white" },
};
export function StatusTag({ s, className }: { s: Status; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap",
        statusMap[s].cls,
        className,
      )}
    >
      {statusMap[s].label}
    </span>
  );
}
export const statusLabel = (s: Status) => statusMap[s].label;

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 py-2 text-sm text-ink">
      <input
        type="checkbox"
        className="h-4 w-4 accent-primary"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export function useRequireAuth() {
  const user = useStore((s) => s.user);
  const loading = useStore((s) => s.loading);
  const configured = useStore((s) => s.configured);
  const nav = useNavigate();
  useEffect(() => {
    if (configured && !loading && !user) nav({ to: "/" });
  }, [configured, loading, user, nav]);
  return user;
}

export function ConnectionIndicator({ compact = false }: { compact?: boolean }) {
  const connection = useStore((s) => s.connection);
  const connected = connection === "connected";
  return (
    <span
      role="status"
      aria-label={connected ? "Conectado" : "Reconectando"}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium",
        connected ? "text-free" : "text-destructive",
        compact && "gap-1 text-[9px]",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-2 w-2 rounded-full",
          connected ? "bg-free" : "bg-destructive animate-pulse",
        )}
      />
      {connected ? "Conectado" : "Reconectando..."}
    </span>
  );
}

export function StoreErrorBanner() {
  const error = useStore((s) => s.error);
  if (!error) return null;
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive"
    >
      <span>{error}</span>
      <button
        aria-label="Dispensar erro"
        onClick={() => actions.clearError()}
        className="shrink-0 font-semibold"
      >
        ×
      </button>
    </div>
  );
}

const nav = [
  { to: "/caixa", label: "Mesas", Icon: LayoutGrid },
  { to: "/delivery", label: "Delivery", Icon: Bike },
  { to: "/vendas", label: "Vendas", Icon: ReceiptText },
  { to: "/garcom", label: "App do garçom", Icon: Smartphone },
  { to: "/cardapio", label: "Cardápio", Icon: BookOpen },
  { to: "/layout", label: "Layout do salão", Icon: Map },
  { to: "/impressao", label: "Impressão", Icon: Printer },
  { to: "/restaurante", label: "Restaurante", Icon: Settings2 },
] as const;

export function AppShell({
  children,
  center,
  right,
}: {
  children: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
}) {
  const user = useRequireAuth();
  const confirmar = useConfirm();
  const name = useStore((s) => s.restaurant.name);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-white/10 bg-sidebar text-sidebar-foreground transition-[width] md:flex",
          collapsed ? "w-[4.5rem]" : "w-56",
        )}
      >
        <div
          className={cn(
            "flex h-16 items-center border-b border-white/10",
            collapsed ? "justify-center px-2" : "gap-3 px-3",
          )}
        >
          {collapsed ? (
            <MesariLogo variant="symbol" className="h-10 w-10 rounded-lg" />
          ) : (
            <MesariLogo variant="horizontal" className="h-7 w-[9.5rem] rounded-md" />
          )}
          <button
            type="button"
            aria-label={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
            title={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
            onClick={() => setCollapsed((value) => !value)}
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-md text-sidebar-foreground/75 hover:bg-white/10 hover:text-sidebar-foreground",
              collapsed && "absolute right-1 top-[4.5rem] z-10 bg-sidebar",
            )}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>
        <nav className={cn("flex-1 space-y-1", collapsed ? "p-2" : "p-3")}>
          {nav
            .filter(
              (item) =>
                (item.to !== "/vendas" && item.to !== "/impressao" && item.to !== "/delivery") ||
                user?.role === "caixa",
            )
            .map(({ Icon, ...item }) => (
              <Link
                key={item.to}
                title={collapsed ? item.label : undefined}
                to={item.to}
                className={cn(
                  "flex min-h-11 items-center rounded-xl text-sm font-medium",
                  collapsed ? "justify-center px-2" : "gap-3 px-3",
                  path.startsWith(item.to)
                    ? "bg-primary text-white shadow-sm"
                    : "text-sidebar-foreground/75 hover:bg-white/10 hover:text-sidebar-foreground",
                )}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" />
                {!collapsed && item.label}
              </Link>
            ))}
        </nav>
        <div
          className={cn(
            "border-t border-white/10 text-xs text-sidebar-foreground/75",
            collapsed ? "p-2" : "p-4",
          )}
        >
          {!collapsed && (
            <div className="mb-3 truncate">
              Conectado como{" "}
              <span className="font-semibold text-sidebar-foreground">{user?.name}</span>
            </div>
          )}
          <Btn
            variant="outline"
            size="sm"
            aria-label="Sair"
            title="Sair"
            className={cn(
              "border-white/20 bg-white/5 text-sidebar-foreground hover:bg-white/10 hover:text-white",
              collapsed ? "w-full px-1" : "w-full",
            )}
            onClick={async () => {
              if (
                user?.role === "caixa" &&
                getPrintSettings().printKitchenEnabled &&
                !(await confirmar({
                  title: "Sair do sistema?",
                  description: "As comandas deixarão de imprimir. Deseja sair do sistema?",
                  confirmText: "Sair",
                  variant: "danger",
                }))
              ) {
                return;
              }
              void actions.logout();
            }}
          >
            {collapsed ? <LogOut className="h-4 w-4" /> : "Sair"}
          </Btn>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 grid h-16 grid-cols-[1fr_auto_1fr] items-center gap-4 border-b bg-background/95 px-5 backdrop-blur">
          <span className="flex min-w-0 items-center md:invisible">
            <span className="md:hidden">
              <MesariLogo variant="symbol" className="h-9 w-9 rounded-md" />
            </span>
            <span className="sr-only">{name}</span>
          </span>
          <div className="text-center font-semibold text-ink">{center}</div>
          <div className="flex items-center justify-end gap-3">
            <ConnectionIndicator />
            {right}
          </div>
        </header>
        <main className="flex-1">
          <StoreErrorBanner />
          {user?.role === "caixa" && <KitchenPrintStation />}
          {children}
        </main>
      </div>
    </div>
  );
}
