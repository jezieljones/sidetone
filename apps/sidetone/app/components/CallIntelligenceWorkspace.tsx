"use client";

import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { AlertTriangle, ArrowRight, FileSearch, LoaderCircle, Quote, RefreshCcw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

type AskCallCard = {
  callSessionId: string;
  title: string;
  callBasis?: string;
  status: string;
  startedAt?: number;
  tags: Array<{ id: string; label: string; color?: string }>;
  snippets: Array<{ chunkId: string; text: string; startMs: number }>;
};

type AskRun = {
  _id: Id<"callIntelligenceRuns">;
  question: string;
  status: "queued" | "running" | "ready" | "failed" | "cancelled";
  stage?: "queued" | "planning" | "resolving_scope" | "retrieving" | "answering" | "saving";
  progressMessage?: string;
  answer?: string;
  resultCalls?: AskCallCard[];
  matchedEntities?: Array<{ id: string; name: string; treatment: string; confidence: number }>;
  coverage?: { totalCalls: number; indexedCalls: number; unindexedCalls: number; matchingCalls: number };
  error?: string;
  attemptCount?: number;
  createdAt: number;
  updatedAt: number;
};

function formatDate(timestamp?: number) {
  if (!timestamp) {
    return "Time unknown";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function formatTime(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function metricLabel(value?: number) {
  return new Intl.NumberFormat().format(value ?? 0);
}

function statusLabel(run?: Pick<AskRun, "status"> | null) {
  if (!run) {
    return "Queued";
  }
  if (run.status === "ready") {
    return "Ready";
  }
  if (run.status === "failed") {
    return "Needs retry";
  }
  if (run.status === "cancelled") {
    return "Cancelled";
  }
  return "Working";
}

function progressForRun(run: AskRun) {
  if (run.status === "queued") {
    return { label: "Queued", message: "Sidetone is getting this ready.", percent: 18 };
  }
  if (run.status === "failed") {
    return { label: "Needs retry", message: "Sidetone could not finish this answer. Your question is saved.", percent: 100 };
  }
  if (run.status === "cancelled") {
    return { label: "Cancelled", message: "This run was cancelled.", percent: 100 };
  }

  switch (run.stage) {
    case "planning":
      return { label: "Planning", message: "Planning the best search.", percent: 32 };
    case "resolving_scope":
      return { label: "Scoping", message: "Checking whether this is about a saved contact or a topic.", percent: 46 };
    case "retrieving":
      return { label: "Searching", message: "Searching indexed calls for evidence.", percent: 64 };
    case "answering":
      return { label: "Reading", message: "Reading the strongest evidence.", percent: 82 };
    case "saving":
      return { label: "Finishing", message: "Saving the answer and citations.", percent: 94 };
    default:
      return { label: "Working", message: "Working on your answer.", percent: 52 };
  }
}

function AnswerPanel({ run }: { run: AskRun }) {
  const calls = run.resultCalls ?? [];

  if (run.status !== "ready") {
    return null;
  }

  return (
    <Card>
      <CardHeader className="gap-4 p-6 md:p-8">
        <div className="grid gap-3">
          <CardTitle className="text-3xl">{run.question}</CardTitle>
          <p className="max-w-4xl whitespace-pre-wrap text-base leading-8 text-foreground">{run.answer}</p>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 px-6 pb-6 md:px-8 md:pb-8">
        {calls.length ? (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-muted-foreground">
              <FileSearch className="size-4 text-primary" aria-hidden="true" />
              Calls cited
              <span className="text-xs text-muted-foreground/75">
                {calls.length} call{calls.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="grid gap-3">
              {calls.map((call) => (
                <article className="grid gap-3 border-t border-border py-4 first:border-t-0 first:pt-0" key={call.callSessionId}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <a className="text-xl font-black text-foreground transition hover:text-primary" href={`/calls/${call.callSessionId}`}>
                        {call.title}
                      </a>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        {[call.callBasis, formatDate(call.startedAt)].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <Button asChild size="sm" variant="secondary">
                      <a href={`/calls/${call.callSessionId}`}>
                        Open
                        <ArrowRight className="size-4" />
                      </a>
                    </Button>
                  </div>
                  <div className="grid gap-2">
                    {call.snippets.slice(0, 2).map((snippet) => (
                      <a
                        className="grid gap-1 border-l border-primary/70 pl-3 text-sm leading-6 text-muted-foreground transition hover:text-foreground"
                        href={`/calls/${call.callSessionId}`}
                        key={snippet.chunkId}
                      >
                        <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-primary">
                          <Quote className="size-3" />
                          {formatTime(snippet.startMs)}
                        </span>
                        <span>{snippet.text}</span>
                      </a>
                    ))}
                  </div>
                  {call.tags.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {call.tags.map((tag) => (
                        <span
                          className="rounded-md border border-border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"
                          key={tag.id}
                          style={tag.color ? { borderColor: `${tag.color}80`, color: tag.color } : undefined}
                        >
                          {tag.label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </div>
        ) : (
          <div className="border-t border-border py-4 text-sm leading-6 text-muted-foreground">
            Sidetone did not find indexed transcript evidence for this question yet.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function CallIntelligenceWorkspace() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const home = useQuery(api.entities.ownerHome, isLoading || !isAuthenticated ? "skip" : {});
  const workspace = home?.workspaces?.[0] ?? null;
  const summary = useQuery(
    api.intelligence.callIntelligenceSummary,
    workspace?.entity?._id ? { entityId: workspace.entity._id } : "skip"
  );
  const startCallIntelligenceRun = useAction(api.intelligence.startCallIntelligenceRun);
  const retryCallIntelligenceRun = useAction(api.intelligence.retryCallIntelligenceRun);
  const backfillCallEntities = useMutation(api.crm.backfillCallEntities);
  const ensureTrial = useMutation(api.billing.ensureTrialForAuthenticatedOwner);
  const entitlements = useQuery(
    api.billing.entitlementsForAuthenticatedOwner,
    isLoading || !isAuthenticated ? "skip" : {}
  );
  const [question, setQuestion] = useState("");
  const [activeRunId, setActiveRunId] = useState<Id<"callIntelligenceRuns"> | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [pendingCreatedAt, setPendingCreatedAt] = useState<number | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const activeRun = useQuery(
    api.intelligence.callIntelligenceRun,
    activeRunId ? { runId: activeRunId } : "skip"
  ) as AskRun | null | undefined;
  const recentRuns = useQuery(
    api.intelligence.recentCallIntelligenceRuns,
    workspace?.entity?._id ? { entityId: workspace.entity._id } : "skip"
  ) as AskRun[] | undefined;

  const workspaceEntityId = workspace?.entity?._id;
  const identityBackfilledAt = workspace?.entity?.identityBackfilledAt;
  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    void ensureTrial({}).catch((err) => {
      console.warn("Unable to initialize billing trial.", err);
    });
  }, [ensureTrial, isAuthenticated]);

  useEffect(() => {
    if (!workspaceEntityId || identityBackfilledAt) {
      return;
    }
    void backfillCallEntities({ entityId: workspaceEntityId as Id<"entityProfiles"> }).catch((err) => {
      console.warn("Unable to backfill call entities.", err);
    });
  }, [backfillCallEntities, identityBackfilledAt, workspaceEntityId]);

  const suggestedQuestions = useMemo(() => [
    "Did we ever cover final closing cost?",
    "Which calls need follow-up?",
    "What objections keep repeating?"
  ], []);
  const summaryReady = summary !== undefined;
  const totalCalls = summary?.totalCalls ?? 0;
  const indexedCalls = summary?.indexedCalls ?? 0;
  const canAskQuestions = Boolean(workspaceEntityId && summaryReady && totalCalls > 0 && indexedCalls > 0);
  const availabilityMessage = !summaryReady
    ? "Loading your call workspace."
    : totalCalls === 0
      ? "Calls you start with Sidetone will appear here when notes are ready."
      : indexedCalls === 0
        ? "Sidetone is preparing your calls for questions. Recent Calls still works while indexing finishes."
        : null;

  const visibleRun = activeRun ?? (activeRunId && pendingQuestion
    ? {
        _id: activeRunId,
        question: pendingQuestion,
        status: "queued",
        stage: "queued",
        progressMessage: "Queued.",
        createdAt: pendingCreatedAt ?? 0,
        updatedAt: pendingCreatedAt ?? 0
      } satisfies AskRun
    : null);

  async function submitQuestion(nextQuestion = question) {
    const trimmed = nextQuestion.trim();
    if (!workspaceEntityId || !trimmed || submitting || !canAskQuestions) {
      return;
    }
    setSubmitting(true);
    setStartError(null);
    setPendingQuestion(trimmed);
    setPendingCreatedAt(Date.now());
    try {
      const payload = await startCallIntelligenceRun({
        entityId: workspaceEntityId as Id<"entityProfiles">,
        question: trimmed
      });
      setActiveRunId(payload.runId as Id<"callIntelligenceRuns">);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Unable to start this answer.");
    } finally {
      setSubmitting(false);
    }
  }

  async function retryRun(runId: Id<"callIntelligenceRuns">) {
    setSubmitting(true);
    setStartError(null);
    try {
      const payload = await retryCallIntelligenceRun({ runId });
      setActiveRunId(payload.runId as Id<"callIntelligenceRuns">);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Unable to retry this answer.");
    } finally {
      setSubmitting(false);
    }
  }

  const visibleRunProgress = visibleRun ? progressForRun(visibleRun) : null;

  if (entitlements && !entitlements.callIntelligence) {
    return (
      <section className="grid gap-6">
        <Card>
          <CardHeader className="gap-5 p-6 md:p-8">
            <Badge variant="primary" className="w-fit">Call Intelligence</Badge>
            <div className="grid gap-3">
              <CardTitle className="text-5xl md:text-6xl">Upgrade to ask your calls.</CardTitle>
              <CardDescription className="max-w-2xl text-base leading-7">
                Call Intelligence is included in your trial, Smooth Operator, and Premier Pro.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-6 pb-6 md:px-8 md:pb-8">
            <Button asChild>
              <a href="/subscriptions?plan=smooth-operator">
                See plans
                <ArrowRight className="size-4" />
              </a>
            </Button>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="grid gap-6">
      <Card>
        <CardHeader className="gap-6 p-6 md:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="grid gap-3">
              <CardTitle className="text-5xl md:text-6xl">
                Ask your calls.
              </CardTitle>
              <CardDescription className="max-w-2xl text-base leading-7">
                Ask a question and Sidetone will answer from your calls.
              </CardDescription>
            </div>
            <Badge variant="neutral" className="w-fit shrink-0">
              {metricLabel(summary?.totalCalls)} calls
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 px-6 pb-6 md:px-8 md:pb-8">
          <div className="grid gap-3">
            <textarea
              className="min-h-32 resize-none rounded-md border-[1.5px] border-[#DDD0B6] bg-[#FCF9F2] px-4 py-3 text-base leading-7 text-[#0A192F] outline-none transition placeholder:text-[#6E83A0] hover:border-[#C7B891] focus-visible:border-[#D22B2B] focus-visible:ring-2 focus-visible:ring-[#D22B2B]/15 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void submitQuestion();
                }
              }}
              placeholder="Ask a question about your calls..."
              value={question}
            />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                {suggestedQuestions.map((suggestion) => (
                  <button
                    className="rounded-md border border-border px-3 py-2 text-left text-xs font-semibold text-muted-foreground transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!canAskQuestions || submitting}
                    key={suggestion}
                    onClick={() => {
                      setQuestion(suggestion);
                      void submitQuestion(suggestion);
                    }}
                    type="button"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
              <Button disabled={!workspaceEntityId || !question.trim() || submitting || !canAskQuestions} onClick={() => submitQuestion()} type="button">
                {submitting ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                Ask
              </Button>
            </div>
            {availabilityMessage ? (
              <div className="rounded-md border border-border bg-background/40 px-4 py-3 text-sm leading-6 text-muted-foreground">
                {availabilityMessage}
              </div>
            ) : null}
          </div>
          {startError ? (
            <p className="text-sm text-destructive">{startError}</p>
          ) : null}
        </CardContent>
      </Card>

      {visibleRun && visibleRun.status !== "ready" ? (
        <Card>
          <CardHeader className="gap-4 p-6 md:p-8">
            <div className="grid gap-3">
              <CardTitle className="text-3xl">{visibleRun.question}</CardTitle>
              <p className="text-sm leading-6 text-muted-foreground">
                {visibleRun.status === "failed"
                  ? "Sidetone could not finish this answer. Your question is saved."
                  : visibleRunProgress?.message ?? "Working on your answer."}
              </p>
            </div>
            {visibleRun.status !== "failed" ? (
              <div className="grid gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                  {visibleRunProgress?.label ?? "Working"}
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${visibleRunProgress?.percent ?? 52}%` }}
                  />
                </div>
              </div>
            ) : null}
            {visibleRun.status === "failed" ? (
              <div className="grid gap-3">
                <Button className="w-fit" disabled={submitting} onClick={() => retryRun(visibleRun._id)} type="button" variant="secondary">
                  {submitting ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
                  Retry
                </Button>
                {process.env.NODE_ENV !== "production" && visibleRun.error ? (
                  <details className="text-xs leading-5 text-muted-foreground">
                    <summary className="cursor-pointer font-semibold">Developer error</summary>
                    <pre className="mt-2 whitespace-pre-wrap rounded-md border border-border p-3">{visibleRun.error}</pre>
                  </details>
                ) : null}
              </div>
            ) : null}
          </CardHeader>
        </Card>
      ) : null}

      {visibleRun ? <AnswerPanel run={visibleRun} /> : null}

      {recentRuns?.length ? (
        <Card>
          <CardHeader className="gap-2 p-6 md:p-8">
            <CardTitle className="text-3xl">Recent runs</CardTitle>
            <CardDescription>Previous call research stays available here.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 px-6 pb-6 md:px-8 md:pb-8">
            {recentRuns.map((run) => (
              <button
                className="grid gap-2 rounded-md border border-border p-4 text-left transition hover:border-primary focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                key={run._id}
                onClick={() => {
                  setActiveRunId(run._id);
                  setPendingQuestion(run.question);
                }}
                type="button"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="line-clamp-2 text-base font-black text-foreground">{run.question}</span>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                    {run.status === "failed" ? <AlertTriangle className="size-3 text-destructive" /> : null}
                    {statusLabel(run)}
                  </span>
                </div>
                <span className="text-xs font-semibold text-muted-foreground">{formatDate(run.createdAt)}</span>
              </button>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
