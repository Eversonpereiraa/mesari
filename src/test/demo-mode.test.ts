import { afterEach, describe, expect, it } from "vitest";
import { applyDemoMode, captureDemoFlag, leaveDemoMode } from "@/lib/demo-mode";
import { getDefaultPrintSettings, getPrintSettings, savePrintSettings } from "@/lib/printing";

function visit(search: string) {
  window.history.replaceState(null, "", `/${search}`);
  captureDemoFlag();
}

describe("modo demonstração", () => {
  afterEach(() => {
    leaveDemoMode();
    sessionStorage.clear();
    localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("só liga para o caixa e lembra o ?demo=1 depois do login", () => {
    savePrintSettings({ ...getDefaultPrintSettings(), printerMode: "browser" });
    visit("?demo=1");
    window.history.replaceState(null, "", "/caixa");

    expect(applyDemoMode("garcom")).toBe(false);
    expect(getPrintSettings().printerMode).toBe("browser");

    expect(applyDemoMode("caixa")).toBe(true);
    expect(getPrintSettings()).toMatchObject({
      printerMode: "simulacao",
      printKitchenEnabled: true,
    });
  });

  it("sem ?demo=1 não muda nada, e sair da demonstração volta ao modo salvo", () => {
    savePrintSettings({ ...getDefaultPrintSettings(), printerMode: "browser" });
    visit("");
    expect(applyDemoMode("caixa")).toBe(false);

    visit("?demo=1");
    expect(applyDemoMode("caixa")).toBe(true);
    leaveDemoMode();
    expect(applyDemoMode("caixa")).toBe(false);
    expect(getPrintSettings()).toMatchObject({
      printerMode: "browser",
      printKitchenEnabled: false,
    });
  });
});
