#!/usr/bin/env node
/**
 * Mesari Print Agent
 *
 * Servidor local (só 127.0.0.1) que recebe bytes ESC/POS do Mesari e os entrega à impressora:
 *   - rede:    socket TCP direto em IP:porta (9100)
 *   - windows: impressora instalada no Windows, em modo RAW (winspool)
 *   - serial:  porta COM com baud rate configurável
 *
 * Sem dependências: usa só módulos do Node e o PowerShell que já vem no Windows.
 */
"use strict";

const http = require("node:http");
const net = require("node:net");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const VERSION = "1.0.0";
const IS_WINDOWS = process.platform === "win32";
const BAUD_RATES = [9600, 19200, 38400, 57600, 115200];
const MAX_BODY = 2 * 1024 * 1024;

// ------------------------------------------------------------------------------------------------
// Configuração: config.json ao lado do agente (ou do .exe) e variáveis de ambiente.

function loadConfig() {
  const baseDir = process.pkg ? path.dirname(process.execPath) : __dirname;
  const file = path.join(baseDir, "config.json");
  let fromFile = {};
  try {
    if (fs.existsSync(file)) fromFile = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`[agente] config.json inválido, usando o padrão: ${error.message}`);
  }
  const extraOrigins = (process.env.MESARI_ORIGENS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    porta: Number(process.env.MESARI_AGENTE_PORTA || fromFile.porta || 9123),
    origens: [
      "https://design-driven-orders.vercel.app",
      ...(Array.isArray(fromFile.origens) ? fromFile.origens : []),
      ...extraOrigins,
    ].map((origin) => String(origin).replace(/\/+$/, "")),
  };
}

const config = loadConfig();
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

function originAllowed(origin) {
  return LOCAL_ORIGIN.test(origin) || config.origens.includes(origin.replace(/\/+$/, ""));
}

// ------------------------------------------------------------------------------------------------
// Erros: "mensagem" é para o usuário; "detalhe" é técnico e só aparece no console do navegador.

class AgentError extends Error {
  constructor(status, mensagem, detalhe) {
    super(mensagem);
    this.status = status;
    this.detalhe = detalhe;
  }
}

const log = (...args) => console.log(`[${new Date().toLocaleString("pt-BR")}]`, ...args);

// ------------------------------------------------------------------------------------------------
// Validação

function validateTarget(body) {
  const tipo = body && body.tipo;
  if (tipo === "rede") {
    const ip = String(body.ip || "").trim();
    const porta = Number(body.porta || 9100);
    if (!/^[a-z0-9.\-:]{1,253}$/i.test(ip)) throw new AgentError(400, "IP da impressora inválido.");
    if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
      throw new AgentError(400, "Porta da impressora inválida.");
    }
    return { tipo, ip, porta };
  }
  if (tipo === "windows") {
    const impressora = String(body.impressora || "").trim();
    if (!impressora || impressora.length > 256)
      throw new AgentError(400, "Escolha a impressora do Windows.");
    if (!IS_WINDOWS) throw new AgentError(400, "Impressora do Windows só funciona no Windows.");
    return { tipo, impressora };
  }
  if (tipo === "serial") {
    const com = String(body.com || "")
      .trim()
      .toUpperCase();
    const baud = Number(body.baud || 115200);
    if (!/^COM\d{1,3}$/.test(com)) throw new AgentError(400, "Porta COM inválida.");
    if (!BAUD_RATES.includes(baud)) throw new AgentError(400, "Velocidade (baud) inválida.");
    if (!IS_WINDOWS) throw new AgentError(400, "Porta COM só funciona no Windows.");
    return { tipo, com, baud };
  }
  throw new AgentError(400, "Tipo de conexão inválido.");
}

function decodeData(dados) {
  if (typeof dados !== "string" || !dados) throw new AgentError(400, "Nada para imprimir.");
  if (!/^[A-Za-z0-9+/=\s]+$/.test(dados))
    throw new AgentError(400, "Dados de impressão inválidos.");
  const buffer = Buffer.from(dados, "base64");
  if (!buffer.length) throw new AgentError(400, "Nada para imprimir.");
  return buffer;
}

// ------------------------------------------------------------------------------------------------
// Rede (TCP 9100)

function sendTcp(ip, porta, data) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(total);
      socket.destroy();
      if (error) {
        reject(
          new AgentError(
            502,
            `Não foi possível conectar à impressora em ${ip}:${porta}. Verifique se ela está ligada e na mesma rede.`,
            `${error.code || ""} ${error.message}`.trim(),
          ),
        );
      } else resolve();
    };
    const socket = net.createConnection({ host: ip, port: porta });
    socket.setTimeout(8000, () =>
      finish(Object.assign(new Error("tempo esgotado"), { code: "ETIMEDOUT" })),
    );
    const total = setTimeout(
      () => finish(Object.assign(new Error("tempo total esgotado"), { code: "ETIMEDOUT" })),
      30000,
    );
    socket.on("error", finish);
    socket.on("connect", () => {
      if (!data) return finish();
      socket.end(data, () => {
        // Dá tempo para a impressora ler o buffer antes de fechar.
        setTimeout(() => finish(), 200);
      });
    });
  });
}

// ------------------------------------------------------------------------------------------------
// PowerShell (Windows)

function runPowerShell(script, env = {}, timeoutMs = 30000) {
  // Erros saem como texto UTF-8 simples no stderr (sem CLIXML) para o agente entender.
  const wrapped = [
    "$ProgressPreference = 'SilentlyContinue'",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "try {",
    script,
    "} catch {",
    "  $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }",
    "  $code = if ($e -is [System.ComponentModel.Win32Exception]) { \" [win32 $($e.NativeErrorCode)]\" } else { '' }",
    "  [Console]::Error.WriteLine($e.Message + $code); exit 1",
    "}",
  ].join("\n");
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(wrapped, "utf16le").toString("base64");
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { env: { ...process.env, ...env }, windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("PowerShell não respondeu a tempo"));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `PowerShell saiu com código ${code}`));
    });
  });
}

function asArray(value) {
  if (value === null || value === undefined || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

async function listPrinters() {
  if (!IS_WINDOWS) return [];
  const output = await runPowerShell(
    "Get-CimInstance -ClassName Win32_Printer | Select-Object Name,Default,PortName,DriverName | ConvertTo-Json -Compress",
  );
  return asArray(output ? JSON.parse(output) : []).map((item) => ({
    nome: String(item.Name || ""),
    padrao: Boolean(item.Default),
    porta: String(item.PortName || ""),
    driver: String(item.DriverName || ""),
  }));
}

async function listSerialPorts() {
  if (!IS_WINDOWS) return [];
  const output = await runPowerShell(
    "[System.IO.Ports.SerialPort]::GetPortNames() | Sort-Object -Unique | ConvertTo-Json -Compress",
  );
  return asArray(output ? JSON.parse(output) : [])
    .map(String)
    .sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")));
}

const RAW_PRINTER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
if (-not ('MesariRawPrinter' -as [type])) {
Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class MesariRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern int StartDocPrinter(IntPtr handle, int level, [In] DOCINFO info);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool WritePrinter(IntPtr handle, byte[] data, int count, out int written);

  public static void Check(string printer) {
    IntPtr handle;
    if (!OpenPrinter(printer, out handle, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
    ClosePrinter(handle);
  }

  public static void Send(string printer, byte[] data) {
    IntPtr handle;
    if (!OpenPrinter(printer, out handle, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
    try {
      DOCINFO info = new DOCINFO();
      info.pDocName = "Mesari";
      info.pDataType = "RAW";
      if (StartDocPrinter(handle, 1, info) == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
      try {
        if (!StartPagePrinter(handle)) throw new Win32Exception(Marshal.GetLastWin32Error());
        int written;
        bool ok = WritePrinter(handle, data, data.Length, out written);
        int error = Marshal.GetLastWin32Error();
        EndPagePrinter(handle);
        if (!ok || written != data.Length) throw new Win32Exception(error);
      } finally {
        EndDocPrinter(handle);
      }
    } finally {
      ClosePrinter(handle);
    }
  }
}
"@
}
if ($env:MESARI_FILE) {
  [MesariRawPrinter]::Send($env:MESARI_PRINTER, [System.IO.File]::ReadAllBytes($env:MESARI_FILE))
} else {
  [MesariRawPrinter]::Check($env:MESARI_PRINTER)
}
`;

const SERIAL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$port = New-Object System.IO.Ports.SerialPort $env:MESARI_COM, ([int]$env:MESARI_BAUD), ([System.IO.Ports.Parity]::None), 8, ([System.IO.Ports.StopBits]::One)
$port.Handshake = [System.IO.Ports.Handshake]::None
$port.WriteTimeout = 15000
$port.Open()
try {
  if ($env:MESARI_FILE) {
    $bytes = [System.IO.File]::ReadAllBytes($env:MESARI_FILE)
    $port.Write($bytes, 0, $bytes.Length)
    $limit = [DateTime]::Now.AddSeconds(15)
    while ($port.BytesToWrite -gt 0 -and [DateTime]::Now -lt $limit) { Start-Sleep -Milliseconds 50 }
    Start-Sleep -Milliseconds 200
  }
} finally {
  $port.Close()
}
`;

async function withTempFile(data, work) {
  const file = path.join(os.tmpdir(), `mesari-${crypto.randomUUID()}.bin`);
  fs.writeFileSync(file, data);
  try {
    return await work(file);
  } finally {
    fs.rm(file, { force: true }, () => undefined);
  }
}

async function sendWindows(impressora, data) {
  try {
    if (!data) {
      await runPowerShell(RAW_PRINTER_SCRIPT, { MESARI_PRINTER: impressora, MESARI_FILE: "" });
      return;
    }
    await withTempFile(data, (file) =>
      runPowerShell(RAW_PRINTER_SCRIPT, { MESARI_PRINTER: impressora, MESARI_FILE: file }),
    );
  } catch (error) {
    const detail = error.message || String(error);
    const notFound = /1801|nome da impressora|printer name is invalid/i.test(detail);
    throw new AgentError(
      502,
      notFound
        ? `A impressora "${impressora}" não foi encontrada no Windows.`
        : `O Windows não conseguiu enviar para a impressora "${impressora}". Verifique se ela está ligada.`,
      detail,
    );
  }
}

async function sendSerial(com, baud, data) {
  try {
    const env = { MESARI_COM: com, MESARI_BAUD: String(baud), MESARI_FILE: "" };
    if (!data) await runPowerShell(SERIAL_SCRIPT, env);
    else
      await withTempFile(data, (file) =>
        runPowerShell(SERIAL_SCRIPT, { ...env, MESARI_FILE: file }),
      );
  } catch (error) {
    const detail = error.message || String(error);
    const busy = /acesso|access|denied|negado/i.test(detail);
    const missing = /não existe|does not exist|not exist|FileNotFound/i.test(detail);
    throw new AgentError(
      502,
      busy
        ? `A porta ${com} está em uso por outro programa.`
        : missing
          ? `A porta ${com} não existe neste computador.`
          : `Não foi possível escrever na porta ${com}. Verifique o cabo e a impressora.`,
      detail,
    );
  }
}

function deliver(target, data) {
  if (target.tipo === "rede") return sendTcp(target.ip, target.porta, data);
  if (target.tipo === "windows") return sendWindows(target.impressora, data);
  return sendSerial(target.com, target.baud, data);
}

// Um trabalho por vez: impressoras não lidam bem com duas conexões ao mesmo tempo.
let queue = Promise.resolve();
function enqueue(job) {
  const result = queue.then(job, job);
  queue = result.catch(() => undefined);
  return result;
}

// ------------------------------------------------------------------------------------------------
// HTTP

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new AgentError(413, "Impressão grande demais."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new AgentError(400, "Pedido inválido."));
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  // Protege contra DNS rebinding: só aceita chamadas endereçadas ao próprio computador.
  const host = String(req.headers.host || "")
    .replace(/:\d+$/, "")
    .toLowerCase();
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) {
    send(res, 403, { ok: false, mensagem: "Acesso negado." });
    return;
  }
  const origin = req.headers.origin;
  if (origin) {
    if (!originAllowed(origin)) {
      log(`Bloqueado: origem ${origin}`);
      send(res, 403, { ok: false, mensagem: "Este site não tem permissão para usar o agente." });
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      send(res, 200, { ok: true, versao: VERSION, plataforma: process.platform });
      return;
    }
    if (req.method === "GET" && url.pathname === "/printers") {
      send(res, 200, { ok: true, impressoras: await listPrinters() });
      return;
    }
    if (req.method === "GET" && url.pathname === "/serial-ports") {
      send(res, 200, { ok: true, portas: await listSerialPorts() });
      return;
    }
    if (req.method === "POST" && url.pathname === "/check") {
      const target = validateTarget(await readJson(req));
      await enqueue(() => deliver(target, null));
      send(res, 200, { ok: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/print") {
      const body = await readJson(req);
      const target = validateTarget(body);
      const data = decodeData(body.dados);
      const started = Date.now();
      await enqueue(() => deliver(target, data));
      log(`Impresso via ${target.tipo} (${data.length} bytes, ${Date.now() - started} ms)`);
      send(res, 200, { ok: true, bytes: data.length });
      return;
    }
    send(res, 404, { ok: false, mensagem: "Endereço não encontrado." });
  } catch (error) {
    const status = error instanceof AgentError ? error.status : 500;
    const mensagem =
      error instanceof AgentError ? error.message : "O agente de impressão encontrou um erro.";
    const detalhe = error instanceof AgentError ? error.detalhe : error && error.message;
    log(`Erro ${status}: ${mensagem}${detalhe ? ` | ${detalhe}` : ""}`);
    send(res, status, { ok: false, mensagem, ...(detalhe ? { detalhe } : {}) });
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`A porta ${config.porta} já está em uso. O agente já está aberto?`);
  } else console.error(error);
  process.exitCode = 1;
});

server.listen(config.porta, "127.0.0.1", () => {
  console.log(`Mesari Print Agent ${VERSION}`);
  console.log(`Rodando em http://localhost:${config.porta}`);
  console.log(`Sites permitidos: ${config.origens.join(", ")} e localhost`);
  console.log("Deixe esta janela aberta para imprimir.");
});

module.exports = { server, validateTarget, originAllowed };
