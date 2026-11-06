/**
 * Gera o Mesari Desktop:
 *   1. build do Vite em modo SPA (MESARI_DESKTOP=1) → dist/client
 *   2. copia para desktop/app (o que o Electron carrega em app://mesari/)
 *   3. compila main/preload (tsc) → desktop/out
 *   4. confere o binário do serialport no Electron (roda o electron-rebuild se precisar)
 *   5. electron-builder → desktop/release/Mesari-Setup-x.y.z.exe
 *
 * Uso: node desktop/scripts/build.mjs [--publish]
 *   --publish  publica no GitHub Releases (precisa de GH_TOKEN).
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = fileURLToPath(new URL("../", import.meta.url));
const rootDir = path.resolve(desktopDir, "..");
const publish = process.argv.includes("--publish");

function step(title, command, args, options = {}) {
  console.log(`\n▶ ${title}`);
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    if (options.optional) return false;
    console.error(`✖ Falhou: ${title}`);
    process.exit(result.status ?? 1);
  }
  return true;
}

const node = process.execPath;
const npmCli = path.join(path.dirname(node), "node_modules", "npm", "bin", "npm-cli.js");

if (!existsSync(path.join(desktopDir, "node_modules", "electron"))) {
  step("Instalando dependências do desktop", node, [npmCli, "ci", "--no-audit", "--no-fund"], {
    cwd: desktopDir,
  });
  step("Baixando o Electron", node, [path.join(desktopDir, "node_modules", "electron", "install.js")], {
    cwd: desktopDir,
  });
}

rmSync(path.join(rootDir, "dist"), { recursive: true, force: true });
step("Build do Vite (SPA para o desktop)", node, [path.join(rootDir, "node_modules", "vite", "bin", "vite.js"), "build"], {
  cwd: rootDir,
  env: { ...process.env, MESARI_DESKTOP: "1" },
});

const appDir = path.join(desktopDir, "app");
rmSync(appDir, { recursive: true, force: true });
cpSync(path.join(rootDir, "dist", "client"), appDir, { recursive: true });
if (!existsSync(path.join(appDir, "index.html"))) {
  console.error("✖ O build do Vite não gerou dist/client/index.html.");
  process.exit(1);
}
console.log(`\n✔ Interface copiada para ${appDir}`);

rmSync(path.join(desktopDir, "out"), { recursive: true, force: true });
step("Compilando main e preload", node, [path.join(desktopDir, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"], {
  cwd: desktopDir,
});

// O serialport traz binário N-API pronto, que funciona no Electron sem compilar. Só roda o
// electron-rebuild (precisa do Visual Studio Build Tools) se esse binário não carregar.
const electronExe = path.join(desktopDir, "node_modules", "electron", "dist", "electron.exe");
const serialOk = step(
  "Conferindo o serialport dentro do Electron",
  electronExe,
  ["-e", "require('serialport').SerialPort.list().then(() => console.log('serialport OK'))"],
  { cwd: desktopDir, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, optional: true },
);
if (!serialOk) {
  step("electron-rebuild do serialport", node, [path.join(desktopDir, "node_modules", "@electron", "rebuild", "lib", "cli.js"), "-f", "-o", "@serialport/bindings-cpp"], {
    cwd: desktopDir,
  });
}

step(
  publish ? "Gerando e publicando o instalador" : "Gerando o instalador",
  node,
  [
    path.join(desktopDir, "node_modules", "electron-builder", "cli.js"),
    "--config",
    "electron-builder.config.cjs",
    "--win",
    "nsis",
    "--x64",
    "--publish",
    publish ? "always" : "never",
  ],
  { cwd: desktopDir },
);

const { version } = JSON.parse(
  (await import("node:fs")).readFileSync(path.join(desktopDir, "package.json"), "utf8"),
);
console.log(`\n✔ Instalador: ${path.join(desktopDir, "release", `Mesari-Setup-${version}.exe`)}`);
