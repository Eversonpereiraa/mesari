import { useEffect, useState } from "react";
import { Btn } from "@/components/ui-kit";

/**
 * Aviso do app desktop quando uma versão nova já foi baixada. Nunca reinicia sozinho: só
 * quando o usuário clica. Se escolher "Depois", a versão nova entra ao fechar o Mesari.
 */
export function DesktopUpdateBanner() {
  const [version, setVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    const updates = window.mesariDesktop?.updates;
    if (!updates) return;
    void updates
      .status()
      .then((status) => setVersion(status.versao))
      .catch(() => undefined);
    return updates.onReady((info) => {
      setVersion(info.versao);
      setDismissed(false);
    });
  }, []);

  if (!version || dismissed) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-50 flex w-[min(92vw,30rem)] -translate-x-1/2 flex-wrap items-center gap-3 rounded-lg border bg-card p-3 text-sm text-ink shadow-xl"
    >
      <span className="min-w-0 flex-1">Nova versão disponível ({version}). Reiniciar agora?</span>
      <Btn size="sm" variant="outline" onClick={() => setDismissed(true)}>
        Depois
      </Btn>
      <Btn
        size="sm"
        disabled={restarting}
        onClick={() => {
          setRestarting(true);
          void window.mesariDesktop?.updates?.install().finally(() => setRestarting(false));
        }}
      >
        {restarting ? "Reiniciando..." : "Reiniciar agora"}
      </Btn>
    </div>
  );
}
