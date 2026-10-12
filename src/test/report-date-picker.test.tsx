import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ReportDatePicker,
  reportDateRange,
  saoPauloDateKey,
} from "@/components/report-date-picker";

describe("filtro de datas de vendas", () => {
  it("mantém o dia do calendário no fuso de São Paulo", () => {
    expect(saoPauloDateKey(new Date("2026-10-12T01:30:00.000Z"))).toBe("2026-10-11");
  });

  it("consulta o intervalo inclusivo como dias inteiros em São Paulo", () => {
    const range = reportDateRange("2026-10-11", "2026-10-12");

    expect(range.start.toISOString()).toBe("2026-10-11T03:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-10-13T02:59:59.999Z");
  });

  it("abre o calendário em português e aciona os atalhos de período", async () => {
    const onShortcut = vi.fn();
    render(<ReportDatePicker startValue="2026-10-11" onChange={vi.fn()} onShortcut={onShortcut} />);

    fireEvent.click(screen.getByRole("button", { name: "Filtrar vendas por data" }));

    expect(await screen.findByText("outubro de 2026")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Últimos 7 dias" }));
    expect(onShortcut).toHaveBeenCalledWith("last7days");
  });
});
