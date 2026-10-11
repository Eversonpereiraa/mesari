import { spawn } from "node:child_process";
import { mkdtemp, mkdir, copyFile, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = fileURLToPath(new URL("../", import.meta.url));
const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "mesari-desktop-build-"));
const releaseDirectory = path.join(projectDirectory, "release");

try {
  const builderCli = path.join(projectDirectory, "node_modules", "electron-builder", "cli.js");
  const exitCode = await new Promise((resolve, reject) => {
    const builder = spawn(
      process.execPath,
      [
        builderCli,
        "--win",
        "nsis",
        "--x64",
        "--publish",
        "never",
        `--config.directories.output=${tempDirectory}`,
      ],
      { cwd: projectDirectory, stdio: "inherit" },
    );
    builder.once("error", reject);
    builder.once("exit", (code, signal) => {
      if (signal) reject(new Error(`electron-builder foi encerrado pelo sinal ${signal}.`));
      else resolve(code);
    });
  });
  if (exitCode !== 0) throw new Error(`electron-builder terminou com código ${exitCode}.`);

  const packageJson = JSON.parse(
    await readFile(path.join(projectDirectory, "package.json"), "utf8"),
  );
  const installerName = `Mesari-Setup-${packageJson.version}.exe`;
  await mkdir(releaseDirectory, { recursive: true });
  await copyFile(
    path.join(tempDirectory, installerName),
    path.join(releaseDirectory, installerName),
  );
  console.log(`Instalador gerado: ${path.join(releaseDirectory, installerName)}`);
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}
