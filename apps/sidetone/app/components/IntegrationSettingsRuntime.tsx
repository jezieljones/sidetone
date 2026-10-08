"use client";

import { useMemo, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { AlertTriangle, CheckCircle2, Database, LoaderCircle, PlugZap } from "lucide-react";
import {
  sidetoneIntegrationDescriptors,
  type IndustryProfileId,
  type SidetoneIntegrationDescriptor
} from "@sidetone/contracts";
import { api } from "../../convex/_generated/api";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";

type Workspace = {
  entity: {
    _id: string;
    defaultIndustryProfile?: IndustryProfileId;
  };
};

type HomePayload = {
  workspaces: Workspace[];
};

type IntegrationConnection = {
  _id: string;
  integrationId: string;
  status: "active" | "needs_attention" | "failed" | "revoked";
  environment?: "production" | "sandbox";
  failureReason?: string;
  updatedAt: number;
  hasCredentials: boolean;
};

function descriptorVisibleForProfile(descriptor: SidetoneIntegrationDescriptor, profile: IndustryProfileId | "general") {
  return descriptor.personaIds.includes(profile as IndustryProfileId)
    || profile === "general";
}

function statusBadge(connection?: IntegrationConnection) {
  if (!connection) {
    return <Badge variant="neutral">Not connected</Badge>;
  }
  if (connection.status === "active") {
    return <Badge variant="success">Connected</Badge>;
  }
  if (connection.status === "needs_attention") {
    return <Badge variant="warning">Needs attention</Badge>;
  }
  return <Badge variant="neutral">{connection.status}</Badge>;
}

function fieldInputType(kind: "text" | "password" | "select") {
  return kind === "password" ? "password" : "text";
}

export function IntegrationSettingsRuntime({
  selectedIntegration
}: {
  selectedIntegration?: string | null;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const home = useQuery(api.entities.ownerHome, !isLoading && isAuthenticated ? {} : "skip") as HomePayload | undefined;
  const workspace = home?.workspaces[0];
  const catalog = useQuery(
    api.entities.integrationCatalog,
    workspace ? { entityId: workspace.entity._id as any } : "skip"
  ) as { connections: IntegrationConnection[] } | undefined;
  const drafts = useQuery(
    api.entities.integrationActionDraftsForEntity,
    workspace ? { entityId: workspace.entity._id as any } : "skip"
  ) as Array<{
    _id: string;
    integrationId: string;
    title: string;
    status: string;
    createdAt: number;
  }> | undefined;
  const [form, setForm] = useState({
    environment: "production",
    clientId: "",
    clientSecret: ""
  });
  const [isConnecting, setIsConnecting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const profile = workspace?.entity.defaultIndustryProfile ?? "general";
  const visibleDescriptors = useMemo(() => {
    const visible = sidetoneIntegrationDescriptors.filter((descriptor) => descriptorVisibleForProfile(descriptor, profile));
    return visible.length ? visible : sidetoneIntegrationDescriptors;
  }, [profile]);
  const connections = catalog?.connections ?? [];
  const connectionByIntegration = new Map(connections.map((connection) => [connection.integrationId, connection]));

  async function connectBuildium() {
    if (!workspace) {
      return;
    }
    setIsConnecting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/integrations/buildium/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId: workspace.entity._id,
          environment: form.environment,
          clientId: form.clientId,
          clientSecret: form.clientSecret
        })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(body?.error ?? "Buildium connection failed.");
      } else {
        setMessage(body?.warning ?? "Buildium connected.");
        setForm((current) => ({ ...current, clientSecret: "" }));
      }
    } finally {
      setIsConnecting(false);
    }
  }

  if (isLoading || !home || !workspace || !catalog) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6 text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Loading integrations...
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="workspace-console grid gap-6">
      <Card>
        <CardHeader className="gap-3 p-5 sm:p-6">
          <Badge className="w-fit" variant="primary">Integrations</Badge>
          <CardTitle className="text-3xl sm:text-4xl">Business systems</CardTitle>
          <CardDescription>Connect systems Maya can use for approval-gated property-management drafts.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 px-5 pb-5 sm:px-6 sm:pb-6">
          {visibleDescriptors.map((descriptor) => {
            const connection = connectionByIntegration.get(descriptor.id);
            const isBuildium = descriptor.id === "buildium";
            const isSelected = selectedIntegration === descriptor.id || (isBuildium && !selectedIntegration);
            return (
              <div className="grid gap-4 border-t border-border py-5 first:border-t-0 first:pt-0" key={descriptor.id}>
                <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
                  <span className="inline-flex size-11 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground">
                    <Database className="size-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-semibold text-foreground">{descriptor.label}</p>
                      {statusBadge(connection)}
                      {descriptor.status !== "available" ? <Badge variant="neutral">Planned</Badge> : null}
                    </div>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{descriptor.description}</p>
                    {connection?.failureReason ? (
                      <p className="mt-2 flex items-center gap-2 text-sm leading-6 text-warning">
                        <AlertTriangle className="size-4" />
                        {connection.failureReason}
                      </p>
                    ) : null}
                  </div>
                  {connection?.status === "active" ? (
                    <CheckCircle2 className="size-5 text-success" aria-hidden="true" />
                  ) : isBuildium ? (
                    <Button asChild size="sm" variant="secondary">
                      <a href="/integrations?integration=buildium">Configure</a>
                    </Button>
                  ) : (
                    <Badge variant="neutral">Setup only</Badge>
                  )}
                </div>
                {isBuildium && isSelected ? (
                  <div className="grid gap-3 rounded-md border border-border bg-secondary/60 p-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      {descriptor.requiredFields.map((field) => (
                        <label className="grid gap-2 text-sm font-semibold text-foreground" key={field.id}>
                          {field.label}
                          {field.kind === "select" ? (
                            <select
                              className="h-10 rounded-md border border-input bg-background px-3 text-sm font-normal text-foreground"
                              value={form.environment}
                              onChange={(event) => setForm((current) => ({ ...current, environment: event.target.value }))}
                            >
                              {(field.options ?? ["production", "sandbox"]).map((option) => (
                                <option key={option} value={option}>{option}</option>
                              ))}
                            </select>
                          ) : (
                            <Input
                              type={fieldInputType(field.kind)}
                              value={field.id === "clientId" ? form.clientId : form.clientSecret}
                              onChange={(event) => setForm((current) => ({
                                ...current,
                                [field.id]: event.target.value
                              }))}
                            />
                          )}
                        </label>
                      ))}
                    </div>
                    {message ? <p className="text-sm leading-6 text-muted-foreground">{message}</p> : null}
                    <Button className="w-full sm:w-fit" disabled={isConnecting} onClick={connectBuildium} type="button">
                      {isConnecting ? <LoaderCircle className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
                      Connect Buildium
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {drafts?.length ? (
        <Card>
          <CardHeader className="p-5 sm:p-6">
            <Badge className="w-fit" variant="neutral">Drafts</Badge>
            <CardTitle>Recent integration drafts</CardTitle>
          </CardHeader>
          <CardContent className="grid px-5 pb-5 sm:px-6 sm:pb-6">
            {drafts.map((draft) => (
              <a
                className="grid gap-1 border-t border-border py-4 text-sm first:border-t-0 first:pt-0"
                href={`/integrations/actions/${draft._id}`}
                key={draft._id}
              >
                <span className="font-semibold text-foreground">{draft.title}</span>
                <span className="text-muted-foreground">{draft.integrationId} · {draft.status}</span>
              </a>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
