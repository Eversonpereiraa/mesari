import { cva, type VariantProps } from "class-variance-authority";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { actions, useStore, type Status } from "@/lib/store";
import mark from "@/assets/mesari-mark.png.asset.json";

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

export function Btn({ className, variant, size, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof btn>) {
  return <button className={cn(btn({ variant, size }), className)} {...p} />;
}

const statusMap: Record<Status, { label: string; cls: string }> = {
  livre: { label: "Livre", cls: "bg-free-bg text-free" },
  ocupada: { label: "Ocupada", cls: "bg-busy-bg text-busy" },
  conta: { label: "Conta solicitada", cls: "bg-bill-bg text-bill" },
};
export function StatusTag({ s, className }: { s: Status; className?: string }) {
  return <span className={cn("inline-block rounded-sm px-2 py-0.5 text-xs font-semibold", statusMap[s].cls, className)}>{statusMap[s].label}</span>;
}
export const statusLabel = (s: Status) => statusMap[s].label;

export function Mark({ className }: { className?: string }) {
  return <img src={mark.url} alt="" className={cn("object-cover mix-blend-multiply", className)} />;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 py-2 text-sm text-ink">
      <input type="checkbox" className="h-4 w-4 accent-primary" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function useRequireAuth() {
  const user = useStore((s) => s.user);
  const nav = useNavigate();
  useEffect(() => {
    const t = setTimeout(() => { if (!user) nav({ to: "/" }); }, 50);
    return () => clearTimeout(t);
  }, [user, nav]);
  return user;
}

const nav = [
  { to: "/caixa", label: "Mesas" },
  { to: "/garcom", label: "App do garçom" },
  { to: "/cardapio", label: "Cardápio" },
  { to: "/layout", label: "Layout do salão" },
  { to: "/impressao", label: "Impressão" },
  { to: "/restaurante", label: "Restaurante" },
] as const;

export function AppShell({ children, center, right }: { children: ReactNode; center?: ReactNode; right?: ReactNode }) {
  const user = useRequireAuth();
  const name = useStore((s) => s.restaurant.name);
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-52 shrink-0 flex-col border-r bg-card md:flex">
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <Mark className="h-7 w-7" />
          <span className="truncate font-semibold tracking-wide text-ink">{name.toUpperCase()}</span>
        </div>
        <nav className="flex-1 p-2">
          {nav.map((n) => (
            <Link key={n.to} to={n.to}
              className={cn("block rounded-md px-3 py-2 text-sm",
                path.startsWith(n.to) ? "bg-muted font-semibold text-ink" : "text-muted-foreground hover:bg-muted hover:text-ink")}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="border-t p-3 text-xs text-muted-foreground">
          <div className="mb-2 truncate">Usuário: <span className="font-medium text-ink">{user?.name}</span></div>
          <Btn variant="outline" size="sm" className="w-full" onClick={() => actions.logout()}>Sair</Btn>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 grid h-14 grid-cols-[1fr_auto_1fr] items-center gap-4 border-b bg-card px-5">
          <span className="truncate text-sm text-muted-foreground md:invisible">{name}</span>
          <div className="text-center font-semibold text-ink">{center}</div>
          <div className="flex justify-end gap-2">{right}</div>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
