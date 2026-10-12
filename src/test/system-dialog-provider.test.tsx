import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { SystemDialogProvider, useConfirm, usePrompt } from "@/components/system-dialog-provider";

function DialogHarness() {
  const confirmar = useConfirm();
  const pedirTexto = usePrompt();
  const [result, setResult] = useState<string>("");

  return (
    <>
      <button
        type="button"
        onClick={async () =>
          setResult(
            String(
              await confirmar({
                title: "Confirmar ação",
                description: "Esta ação pode ser desfeita.",
              }),
            ),
          )
        }
      >
        Abrir confirmação
      </button>
      <button
        type="button"
        onClick={async () =>
          setResult(
            String(
              await pedirTexto({
                title: "Cancelar pedido #42?",
                label: "Motivo do cancelamento",
                required: true,
                multiline: true,
                quickOptions: ["Sem estoque", "Outro"],
                confirmText: "Cancelar pedido",
              }),
            ),
          )
        }
      >
        Abrir prompt
      </button>
      <output>{result}</output>
    </>
  );
}

describe("diálogos do sistema", () => {
  it("confirma com Enter e começa com foco na ação segura", async () => {
    render(
      <SystemDialogProvider>
        <DialogHarness />
      </SystemDialogProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Abrir confirmação" }));
    const safeButton = await screen.findByRole("button", { name: "Cancelar" });
    await waitFor(() => expect(safeButton).toHaveFocus());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });

    expect(await screen.findByText("true")).toBeInTheDocument();
    expect(document.body.style.pointerEvents).toBe("");
  });

  it("valida campo obrigatório, aceita atalho rápido e salva o motivo", async () => {
    render(
      <SystemDialogProvider>
        <DialogHarness />
      </SystemDialogProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Abrir prompt" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar pedido" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("obrigatório");

    fireEvent.click(screen.getByRole("button", { name: "Sem estoque" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar pedido" }));

    expect(await screen.findByText("Sem estoque")).toBeInTheDocument();
    expect(document.body.style.pointerEvents).toBe("");
  });

  it("cancela o prompt pelo Escape", async () => {
    render(
      <SystemDialogProvider>
        <DialogHarness />
      </SystemDialogProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Abrir prompt" }));
    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });

    expect(await screen.findByText("null")).toBeInTheDocument();
  });

  it("fecha a confirmação pelo X", async () => {
    render(
      <SystemDialogProvider>
        <DialogHarness />
      </SystemDialogProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Abrir confirmação" }));
    fireEvent.click(await screen.findByRole("button", { name: "Fechar" }));

    expect(await screen.findByText("false")).toBeInTheDocument();
  });
});
