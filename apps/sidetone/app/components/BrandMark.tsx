import type { ReactNode } from "react";
import { cn } from "../lib/utils";

export function BrandWordmark({
  className
}: {
  className?: string;
}) {
  return (
    <span className={cn("font-serif text-3xl font-bold italic tracking-tight", className)}>sidetone<span className="ml-1 text-primary">.</span></span>
  );
}

export function BrandIcon({ className }: { className?: string }) {
  return (
    <span className={cn("brand-icon", className)} aria-hidden="true">
      <span className="brand-icon__dot" />
    </span>
  );
}

export function BrandLockup({
  className,
  subtitle
}: {
  className?: string;
  subtitle?: ReactNode;
}) {
  return (
    <span className={cn("brand-lockup", className)}>
      <span className="brand-lockup__text">
        <BrandWordmark />
        {subtitle ? <span className="brand-lockup__subtitle">{subtitle}</span> : null}
      </span>
    </span>
  );
}
