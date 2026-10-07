import type { ReactNode } from "react";
import { useRequireAuth } from "./ui-kit";

export function MobileFrame({ header, children, footer }: { header: ReactNode; children: ReactNode; footer?: ReactNode }) {
  useRequireAuth();
  return (
    <div className="mx-auto flex h-[100dvh] max-w-md flex-col border-x bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card px-4">{header}</header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer && <div className="shrink-0 border-t bg-card p-3">{footer}</div>}
    </div>
  );
}
