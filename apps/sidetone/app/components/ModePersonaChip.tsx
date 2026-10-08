"use client";

import {
  Archive,
  Compass,
  HeartHandshake,
  PhoneCall,
  Scale,
  Sparkles,
  Target
} from "lucide-react";
import Image from "next/image";
import type { CSSProperties } from "react";
import {
  modePersonaForMode,
  modePersonas,
  type ModePersona
} from "../lib/brand-system";

const iconByName = {
  Archive,
  Compass,
  HeartHandshake,
  Scale,
  Sparkles,
  Target
};

function modeStyle(persona: ModePersona) {
  return {
    "--mode-accent": persona.accent,
    "--mode-accent-hsl": persona.accentHsl,
    "--mode-card-bg": persona.background
  } as CSSProperties;
}

function PersonaIcon({ persona, className = "size-4" }: { persona: ModePersona; className?: string }) {
  const Icon = iconByName[persona.icon as keyof typeof iconByName] ?? PhoneCall;
  return <Icon className={className} />;
}

export function ModePersonaIcon({
  mode,
  className = "size-4"
}: {
  mode?: string;
  className?: string;
}) {
  return <PersonaIcon className={className} persona={modePersonaForMode(mode)} />;
}

export function ModePersonaChip({
  active = false,
  as = "button",
  className = "",
  mode,
  onClick,
  showPersona = true
}: {
  active?: boolean;
  as?: "button" | "div";
  className?: string;
  mode?: string;
  onClick?: () => void;
  showPersona?: boolean;
}) {
  const persona = modePersonaForMode(mode);
  const content = (
    <>
      <span className="mode-persona-chip__thumb">
        <Image alt="" height={1024} src={persona.cardImage} width={1024} />
      </span>
      <span className="mode-persona-chip__label">
        <strong>{showPersona ? persona.personaName : persona.modeLabel}</strong>
        {showPersona ? <span>{persona.modeLabel}</span> : null}
      </span>
    </>
  );

  if (as === "div") {
    return (
      <div
        className={`mode-persona-chip ${className}`}
        data-active={active}
        style={modeStyle(persona)}
      >
        {content}
      </div>
    );
  }

  return (
    <button
      className={`mode-persona-chip ${className}`}
      data-active={active}
      onClick={onClick}
      style={modeStyle(persona)}
      type="button"
    >
      {content}
    </button>
  );
}

export function ModeWaveformScan({ mode }: { mode?: string }) {
  const persona = modePersonaForMode(mode);
  return <div className="mode-waveform-scan" style={modeStyle(persona)} />;
}

export function ModePersonaCard({
  active = false,
  as = "button",
  className = "",
  compact = false,
  loading = "lazy",
  mode,
  onClick
}: {
  active?: boolean;
  as?: "button" | "div" | "a";
  className?: string;
  compact?: boolean;
  loading?: "eager" | "lazy";
  mode?: string;
  onClick?: () => void;
}) {
  const persona = modePersonaForMode(mode);
  const content = (
    <>
      <Image
        alt={`${persona.personaName}, ${persona.modeLabel}`}
        height={1024}
        loading={loading}
        sizes={compact ? "(min-width: 1024px) 12vw, 45vw" : "(min-width: 1024px) 18vw, 70vw"}
        src={persona.cardImage}
        width={1024}
      />
    </>
  );
  const classes = [
    "mode-card-control",
    `mode-card-${persona.coachMode}`,
    compact ? "aspect-square" : "aspect-square",
    className
  ].filter(Boolean).join(" ");

  if (as === "div") {
    return (
      <div className={classes} data-active={active} style={modeStyle(persona)}>
        {content}
      </div>
    );
  }

  if (as === "a") {
    return (
      <a className={classes} data-active={active} href={`/sign-in?redirect_url=%2Fdashboard&source=${persona.source}`} style={modeStyle(persona)}>
        {content}
      </a>
    );
  }

  return (
    <button
      className={classes}
      data-active={active}
      onClick={onClick}
      style={modeStyle(persona)}
      type="button"
    >
      {content}
    </button>
  );
}

export function modePersonaStyle(mode?: string) {
  return modeStyle(modePersonaForMode(mode));
}

export { modePersonaForMode, modePersonas };
