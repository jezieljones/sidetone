"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { Ban, LoaderCircle, MessageCircle, PhoneCall, Users, Video } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { formatUsPhone } from "../lib/phone-format";

type SourceWorkspace = {
  numberAssignment: {
    phoneNumber?: string;
    e164?: string;
    status: "searching" | "ordering" | "configuring" | "active" | "failed" | "released";
  } | null;
  discordInstallations?: Array<{
    _id: string;
    discordGuildName?: string;
    status: "active" | "revoked" | "unlinked";
  }>;
  discordCaptures?: Array<{
    _id: string;
    discordGuildName?: string;
    discordChannelName?: string;
    status: "queued" | "joining" | "recording" | "processing" | "ready" | "failed" | "stopped";
  }>;
};

type HomePayload = {
  workspaces: SourceWorkspace[];
};

function captureStatusLabel(status?: string) {
  if (status === "queued") {
    return "Queued";
  }
  if (status === "joining") {
    return "Joining";
  }
  if (status === "recording") {
    return "Recording";
  }
  if (status === "processing") {
    return "Saving";
  }
  return "Connected";
}

function SourceIcon({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground">
      {children}
    </span>
  );
}

function SourceRow({
  action,
  children,
  icon,
  title
}: {
  action?: React.ReactNode;
  children: React.ReactNode;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="grid gap-3 border-t border-border py-4 first:border-t-0 first:pt-0 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
      <SourceIcon>{icon}</SourceIcon>
      <div className="min-w-0">
        <p className="text-base font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{children}</p>
      </div>
      {action ? <div className="sm:justify-self-end">{action}</div> : null}
    </div>
  );
}

export function SourceSettingsRuntime() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const home = useQuery(
    api.entities.ownerHome,
    !isLoading && isAuthenticated ? {} : "skip"
  ) as HomePayload | undefined;

  if (isLoading || !home) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6 text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Loading sources...
        </CardContent>
      </Card>
    );
  }

  const workspace = home.workspaces[0] ?? null;
  const activeNumber = workspace?.numberAssignment?.status === "active"
    ? workspace.numberAssignment.e164 ?? workspace.numberAssignment.phoneNumber ?? null
    : null;
  const discordInstallations = workspace?.discordInstallations ?? [];
  const activeDiscordCaptures = (workspace?.discordCaptures ?? [])
    .filter((capture) => ["queued", "joining", "recording", "processing"].includes(capture.status));
  const activeDiscordCapture = activeDiscordCaptures[0];
  const discordConnected = discordInstallations.some((installation) => installation.status === "active");
  const discordGuildName = activeDiscordCapture?.discordGuildName
    ?? discordInstallations.find((installation) => installation.status === "active")?.discordGuildName
    ?? "Discord";
  return (
    <section className="workspace-console grid gap-6">
      <Card>
        <CardHeader className="gap-3 p-5 sm:p-6">
          <Badge className="w-fit" variant="primary">Sources</Badge>
          <CardTitle className="text-3xl sm:text-4xl">Call sources</CardTitle>
        </CardHeader>
        <CardContent className="grid px-5 pb-5 sm:px-6 sm:pb-6">
          <SourceRow
            icon={<PhoneCall className="size-5" aria-hidden="true" />}
            title="Sidetone number"
          >
            {activeNumber ? formatUsPhone(activeNumber) : "Number setup is not complete."}
          </SourceRow>
          <SourceRow
            action={(
              <Button asChild className="w-full sm:w-auto" size="sm" variant={discordConnected ? "secondary" : "default"}>
                <a href="/api/discord/oauth/start">
                  {discordConnected ? "Manage" : "Connect"}
                </a>
              </Button>
            )}
            icon={<MessageCircle className="size-5" aria-hidden="true" />}
            title="Discord voice"
          >
            {activeDiscordCapture
              ? `${captureStatusLabel(activeDiscordCapture.status)} in ${discordGuildName}.`
              : discordConnected
                ? `Connected to ${discordGuildName}.`
                : "Not connected."}
          </SourceRow>
          <SourceRow
            action={<Badge variant="accent">Admin testing</Badge>}
            icon={<Video className="size-5" aria-hidden="true" />}
            title="Google Meet"
          >
            Paste a Meet link on the dashboard while this browser-bot path is under internal testing.
          </SourceRow>
          <SourceRow
            action={<Badge variant="accent">Admin testing</Badge>}
            icon={<Users className="size-5" aria-hidden="true" />}
            title="Microsoft Teams"
          >
            Paste a Teams meeting link or invite on the dashboard while this browser-bot path is under internal testing.
          </SourceRow>
          <SourceRow
            action={<Badge variant="warning">Paused</Badge>}
            icon={<Ban className="size-5" aria-hidden="true" />}
            title="Zoom RTMS"
          >
            Zoom remains gated behind account-level RTMS approval and is not exposed in the product flow.
          </SourceRow>
        </CardContent>
      </Card>
    </section>
  );
}
