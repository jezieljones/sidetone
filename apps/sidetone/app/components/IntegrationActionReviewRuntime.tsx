"use client";

import { useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { ArrowLeft, Check, LoaderCircle } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

function prettyJson(value?: string) {
  if (!value) {
    return "{}";
  }
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export function IntegrationActionReviewRuntime({ draftId }: { draftId: string }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const draft = useQuery(
    api.entities.integrationActionDraft,
    !isLoading && isAuthenticated ? { draftId: draftId as any } : "skip"
  );
  const [isApproving, setIsApproving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function approveDraft() {
    setIsApproving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/integrations/actions/${draftId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const body = await response.json().catch(() => null);
      setMessage(response.ok ? "Draft sent." : body?.error ?? "Draft approval failed.");
    } finally {
      setIsApproving(false);
    }
  }

  if (isLoading || draft === undefined) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6 text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Loading draft...
        </CardContent>
      </Card>
    );
  }

  if (!draft) {
    return (
      <Card>
        <CardHeader>
          <Badge className="w-fit" variant="neutral">Integration draft</Badge>
          <CardTitle>Draft not found</CardTitle>
          <CardDescription>This draft is no longer available.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="secondary">
            <a href="/integrations"><ArrowLeft className="size-4" />Back to integrations</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="workspace-console grid gap-6">
      <Card>
        <CardHeader className="gap-3 p-5 sm:p-6">
          <Badge className="w-fit" variant={draft.status === "sent" ? "success" : "primary"}>
            {draft.status === "sent" ? "Sent" : "Integration draft"}
          </Badge>
          <CardTitle className="text-3xl sm:text-4xl">{draft.title}</CardTitle>
          <CardDescription>{draft.summary}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 px-5 pb-5 sm:px-6 sm:pb-6">
          <div className="grid gap-2 text-sm">
            <span className="font-semibold text-foreground">System</span>
            <span className="text-muted-foreground">{draft.integrationId}</span>
          </div>
          <div className="grid gap-2 text-sm">
            <span className="font-semibold text-foreground">Action</span>
            <span className="text-muted-foreground">{draft.actionType}</span>
          </div>
          <pre className="max-h-[420px] overflow-auto rounded-md border border-border bg-secondary p-4 text-xs leading-6 text-foreground">
            {prettyJson(draft.payloadJson)}
          </pre>
          {message ? <p className="text-sm leading-6 text-muted-foreground">{message}</p> : null}
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild variant="secondary">
              <a href="/integrations"><ArrowLeft className="size-4" />Back</a>
            </Button>
            <Button disabled={isApproving || draft.status === "sent"} onClick={approveDraft} type="button">
              {isApproving ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
              Approve
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
