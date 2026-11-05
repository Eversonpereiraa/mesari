import { describe, expect, it, vi } from "vitest";

const remove = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase", () => ({
  supabase: { storage: { from: () => ({ remove }) } },
}));

import { logoPath, removeLogo } from "@/lib/logo-storage";

const base = "https://x.supabase.co/storage/v1/object/public/marca";

describe("logo no Storage", () => {
  it("reconhece só arquivos do bucket marca", () => {
    expect(logoPath(`${base}/logo-1.webp`)).toBe("logo-1.webp");
    expect(logoPath(`${base}/logo%201.webp?v=2`)).toBe("logo 1.webp");
    expect(logoPath("data:image/png;base64,AAAA")).toBeNull();
    expect(logoPath("https://x.supabase.co/storage/v1/object/public/outro/logo.webp")).toBeNull();
    expect(logoPath("")).toBeNull();
  });

  it("apaga o arquivo do bucket e ignora base64 ou vazio", async () => {
    remove.mockResolvedValue({ error: null });
    await removeLogo("data:image/png;base64,AAAA");
    await removeLogo("");
    expect(remove).not.toHaveBeenCalled();
    await removeLogo(`${base}/logo-1.webp`);
    expect(remove).toHaveBeenCalledWith(["logo-1.webp"]);
  });
});
