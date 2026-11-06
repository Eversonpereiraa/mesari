import { useCallback, useEffect, useState } from "react";
import { Bluetooth, Cable, Network, RefreshCw } from "lucide-react";
import { Btn, Field } from "@/components/ui-kit";
import { AppSelect } from "@/components/app-select";
import {
  BAUD_RATES,
  BluetoothWebTransport,
  getTransport,
  type BaudRate,
  type PrinterConfig,
} from "@/lib/printing";

type Group = NonNullable<PrinterConfig["desktopGroup"]>;
type Props = {
  config: PrinterConfig;
  update: (patch: Partial<PrinterConfig>) => void;
  busy: boolean;
  run: (action: () => Promise<string | void>) => Promise<void>;
};

const GROUPS: { id: Group; label: string; Icon: typeof Bluetooth }[] = [
  { id: "bluetooth", label: "Bluetooth", Icon: Bluetooth },
  { id: "rede", label: "Rede", Icon: Network },
  { id: "usb", label: "Cabo USB", Icon: Cable },
];

function groupOf(config: PrinterConfig): Group {
  if (config.desktopGroup) return config.desktopGroup;
  if (config.connection === "rede") return "rede";
  if (config.connection === "bluetooth") return "bluetooth";
  return "usb";
}

/** Conexão da impressora no app desktop: Bluetooth, Rede ou Cabo USB, tudo nativo. */
export function DesktopPrinterConnection({ config, update, busy, run }: Props) {
  const api = typeof window === "undefined" ? undefined : window.mesariDesktop?.printer;
  const group = groupOf(config);
  const [ports, setPorts] = useState<MesariDesktopSerialPort[]>([]);
  const [printers, setPrinters] = useState<{ nome: string; padrao: boolean }[]>([]);
  const [ipDraft, setIpDraft] = useState(config.ip);
  const [portDraft, setPortDraft] = useState(String(config.port));
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      const [serial, windows] = await Promise.all([api.listSerial(), api.listWindows()]);
      setPorts(serial);
      setPrinters(windows);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh().catch((cause: unknown) => console.error("[impressão] listar", cause));
  }, [refresh]);

  const bluetoothPorts = ports.filter((port) => port.bluetooth);
  const cablePorts = ports.filter((port) => !port.bluetooth);
  const saveNetwork = () => {
    const port = Number(portDraft);
    update({
      connection: "rede",
      desktopGroup: "rede",
      ip: ipDraft.trim(),
      port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 9100,
    });
  };
  const baudSelect = (
    <Field label="Velocidade (baud)">
      <AppSelect
        className="field"
        ariaLabel="Velocidade (baud)"
        value={String(config.comBaudRate)}
        onValueChange={(value) => update({ comBaudRate: Number(value) as BaudRate })}
        options={BAUD_RATES.map((baud) => ({ value: String(baud), label: String(baud) }))}
      />
    </Field>
  );

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Forma de conexão" className="grid grid-cols-3 gap-2">
        {GROUPS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={group === id}
            disabled={busy}
            onClick={() =>
              update(
                id === "rede"
                  ? { desktopGroup: id, connection: "rede" }
                  : id === "usb"
                    ? {
                        desktopGroup: id,
                        connection: config.connection === "serial" ? "serial" : "windows",
                      }
                    : { desktopGroup: id },
              )
            }
            className={`flex flex-col items-center gap-1 rounded-md border px-3 py-3 text-sm ${group === id ? "border-primary bg-accent font-semibold text-ink" : "bg-card hover:bg-muted"}`}
          >
            <Icon className="h-5 w-5" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {group === "bluetooth" && (
        <div className="space-y-3">
          <p className="rounded-md bg-accent p-2 text-sm text-ink">
            Pareie a impressora em Configurações do Windows &gt; Bluetooth antes.
          </p>
          <Field label="Impressora Bluetooth pareada (porta COM)">
            <AppSelect
              className="field"
              ariaLabel="Impressora Bluetooth pareada"
              value={config.connection === "serial" ? config.comPort : ""}
              placeholder={
                bluetoothPorts.length
                  ? "Escolha a impressora"
                  : "Nenhuma porta Bluetooth encontrada"
              }
              onValueChange={(value) =>
                update({
                  connection: "serial",
                  desktopGroup: "bluetooth",
                  comPort: value,
                  deviceName: bluetoothPorts.find((port) => port.path === value)?.nome ?? value,
                })
              }
              options={bluetoothPorts.map((port) => ({ value: port.path, label: port.nome }))}
            />
          </Field>
          {config.connection === "serial" && baudSelect}
          <div className="flex flex-wrap gap-2">
            <Btn
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  update({ connection: "bluetooth", desktopGroup: "bluetooth" });
                  const transport = getTransport();
                  if (transport instanceof BluetoothWebTransport) await transport.choose();
                  return "Impressora Bluetooth (BLE) conectada.";
                })
              }
            >
              <Bluetooth className="h-4 w-4" aria-hidden /> Procurar BLE
            </Btn>
            <Btn variant="ghost" disabled={loading} onClick={() => void refresh()}>
              <RefreshCw className="h-4 w-4" aria-hidden /> Atualizar lista
            </Btn>
          </div>
          {config.connection === "bluetooth" && (
            <p className="text-xs text-muted-foreground">
              Usando Bluetooth BLE{config.deviceName ? `: ${config.deviceName}` : ""}.
            </p>
          )}
        </div>
      )}

      {group === "rede" && (
        <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
          <Field label="IP da impressora" hint="Veja na página de autoteste da impressora.">
            <input
              className="field"
              inputMode="decimal"
              placeholder="192.168.0.50"
              value={ipDraft}
              onChange={(event) => setIpDraft(event.target.value)}
              onBlur={saveNetwork}
            />
          </Field>
          <Field label="Porta">
            <input
              className="field"
              inputMode="numeric"
              value={portDraft}
              onChange={(event) => setPortDraft(event.target.value)}
              onBlur={saveNetwork}
            />
          </Field>
        </div>
      )}

      {group === "usb" && (
        <div className="space-y-3">
          <Field
            label="Impressora instalada no Windows"
            hint="Os comandos vão direto para a impressora (modo RAW)."
          >
            <AppSelect
              className="field"
              ariaLabel="Impressora instalada no Windows"
              value={config.connection === "windows" ? config.windowsPrinter : ""}
              placeholder={
                printers.length ? "Escolha a impressora" : "Nenhuma impressora encontrada"
              }
              onValueChange={(value) =>
                update({ connection: "windows", desktopGroup: "usb", windowsPrinter: value })
              }
              options={printers.map((printer) => ({
                value: printer.nome,
                label: `${printer.nome}${printer.padrao ? " (padrão)" : ""}`,
              }))}
            />
          </Field>
          <Field label="Ou porta COM (cabo USB em modo serial)">
            <AppSelect
              className="field"
              ariaLabel="Porta COM"
              value={config.connection === "serial" ? config.comPort : ""}
              placeholder={cablePorts.length ? "Escolha a porta" : "Nenhuma porta COM encontrada"}
              onValueChange={(value) =>
                update({
                  connection: "serial",
                  desktopGroup: "usb",
                  comPort: value,
                  deviceName: cablePorts.find((port) => port.path === value)?.nome ?? value,
                })
              }
              options={cablePorts.map((port) => ({ value: port.path, label: port.nome }))}
            />
          </Field>
          {config.connection === "serial" && baudSelect}
          <Btn variant="ghost" disabled={loading} onClick={() => void refresh()}>
            <RefreshCw className="h-4 w-4" aria-hidden /> Atualizar lista
          </Btn>
        </div>
      )}
      <DesktopBlePicker />
    </div>
  );
}

/** Lista de dispositivos BLE encontrados (o Electron não tem seletor próprio). */
export function DesktopBlePicker() {
  const [devices, setDevices] = useState<{ id: string; nome: string }[] | null>(null);
  useEffect(() => {
    const ble = window.mesariDesktop?.ble;
    if (!ble) return;
    return ble.onDevices((list) => setDevices(list));
  }, []);
  if (!devices) return null;
  const choose = (id: string | null) => {
    void window.mesariDesktop?.ble?.select(id);
    setDevices(null);
  };
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Escolher impressora Bluetooth"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-sm rounded-lg border bg-card p-4 shadow-xl">
        <h2 className="font-semibold text-ink">Escolher impressora Bluetooth (BLE)</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Procurando aparelhos por perto... A lista atualiza sozinha.
        </p>
        <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto">
          {devices.length === 0 && (
            <li className="text-sm text-muted-foreground">Nenhum aparelho encontrado ainda.</li>
          )}
          {devices.map((device) => (
            <li key={device.id}>
              <button
                type="button"
                className="w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => choose(device.id)}
              >
                {device.nome || "Aparelho sem nome"}
                <span className="block text-xs text-muted-foreground">{device.id}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-end">
          <Btn variant="outline" onClick={() => choose(null)}>
            Cancelar
          </Btn>
        </div>
      </div>
    </div>
  );
}
