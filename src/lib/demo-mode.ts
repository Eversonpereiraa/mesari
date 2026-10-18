import { setDemoSimulation } from "@/lib/printing";

/**
 * Modo demonstração (?demo=1): para mostrar o Mesari ao dono do restaurante sem
 * carregar impressora. Vale só nesta aba (sessionStorage) e nunca grava nas
 * configurações de impressão.
 */
const DEMO_KEY = "mesari-demo";
const WINDOW_OPENED_KEY = "mesari-demo-janela";

function session() {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Chamado ao abrir o app: guarda o ?demo=1 para não perder depois do login. */
export function captureDemoFlag() {
  if (typeof window === "undefined") return;
  const value = new URLSearchParams(window.location.search).get("demo");
  try {
    if (value === "1") session()?.setItem(DEMO_KEY, "1");
    if (value === "0") session()?.removeItem(DEMO_KEY);
  } catch {
    // Sem sessionStorage: o modo demo só vale enquanto a URL tiver ?demo=1.
  }
}

export function demoRequested() {
  try {
    return session()?.getItem(DEMO_KEY) === "1";
  } catch {
    return false;
  }
}

/** Liga a simulação temporária só para o caixa. Retorna se o modo ficou ativo. */
export function applyDemoMode(role: string | undefined) {
  const active = role === "caixa" && demoRequested();
  setDemoSimulation(active);
  return active;
}

export function leaveDemoMode() {
  try {
    session()?.removeItem(DEMO_KEY);
    session()?.removeItem(WINDOW_OPENED_KEY);
  } catch {
    // ignora
  }
  setDemoSimulation(false);
}

export function openVirtualPrinterWindow() {
  const width = 460;
  const left = Math.max(0, window.screen.availWidth - width);
  const opened = window.open(
    "/impressora-virtual?janela=1",
    "mesari-impressora-virtual",
    `popup,width=${width},height=${window.screen.availHeight},left=${left},top=0`,
  );
  opened?.focus();
  return Boolean(opened);
}

/** Abre a janela lateral uma vez por sessão; o navegador pode bloquear o popup. */
export function openVirtualPrinterWindowOnce() {
  try {
    if (session()?.getItem(WINDOW_OPENED_KEY) === "1") return true;
    const opened = openVirtualPrinterWindow();
    if (opened) session()?.setItem(WINDOW_OPENED_KEY, "1");
    return opened;
  } catch {
    return false;
  }
}
