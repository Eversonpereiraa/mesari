import { afterEach, describe, expect, it, vi } from "vitest";

const exe = (version: string) => ({
  name: `Mesari-Setup-${version}.exe`,
  browser_download_url: `https://github.com/Eversonpereiraa/mesari/releases/download/desktop-v${version}/Mesari-Setup-${version}.exe`,
});
const extras = (version: string) => [
  { name: "latest.yml", browser_download_url: "https://x/latest.yml" },
  { name: `Mesari-Setup-${version}.exe.blockmap`, browser_download_url: "https://x/blockmap" },
];

describe("download do app desktop", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("escolhe o .exe do release mais novo, ignorando rascunho, pré-lançamento e blockmap", async () => {
    const { pickInstaller } = await import("@/lib/desktop-download");
    expect(
      pickInstaller([
        { draft: true, assets: [exe("1.3.0")] },
        { prerelease: true, assets: [exe("1.2.9-beta")] },
        { assets: [...extras("1.2.5"), exe("1.2.5")] },
        { assets: [exe("1.2.4")] },
      ]),
    ).toBe(exe("1.2.5").browser_download_url);
    expect(pickInstaller([{ assets: extras("1.0.0") }])).toBeNull();
    expect(pickInstaller({ message: "API rate limit exceeded" })).toBeNull();
  });

  it("cai na página de Releases se o GitHub não responder e tenta de novo depois", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ assets: [exe("1.2.5")] }])));
    vi.stubGlobal("fetch", fetchMock);
    const { installerUrl, DESKTOP_RELEASES_URL } = await import("@/lib/desktop-download");
    expect(await installerUrl()).toBe(DESKTOP_RELEASES_URL);
    expect(await installerUrl()).toBe(exe("1.2.5").browser_download_url);
    expect(await installerUrl()).toBe(exe("1.2.5").browser_download_url);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
