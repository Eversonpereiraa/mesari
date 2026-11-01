import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { JobCard } from "@/routes/impressora-virtual";
import { escPosKitchenTicket, getDefaultPrintSettings } from "@/lib/printing";
import {
  addVirtualJob,
  clearVirtualJobs,
  getVirtualJobs,
  resetVirtualPrinterForTests,
} from "@/lib/virtual-printer";
import { encodeText } from "@/lib/escpos-codepages";

describe("cartão da impressora virtual", () => {
  beforeEach(() => {
    resetVirtualPrinterForTests();
    clearVirtualJobs();
  });

  it("mostra a comanda como papel térmico e permite reimprimir na fila", () => {
    const settings = { ...getDefaultPrintSettings(), paperWidth: 80 as const, columns: 48 };
    const job = addVirtualJob({
      tipo: "comanda",
      html: "<p>Pedido</p>",
      escpos: escPosKitchenTicket(
        {
          id: "k",
          number: 9,
          table: 3,
          sector: "cozinha",
          waiter: "Ana",
          additional: true,
          createdAt: Date.now(),
          items: [{ product: "Pão de queijo", quantity: 3, note: "bem assado" }],
        },
        settings,
      ),
      larguraMm: 80,
      colunas: 48,
      setor: "cozinha",
      mesa: 3,
      titulo: "Pedido #9",
    });
    render(<JobCard job={job} />);

    expect(screen.getByText("Mesa 03")).toBeInTheDocument();
    expect(screen.getByText("MESA 03")).toBeInTheDocument();
    expect(screen.getByText("3x Pão de queijo")).toBeInTheDocument();
    expect(screen.getByText("** ADICIONAL **")).toHaveClass("font-bold");
    expect(screen.getByText("corte parcial")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reimprimir na fila" }));
    expect(getVirtualJobs()).toHaveLength(2);
    expect(getVirtualJobs()[0]).toMatchObject({ titulo: "Pedido #9", reimpressao: true });
  });

  it("avisa quando linhas passam da largura", () => {
    const job = addVirtualJob({
      tipo: "teste",
      html: "<p>x</p>",
      escpos: new Uint8Array([...encodeText("x".repeat(40)), 0x0a]),
      larguraMm: 58,
      colunas: 32,
      titulo: "Teste",
    });
    render(<JobCard job={job} />);
    expect(screen.getByText("1 linha passa de 32 colunas")).toBeInTheDocument();
  });
});
