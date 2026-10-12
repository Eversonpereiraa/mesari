import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { format, subDays, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type DateShortcut = "today" | "yesterday" | "last7days" | "thisMonth";

export function saoPauloDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dateFromKey(value: string) {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function keyFromDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function labelFromKey(value: string) {
  const date = dateFromKey(value);
  return date ? format(date, "dd/MM/yyyy", { locale: ptBR }) : "";
}

export function reportDateRange(startValue: string, endValue: string) {
  const [year, month, day] = startValue.split("-").map(Number);
  const start = new Date(`${startValue}T00:00:00-03:00`);
  const endKey = endValue || startValue;
  const end = new Date(`${endKey}T23:59:59.999-03:00`);
  if (!year || !month || !day || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("A data selecionada para o relatório é inválida.");
  }
  return { start, end };
}

export function ReportDatePicker({
  startValue,
  endValue = "",
  onChange,
  onShortcut,
  className,
}: {
  startValue: string;
  endValue?: string;
  onChange: (start: string, end: string) => void;
  onShortcut: (shortcut: DateShortcut) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(
    () => dateFromKey(startValue) ?? dateFromKey(saoPauloDateKey())!,
  );
  const [pendingRange, setPendingRange] = useState<DateRange | undefined>();
  const today = dateFromKey(saoPauloDateKey())!;
  const selectedRange: DateRange | undefined = startValue
    ? { from: dateFromKey(startValue), to: endValue ? dateFromKey(endValue) : undefined }
    : undefined;
  const label = endValue
    ? `${labelFromKey(startValue)} – ${labelFromKey(endValue)}`
    : startValue
      ? labelFromKey(startValue)
      : "Selecionar data";

  const chooseShortcut = (shortcut: DateShortcut) => {
    onShortcut(shortcut);
    setPendingRange(undefined);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setPendingRange(undefined);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label="Filtrar vendas por data"
          className={cn(
            "h-10 min-w-40 justify-start rounded-xl border-border bg-background px-3 text-left font-normal text-ink",
            className,
          )}
        >
          <CalendarDays className="mr-2 h-4 w-4 text-muted-foreground" />
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-auto rounded-2xl border-border bg-card p-2 shadow-xl"
      >
        <Calendar
          mode="range"
          locale={ptBR}
          weekStartsOn={0}
          month={month}
          onMonthChange={setMonth}
          selected={pendingRange ?? selectedRange}
          onSelect={(range) => {
            setPendingRange(range);
            if (range?.from && range.to) {
              onChange(keyFromDate(range.from), keyFromDate(range.to));
              setOpen(false);
              setPendingRange(undefined);
            } else if (range?.from) {
              onChange(keyFromDate(range.from), "");
            }
          }}
          today={today}
          disabled={{ after: today }}
          formatters={{
            formatCaption: (date) => format(date, "MMMM 'de' yyyy", { locale: ptBR }),
            formatWeekdayName: (date) =>
              format(date, "EEEEE", { locale: ptBR }).toLocaleUpperCase("pt-BR"),
          }}
          className="p-2"
          classNames={{
            caption_label: "text-sm font-semibold capitalize text-ink",
            weekday: "text-[11px] font-semibold text-muted-foreground",
            day: "rounded-md",
            today: "rounded-md border border-primary bg-transparent text-ink",
            outside: "text-muted-foreground/40",
            range_start: "rounded-l-md bg-primary text-primary-foreground",
            range_middle: "rounded-none bg-primary/10 text-ink",
            range_end: "rounded-r-md bg-primary text-primary-foreground",
            disabled: "cursor-not-allowed text-muted-foreground/35 opacity-40",
          }}
        />
        <div className="grid grid-cols-2 gap-1 border-t px-2 pt-2">
          {(
            [
              ["today", "Hoje"],
              ["yesterday", "Ontem"],
              ["last7days", "Últimos 7 dias"],
              ["thisMonth", "Este mês"],
            ] as const
          ).map(([shortcut, text]) => (
            <button
              key={shortcut}
              type="button"
              onClick={() => chooseShortcut(shortcut)}
              className="min-h-9 rounded-lg px-2 text-left text-xs font-medium text-muted-foreground hover:bg-accent hover:text-ink"
            >
              {text}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function getShortcutRange(shortcut: DateShortcut) {
  const today = dateFromKey(saoPauloDateKey())!;
  switch (shortcut) {
    case "today":
      return { start: today, end: today };
    case "yesterday": {
      const yesterday = subDays(today, 1);
      return { start: yesterday, end: yesterday };
    }
    case "last7days":
      return { start: subDays(today, 6), end: today };
    case "thisMonth":
      return { start: startOfMonth(today), end: today };
  }
}

export function dateKeyForPicker(date: Date) {
  return keyFromDate(date);
}
