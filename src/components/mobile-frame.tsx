import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, LogOut, Repeat2 } from "lucide-react";
import { actions, useStore } from "@/lib/store";
import { ConnectionIndicator, StoreErrorBanner, useRequireAuth } from "./ui-kit";
import { MesariLogo } from "@/components/mesari-logo";
import { startKitchenPresenceObserver } from "@/lib/kitchen-presence";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function MobileFrame({
  title,
  subtitle,
  onBack,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  onBack?: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useRequireAuth();
  const user = useStore((s) => s.user);
  const navigate = useNavigate();
  // Começa a ouvir a estação de impressão assim que o garçom entra, para que o
  // estado já esteja sincronizado quando ele enviar o primeiro pedido.
  useEffect(() => startKitchenPresenceObserver(), []);
  const switchUser = () => {
    actions.logout();
    navigate({ to: "/" });
  };
  const initial = user?.name.trim().charAt(0).toUpperCase() || "G";

  return (
    <div className="mx-auto flex h-[100dvh] max-w-md flex-col border-x border-border bg-background shadow-xl">
      <header className="sticky top-0 z-20 flex h-[76px] shrink-0 items-center gap-2 border-b border-white/10 bg-sidebar px-3 text-[#F4F1EC]">
        <div className="grid h-11 w-11 shrink-0 place-items-center">
          {onBack ? (
            <button
              aria-label="Voltar"
              onClick={onBack}
              className="grid h-11 w-11 place-items-center rounded-full text-[#F4F1EC] hover:bg-white/10"
            >
              <ChevronLeft className="h-7 w-7" />
            </button>
          ) : (
            <MesariLogo variant="symbol" className="h-10 w-10 rounded-lg" />
          )}
        </div>
        <div className="min-w-0 flex-1 text-center">
          <h1 className="truncate font-display text-base font-extrabold leading-5 text-[#F4F1EC]">
            {title}
          </h1>
          <div className="flex items-center justify-center gap-2">
            <p className="truncate text-xs leading-4 text-[#F4F1EC]/75">{subtitle}</p>
            <ConnectionIndicator compact />
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={`Usuário ${user?.name ?? "Garçom"}`}
              className="flex h-12 max-w-[108px] shrink-0 items-center gap-2 rounded-full px-1 text-[#F4F1EC] hover:bg-white/10"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#F4F1EC] font-display text-sm font-extrabold text-[#0E2A2B]">
                {initial}
              </span>
              <span className="max-w-[58px] truncate text-xs font-semibold">
                {user?.name ?? "Garçom"}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8} className="min-w-44 rounded-xl p-1.5">
            <DropdownMenuItem onSelect={switchUser} className="min-h-11 rounded-lg">
              <Repeat2 className="h-4 w-4" />
              Trocar usuário
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={switchUser} className="min-h-11 rounded-lg">
              <LogOut className="h-4 w-4" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <ConnectionBanner />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <StoreErrorBanner />
        {children}
      </div>
      {footer && (
        <div className="sticky bottom-0 z-10 shrink-0 border-t border-white/10 bg-sidebar p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-sidebar-foreground">
          {footer}
        </div>
      )}
    </div>
  );
}

/** Faixa fina no topo: amarela ao reconectar, vermelha sem internet. */
function ConnectionBanner() {
  const connection = useStore((s) => s.connection);
  // Espera 2s antes de mostrar "Reconectando" para não piscar na abertura do app.
  const [showReconnecting, setShowReconnecting] = useState(false);
  useEffect(() => {
    if (connection !== "reconnecting") {
      setShowReconnecting(false);
      return;
    }
    const timer = window.setTimeout(() => setShowReconnecting(true), 2000);
    return () => window.clearTimeout(timer);
  }, [connection]);

  if (connection === "offline") {
    return (
      <div
        role="alert"
        className="shrink-0 bg-destructive px-3 py-1.5 text-center text-sm font-bold text-white"
      >
        Sem internet: o pedido NÃO foi enviado
      </div>
    );
  }
  if (connection === "reconnecting" && showReconnecting) {
    return (
      <div
        role="status"
        className="shrink-0 bg-amber-400 px-3 py-1.5 text-center text-sm font-bold text-amber-950"
      >
        Reconectando… pedidos podem demorar
      </div>
    );
  }
  return null;
}
