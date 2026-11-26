import { cn } from "@/lib/utils";
import { MESARI_BRAND } from "@/lib/branding";

export type MesariLogoVariant = keyof typeof MESARI_BRAND;

const logoAlt: Record<MesariLogoVariant, string> = {
  vertical: "Mesari",
  horizontal: "Mesari",
  symbol: "Símbolo do Mesari",
};

export function MesariLogo({
  variant,
  className,
}: {
  variant: MesariLogoVariant;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={logoAlt[variant]}
      className={cn(
        "relative inline-grid shrink-0 place-items-center overflow-hidden",
        className,
      )}
    >
      <img
        src={MESARI_BRAND[variant]}
        alt=""
        aria-hidden="true"
        className={cn(
          "h-full w-full",
          variant === "symbol" ? "object-cover" : "object-contain",
        )}
      />
    </span>
  );
}
