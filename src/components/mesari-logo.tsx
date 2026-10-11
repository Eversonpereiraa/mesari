import { cn } from "@/lib/utils";
import { MESARI_BRAND } from "@/lib/branding";

export type MesariLogoVariant = keyof typeof MESARI_BRAND;

const logoAlt: Record<MesariLogoVariant, string> = {
  vertical: "Mesari",
  horizontal: "Mesari",
  symbol: "Símbolo do Mesari",
};

const artworkScale: Record<MesariLogoVariant, string> = {
  vertical: "scale-[1.9]",
  horizontal: "scale-[2.05]",
  symbol: "scale-[1.65]",
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
        variant === "symbol" && "bg-white",
        className,
      )}
    >
      <img
        src={MESARI_BRAND[variant]}
        alt=""
        aria-hidden="true"
        className={cn(
          "h-full w-full",
          variant === "symbol" ? cn("object-cover", artworkScale[variant]) : "object-contain",
        )}
      />
    </span>
  );
}
