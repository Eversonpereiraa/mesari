/**
 * Desenvolvimento: sobe o Vite (com recarga automática) e abre o Electron apontando para ele.
 * Uso: npm run desktop:dev   (na raiz do projeto)
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = fileURLToPath(new URL("../", import.meta.url));
const rootDir = path.resolve(desktopDir, "..");
const port = Number(process.env.MESARI_DEV_PORT ?? 5180);
const url = `http://localhost:${port}/`;
const node = process.execPath;

if (!existsSync(path.join(desktopDir, "node_modules", "electron", "dist"))) {
  console.error("Rode antes: npm --prefix desktop install");
  process.exit(1);
}

const tsc = spawnSync(node, [path.join(desktopDir, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"], {
  cwd: desktopDir,
  stdio: "inherit",
});
if (tsc.status !== 0) process.exit(tsc.status ?? 1);

const vite = spawn(
  node,
  [path.join(rootDir, "node_modules", "vite", "bin", "vite.js"), "dev", "--port", String(port), "--strictPort"],
  { cwd: rootDir, stdio: "inherit" },
);

async function waitForVite() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Ainda subindo.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`O Vite não respondeu em ${url}`);
}

try {
  await waitForVite();
} catch (error) {
  console.error(error.message);
  vite.kill();
  process.exit(1);
}

// Terminais do VS Code exportam ELECTRON_RUN_AS_NODE=1, o que faria o Electron rodar como Node.
const env = { ...process.env, MESARI_DEV_URL: url };
delete env.ELECTRON_RUN_AS_NODE;
// Argumentos depois de "--" vão para o Electron (ex.: --remote-debugging-port=9222).
const extra = process.argv.includes("--") ? process.argv.slice(process.argv.indexOf("--") + 1) : [];
const electron = spawn(
  path.join(desktopDir, "node_modules", "electron", "dist", "electron.exe"),
  [".", ...extra],
  { cwd: desktopDir, stdio: "inherit", env },
);
electron.on("exit", (code) => {
  vite.kill();
  process.exit(code ?? 0);
});
process.on("SIGINT", () => {
  electron.kill();
  vite.kill();
});
