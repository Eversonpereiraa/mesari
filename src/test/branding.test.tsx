import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MesariLogo } from "@/components/mesari-logo";
import { MESARI_BRAND } from "@/lib/branding";

describe("identidade visual do Mesari", () => {
  it("usa as três imagens oficiais da configuração central da marca", () => {
    render(
      <>
        <MesariLogo variant="vertical" />
        <MesariLogo variant="horizontal" />
        <MesariLogo variant="symbol" />
      </>,
    );

    expect(screen.getByRole("img", { name: "Símbolo do Mesari" })).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "Mesari" })).toHaveLength(2);
    expect(MESARI_BRAND.vertical).not.toBe(MESARI_BRAND.horizontal);
    expect(MESARI_BRAND.symbol).not.toBe(MESARI_BRAND.horizontal);
  });
});
