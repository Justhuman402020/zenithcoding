import mark from "@/assets/forge-mark.png";

export function ForgeMark({
  className = "h-8 w-8",
  glow = false,
}: {
  className?: string;
  glow?: boolean;
}) {
  return (
    <img
      src={mark}
      alt="Forge"
      width={64}
      height={64}
      loading="lazy"
      className={`${className} ${glow ? "drop-shadow-[0_0_18px_rgba(240,215,140,0.45)]" : ""}`}
    />
  );
}

export function ForgeWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display tracking-tight text-gold ${className}`}>Forge</span>
  );
}