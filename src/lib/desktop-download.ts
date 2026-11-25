/**
 * Link direto do instalador do app Mesari para Windows (.exe da versão mais nova publicada nos
 * Releases do GitHub). O nome do arquivo muda a cada versão (Mesari-Setup-1.2.5.exe), então a
 * versão é consultada na API pública do GitHub. Se a consulta falhar, cai na página de Releases.
 */
export const DESKTOP_RELEASES_URL = "https://github.com/Eversonpereiraa/mesari/releases/latest";
const RELEASES_API = "https://api.github.com/repos/Eversonpereiraa/mesari/releases?per_page=10";

type Asset = { name?: unknown; browser_download_url?: unknown };
type Release = { draft?: unknown; prerelease?: unknown; assets?: unknown };

let cached: Promise<string> | null = null;

/** Primeiro release publicado (mais novo) que tenha o instalador .exe. */
export function pickInstaller(releases: unknown): string | null {
  if (!Array.isArray(releases)) return null;
  for (const release of releases as Release[]) {
    if (release.draft === true || release.prerelease === true) continue;
    const assets = Array.isArray(release.assets) ? (release.assets as Asset[]) : [];
    const exe = assets.find(
      (asset) => typeof asset.name === "string" && /^Mesari-Setup.*\.exe$/i.test(asset.name),
    );
    if (exe && typeof exe.browser_download_url === "string") return exe.browser_download_url;
  }
  return null;
}

/** URL do .exe mais recente (consulta uma vez por sessão). */
export function installerUrl(): Promise<string> {
  cached ??= fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => pickInstaller(data) ?? DESKTOP_RELEASES_URL)
    .catch(() => DESKTOP_RELEASES_URL)
    .then((url) => {
      // Falhou: tenta de novo no próximo clique em vez de guardar a página de Releases.
      if (url === DESKTOP_RELEASES_URL) cached = null;
      return url;
    });
  return cached;
}

/** Começa o download do instalador (ou abre os Releases se o GitHub não responder). */
export async function downloadInstaller() {
  const url = await installerUrl();
  if (url === DESKTOP_RELEASES_URL) window.open(url, "_blank", "noopener");
  else window.location.assign(url);
}
