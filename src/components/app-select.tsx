import type { LucideIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type AppSelectOption = {
  value: string;
  label: string;
  Icon?: LucideIcon;
};

const EMPTY_VALUE = "__mesari_empty_option__";

export function AppSelect({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  disabled,
  ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: AppSelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const selectedValue = value === "" ? EMPTY_VALUE : value;

  return (
    <Select
      value={selectedValue}
      disabled={disabled}
      onValueChange={(next) => onValueChange(next === EMPTY_VALUE ? "" : next)}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(
          "h-10 rounded-xl border-border bg-background shadow-none focus:ring-2 focus:ring-primary/30",
          className,
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="rounded-xl border-border bg-card p-1 shadow-lg">
        {options.map(({ value: optionValue, label, Icon }) => {
          const encodedValue = optionValue === "" ? EMPTY_VALUE : optionValue;
          return (
            <SelectItem
              key={encodedValue}
              value={encodedValue}
              className="min-h-10 rounded-lg pl-3 pr-9 focus:bg-accent focus:text-ink data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
            >
              <span className="flex items-center gap-2">
                {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
                <span>{label}</span>
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
