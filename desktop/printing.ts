/**
 * Impressão nativa do Mesari Desktop (processo main). Substitui o agente de impressão:
 *   - rede:    socket TCP em IP:porta (9100)
 *   - windows: RAW para a impressora instalada no Windows (winspool, via PowerShell)
 *   - serial:  porta COM (cabo USB em modo COM e Bluetooth clássico pareado no Windows)
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { WebContents } from "electron";

export type PrintOutcome = { ok: true } | { ok: false; mensagem: string; detalhe?: string };
export type SerialPortInfo = {
  path: string;
  nome: string;
  fabricante: string;
  bluetooth: boolean;
};
export type WindowsPrinter = { nome: string; padrao: boolean };

export const BAUD_RATES = [9600, 19200, 38400, 57600, 115200];
const CONNECT_TIMEOUT_MS = 8000;
const MAX_BYTES = 2 * 1024 * 1024;

export class PrintError extends Error {
  constructor(
    message: string,
    readonly detalhe?: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------------------------
// Validação do que chega do renderer

export function toBuffer(value: unknown): Buffer | null {
  if (value === null || value === undefined) return null;
  if (!(value instanceof Uint8Array)) throw new PrintError("Dados de impressão inválidos.");
  if (value.byteLength === 0) throw new PrintError("Nada para imprimir.");
  if (value.byteLength > MAX_BYTES) throw new PrintError("Impressão grande demais.");
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

export function networkTarget(value: unknown) {
  const target = (value ?? {}) as { ip?: unknown; porta?: unknown };
  const ip = String(target.ip ?? "").trim();
  const porta = Number(target.porta ?? 9100);
  if (!/^[a-z0-9.\-:]{1,253}$/i.test(ip)) throw new PrintError("IP da impressora inválido.");
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
    throw new PrintError("Porta da impressora inválida.");
  }
  return { ip, porta };
}

export function windowsTarget(value: unknown) {
  const name = String((value as { impressora?: unknown })?.impressora ?? "").trim();
  if (!name || name.length > 256) throw new PrintError("Escolha a impressora do Windows.");
  return name;
}

export function serialTarget(value: unknown) {
  const target = (value ?? {}) as { com?: unknown; baud?: unknown };
  const com = String(target.com ?? "").trim().toUpperCase();
  const baud = Number(target.baud ?? 115200);
  if (!/^COM\d{1,3}$/.test(com)) throw new PrintError("Porta COM inválida.");
  if (!BAUD_RATES.includes(baud)) throw new PrintError("Velocidade (baud) inválida.");
  return { com, baud };
}

// ---------------------------------------------------------------------------------------------
// Rede (TCP 9100)

export function sendNetwork(ip: string, porta: number, data: Buffer | null) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const socket = net.createConnection({ host: ip, port: porta });
    const finish = (error?: Error & { code?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(total);
      socket.destroy();
      if (!error) resolve();
      else {
        reject(
          new PrintError(
            `Não foi possível conectar à impressora em ${ip}:${porta}. Verifique se ela está ligada e na mesma rede.`,
            `${error.code ?? ""} ${error.message}`.trim(),
          ),
        );
      }
    };
    socket.setTimeout(CONNECT_TIMEOUT_MS, () =>
      finish(Object.assign(new Error("tempo esgotado"), { code: "ETIMEDOUT" })),
    );
    const total = setTimeout(
      () => finish(Object.assign(new Error("tempo total esgotado"), { code: "ETIMEDOUT" })),
      30000,
    );
    socket.on("error", finish);
    socket.on("connect", () => {
      if (!data) {
        finish();
        return;
      }
      socket.end(data, () => setTimeout(() => finish(), 200));
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Impressora do Windows (RAW)

function runPowerShell(script: string, env: Record<string, string>, timeoutMs = 30000) {
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
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        Buffer.from(wrapped, "utf16le").toString("base64"),
      ],
      { env: { ...process.env, ...env }, windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("PowerShell não respondeu a tempo"));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
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

export async function sendWindows(printer: string, data: Buffer | null) {
  if (process.platform !== "win32") {
    throw new PrintError("Impressora do Windows só funciona no Windows.");
  }
  const file = data ? path.join(os.tmpdir(), `mesari-${crypto.randomUUID()}.bin`) : "";
  try {
    if (data) fs.writeFileSync(file, data);
    await runPowerShell(RAW_PRINTER_SCRIPT, { MESARI_PRINTER: printer, MESARI_FILE: file });
  } catch (cause) {
    const detalhe = cause instanceof Error ? cause.message : String(cause);
    const notFound = /1801|nome da impressora|printer name is invalid/i.test(detalhe);
    throw new PrintError(
      notFound
        ? `A impressora "${printer}" não foi encontrada no Windows.`
        : `O Windows não conseguiu enviar para a impressora "${printer}". Verifique se ela está ligada.`,
      detalhe,
    );
  } finally {
    if (file) fs.rm(file, { force: true }, () => undefined);
  }
}

export async function listWindowsPrinters(contents: WebContents): Promise<WindowsPrinter[]> {
  const printers = await contents.getPrintersAsync();
  return printers.map((printer) => {
    const isDefault =
      Reflect.get(printer, "isDefault") === true ||
      Reflect.get(printer.options ?? {}, "isDefault") === "true";
    return { nome: printer.name, padrao: isDefault };
  });
}

// ---------------------------------------------------------------------------------------------
// Porta COM (serialport)

type SerialPortModule = typeof import("serialport");
let serialModule: SerialPortModule | null = null;

function serialport(): SerialPortModule {
  // Carregado só quando usado: se o binário nativo falhar, o resto do app continua.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  serialModule ??= require("serialport") as SerialPortModule;
  return serialModule;
}

export async function listSerialPorts(): Promise<SerialPortInfo[]> {
  const ports = await serialport().SerialPort.list();
  return ports
    .map((port) => {
      const friendly = String(Reflect.get(port, "friendlyName") ?? "");
      const pnp = String(port.pnpId ?? "");
      return {
        path: port.path,
        nome: friendly || `${port.manufacturer ?? "Porta serial"} (${port.path})`,
        fabricante: port.manufacturer ?? "",
        bluetooth: /bluetooth/i.test(friendly) || /^BTHENUM/i.test(pnp),
      };
    })
    .sort((a, b) => Number(a.path.replace(/\D/g, "")) - Number(b.path.replace(/\D/g, "")));
}

export async function sendSerial(com: string, baud: number, data: Buffer | null) {
  const { SerialPort } = serialport();
  const port = new SerialPort({ path: com, baudRate: baud, autoOpen: false });
  const step = <T>(work: (done: (error?: Error | null, value?: T) => void) => void, ms: number) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("tempo esgotado")), ms);
      work((error, value) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value as T);
      });
    });
  try {
    await step<void>((done) => port.open((error) => done(error)), CONNECT_TIMEOUT_MS);
    if (data) {
      await step<void>((done) => port.write(data, (error) => done(error)), 20000);
      await step<void>((done) => port.drain((error) => done(error)), 20000);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  } catch (cause) {
    const detalhe = cause instanceof Error ? cause.message : String(cause);
    const busy = /access denied|acesso negado|in use|busy/i.test(detalhe);
    const missing = /not found|cannot find|file not found|não foi possível encontrar|2\)/i.test(detalhe);
    throw new PrintError(
      busy
        ? `A porta ${com} está em uso por outro programa.`
        : missing
          ? `A porta ${com} não existe neste computador. Se for Bluetooth, pareie a impressora de novo.`
          : `Não foi possível usar a porta ${com}. Verifique o cabo ou o pareamento Bluetooth.`,
      detalhe,
    );
  } finally {
    if (port.isOpen) await new Promise<void>((resolve) => port.close(() => resolve()));
  }
}

// ---------------------------------------------------------------------------------------------

let queue: Promise<unknown> = Promise.resolve();

/** Um trabalho por vez e resposta sempre no formato { ok, mensagem, detalhe }. */
export function run(job: () => Promise<void>, log: (message: string, error?: unknown) => void) {
  const result = queue.then(job, job).then(
    (): PrintOutcome => ({ ok: true }),
    (cause: unknown): PrintOutcome => {
      log("Erro de impressão", cause);
      if (cause instanceof PrintError) {
        return { ok: false, mensagem: cause.message, ...(cause.detalhe ? { detalhe: cause.detalhe } : {}) };
      }
      return {
        ok: false,
        mensagem: "Não foi possível imprimir. Verifique se a impressora está ligada e conectada.",
        detalhe: cause instanceof Error ? cause.message : String(cause),
      };
    },
  );
  queue = result;
  return result;
}
