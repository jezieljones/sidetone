"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import {
  dashboardIndustryProfileForId,
  type DashboardIndustryProfile
} from "../lib/brand-system";

function profileStyle(profile: DashboardIndustryProfile) {
  return {
    "--mode-accent": profile.accent,
    "--mode-card-bg": profile.accent
  } as CSSProperties;
}

export function IndustryProfileCard({
  active = false,
  className = "",
  loading = "lazy",
  onClick,
  profile,
  profileId,
  type = "button"
}: {
  active?: boolean;
  className?: string;
  loading?: "eager" | "lazy";
  onClick?: () => void;
  profile?: DashboardIndustryProfile;
  profileId?: string;
  type?: "button" | "div";
}) {
  const selectedProfile = profile ?? dashboardIndustryProfileForId(profileId);
  const classes = ["mode-card-control", "aspect-square", className].filter(Boolean).join(" ");
  const content = (
    <Image
      alt={`${selectedProfile.personaName}, ${selectedProfile.industry}`}
      height={1024}
      loading={loading}
      sizes="(min-width: 1280px) 21rem, (min-width: 768px) 33vw, 80vw"
      src={selectedProfile.cardImage}
      unoptimized
      width={1024}
    />
  );

  if (type === "div") {
    return (
      <div className={classes} data-active={active} style={profileStyle(selectedProfile)}>
        {content}
      </div>
    );
  }

  return (
    <button
      className={classes}
      data-active={active}
      onClick={onClick}
      style={profileStyle(selectedProfile)}
      type="button"
    >
      {content}
    </button>
  );
}

export function IndustryProfileBadge({
  className = "",
  profile,
  profileId
}: {
  className?: string;
  profile?: DashboardIndustryProfile;
  profileId?: string;
}) {
  const selectedProfile = profile ?? dashboardIndustryProfileForId(profileId);

  return (
    <span className={`enamel-badge ${className}`} style={profileStyle(selectedProfile)}>
      {selectedProfile.compactLabel}
    </span>
  );
}
