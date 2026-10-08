"use client";

import { ArrowRight, CreditCard, LoaderCircle, ReceiptText } from "lucide-react";
import { useEffect, useState } from "react";
import {
  sidetoneBillingPlans,
  sidetonePlanFromPricingSlug,
  sidetonePricingSlug,
  sidetoneTrialDays,
  type SidetoneBillablePlanTier
} from "@sidetone/contracts";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

type Overview = {
  plan: SidetoneBillablePlanTier;
  status: string;
  planLabel: string;
  callIntelligence: boolean;
  overageEligible: boolean;
  monthlyPhoneMinutes: number;
  overageCents?: number | null;
  periodStart: number;
  periodEnd: number;
  trialEnd?: number;
  finalizedUsageSeconds: number;
  remainingSeconds: number;
  cancelAtPeriodEnd?: boolean;
  stripeCustomerId?: string;
};

function formatDate(timestamp?: number) {
  if (!timestamp) {
    return "Not set";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(timestamp));
}

function minutes(seconds: number) {
  return Math.ceil(Math.max(0, seconds) / 60);
}

function statusCopy(overview?: Overview) {
  if (!overview) {
    return "Loading...";
  }
  if (overview.status === "trialing") {
    return `Trial ends ${formatDate(overview.trialEnd)}`;
  }
  if (overview.status === "active") {
    return overview.cancelAtPeriodEnd
      ? `Active until ${formatDate(overview.periodEnd)}`
      : overview.planLabel;
  }
  if (overview.status === "past_due" || overview.status === "unpaid") {
    return "Payment needs attention";
  }
  return "Free plan";
}

function nextResetDate(overview?: Overview) {
  if (!overview) return undefined;
  // For trialing users, the trial end IS the reset; show it once via status,
  // and surface the renewal date separately only when the two differ.
  if (overview.status === "trialing" && overview.trialEnd === overview.periodEnd) {
    return undefined;
  }
  return overview.periodEnd;
}

function planMinutes(plan: SidetoneBillablePlanTier) {
  return sidetoneBillingPlans[plan].monthlyPhoneMinutes.toLocaleString();
}

function overageLabel(plan: SidetoneBillablePlanTier) {
  const cents = sidetoneBillingPlans[plan].phoneOverageCents;
  return cents ? `$${(cents / 100).toFixed(2)} / minute` : "No overage";
}

const comparisonRows = [
  {
    label: "Phone minutes",
    free: `${planMinutes("free")} / month`,
    smooth_operator: `${planMinutes("smooth_operator")} / month`,
    premier_pro: `${planMinutes("premier_pro")} / month`
  },
  {
    label: "Call records",
    free: "Included",
    smooth_operator: "Included",
    premier_pro: "Included"
  },
  {
    label: "Live signals",
    free: "Not included",
    smooth_operator: "Included",
    premier_pro: "Included"
  },
  {
    label: "Call Docs and Q&A",
    free: "Not included",
    smooth_operator: "Included",
    premier_pro: "Included"
  },
  {
    label: "Overage",
    free: overageLabel("free"),
    smooth_operator: overageLabel("smooth_operator"),
    premier_pro: overageLabel("premier_pro")
  }
] as const;

export function SubscriptionRuntime({
  initialPlan,
  checkoutState
}: {
  initialPlan?: string;
  checkoutState?: string;
}) {
  const [overview, setOverview] = useState<Overview | undefined>();
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const highlightedPlan = sidetonePlanFromPricingSlug(initialPlan);

  useEffect(() => {
    let cancelled = false;
    async function loadOverview() {
      setLoadingOverview(true);
      setError(null);
      try {
        const response = await fetch("/api/billing/subscription", { cache: "no-store" });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.overview) {
          throw new Error(payload?.error ?? "Unable to load subscription.");
        }
        if (!cancelled) {
          setOverview(payload.overview);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to load subscription.");
        }
      } finally {
        if (!cancelled) {
          setLoadingOverview(false);
        }
      }
    }
    void loadOverview();
    return () => {
      cancelled = true;
    };
  }, []);

  async function startCheckout(plan: "smooth_operator" | "premier_pro") {
    setBusyPlan(plan);
    setError(null);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: sidetonePricingSlug(plan) })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.url) {
        throw new Error(payload?.error ?? "Unable to start checkout.");
      }
      window.location.assign(payload.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start checkout.");
    } finally {
      setBusyPlan(null);
    }
  }

  async function openPortal() {
    setPortalBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.url) {
        throw new Error(payload?.error ?? "Unable to open billing settings.");
      }
      window.location.assign(payload.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to open billing settings.");
    } finally {
      setPortalBusy(false);
    }
  }

  const usedMinutes = minutes(overview?.finalizedUsageSeconds ?? 0);
  const remainingMinutes = minutes(overview?.remainingSeconds ?? 0);
  const usagePercent = overview
    ? Math.min(100, Math.round((usedMinutes / Math.max(1, overview.monthlyPhoneMinutes)) * 100))
    : 0;
  const isTrialing = overview?.status === "trialing";
  const isPaidActive = overview?.status === "active";
  const statusBadgeLabel = loadingOverview
    ? "Loading"
    : isTrialing
      ? "Trial"
      : overview?.planLabel ?? "Unavailable";
  const statusBadgeVariant = isPaidActive ? "success" : isTrialing ? "accent" : "neutral";

  const renewalDate = nextResetDate(overview);

  return (
    <section className="grid gap-6">
      <Card>
        <CardHeader className="gap-4 p-4 sm:p-6 md:p-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="grid gap-3">
              <Badge variant="primary" className="w-fit">Subscription</Badge>
              <CardTitle className="text-3xl sm:text-4xl md:text-5xl">Manage Sidetone</CardTitle>
            </div>
            <Badge variant={statusBadgeVariant} className="w-fit">
              {statusBadgeLabel}
            </Badge>
          </div>
          {checkoutState === "success" ? (
            <p className="rounded-md border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
              Checkout complete. Stripe is syncing your subscription.
            </p>
          ) : checkoutState === "cancelled" ? (
            <p className="rounded-md border border-border bg-background/40 px-4 py-3 text-sm text-muted-foreground">
              Checkout was cancelled. Your current plan is unchanged.
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-5 px-4 pb-4 sm:px-6 sm:pb-6 md:px-8 md:pb-8">
          <dl className={`grid gap-4 border-t border-border pt-4 ${renewalDate ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
            <div className="grid gap-1">
              <dt className="roster-eyebrow text-muted-foreground">Status</dt>
              <dd className="text-lg font-semibold leading-snug sm:text-xl">{statusCopy(overview)}</dd>
            </div>
            <div className="grid gap-1">
              <dt className="roster-eyebrow text-muted-foreground">Phone minutes</dt>
              <dd className="text-lg font-semibold leading-snug sm:text-xl">
                <span className="font-mono">{usedMinutes}</span>
                <span className="text-muted-foreground"> / </span>
                <span className="font-mono">{overview?.monthlyPhoneMinutes ?? 0}</span>
                <span className="ml-1 text-sm font-normal text-muted-foreground">used</span>
              </dd>
            </div>
            {renewalDate ? (
              <div className="grid gap-1">
                <dt className="roster-eyebrow text-muted-foreground">Renews</dt>
                <dd className="text-lg font-semibold leading-snug sm:text-xl">{formatDate(renewalDate)}</dd>
              </div>
            ) : null}
          </dl>
          <div className="grid gap-2">
            <div className="h-2 overflow-hidden rounded-full bg-border">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${usagePercent}%` }} />
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              {usedMinutes === 0
                ? "Sidetone warns you before your included minutes run out."
                : `${remainingMinutes} minute${remainingMinutes === 1 ? "" : "s"} remaining.`}
              {overview?.overageEligible && overview.overageCents
                ? ` Overage is $${(overview.overageCents / 100).toFixed(2)} per minute after that.`
                : null}
            </p>
          </div>
          <p className="rounded-md border border-border bg-background/40 px-4 py-3 text-sm leading-6 text-muted-foreground">
            New workspaces start with a {sidetoneTrialDays}-day Smooth Operator trial. If the trial ends without an active paid plan,
            Sidetone automatically moves the workspace to Free.
          </p>
          {overview?.stripeCustomerId ? (
            <div className="flex flex-wrap gap-3">
              <Button disabled={portalBusy} onClick={openPortal} type="button" variant="secondary">
                {portalBusy ? <LoaderCircle className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
                Manage billing
              </Button>
            </div>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {(["free", "smooth_operator", "premier_pro"] as const).map((plan) => {
          const details = sidetoneBillingPlans[plan];
          const trialActive = overview?.plan === plan && overview.status === "trialing";
          const active = overview?.plan === plan && (overview.status === "active" || overview.status === "free");
          const highlighted = plan !== "free" && highlightedPlan === plan;
          return (
            <Card className={highlighted ? "border-primary/70 shadow-electric" : ""} key={plan}>
              <CardHeader className="gap-3 p-4 sm:p-6 md:p-7">
                <div className="flex items-start justify-between gap-3">
                  <div className="grid gap-1">
                    <CardTitle className="text-2xl sm:text-3xl">{details.label}</CardTitle>
                    <CardDescription>
                      {details.monthlyPhoneMinutes.toLocaleString()} phone minutes / month
                    </CardDescription>
                  </div>
                  {trialActive ? (
                    <Badge variant="accent">Trial</Badge>
                  ) : active ? (
                    <Badge variant="success">Current</Badge>
                  ) : plan === "free" ? (
                    <Badge variant="neutral">Fallback</Badge>
                  ) : highlighted ? (
                    <Badge variant="accent">Selected</Badge>
                  ) : null}
                </div>
                <p className="text-3xl font-black text-foreground sm:text-4xl">
                  ${details.monthlyPriceUsd}
                  <span className="text-sm font-semibold text-muted-foreground"> / month</span>
                </p>
              </CardHeader>
              <CardContent className="grid gap-3 px-4 pb-4 sm:px-6 sm:pb-6 md:px-7 md:pb-7">
                {plan === "free" ? (
                  <Button disabled type="button" variant="secondary">
                    After trial fallback
                  </Button>
                ) : (
                  <Button disabled={busyPlan === plan || active} onClick={() => startCheckout(plan)} type="button">
                    {busyPlan === plan ? <LoaderCircle className="size-4 animate-spin" /> : <ReceiptText className="size-4" />}
                    {active
                      ? "Current plan"
                      : trialActive
                        ? `Continue on ${details.label}`
                        : `Start ${details.label}`}
                    {!active ? <ArrowRight className="size-4" /> : null}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="gap-2 p-4 sm:p-6 md:p-7">
          <CardTitle className="text-2xl sm:text-3xl">Plan comparison</CardTitle>
          <CardDescription>Free remains available after the trial; paid plans add live intelligence and larger minute pools.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto px-4 pb-4 sm:px-6 sm:pb-6 md:px-7 md:pb-7">
          <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-3 pr-4 font-semibold">Feature</th>
                <th className="px-4 py-3 font-semibold">Free</th>
                <th className="px-4 py-3 font-semibold">Smooth Operator</th>
                <th className="pl-4 py-3 font-semibold">Premier Pro</th>
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((row) => (
                <tr className="border-b border-border/70 last:border-b-0" key={row.label}>
                  <th className="py-3 pr-4 font-semibold text-foreground">{row.label}</th>
                  <td className="px-4 py-3 text-muted-foreground">{row.free}</td>
                  <td className="px-4 py-3 text-muted-foreground">{row.smooth_operator}</td>
                  <td className="pl-4 py-3 text-muted-foreground">{row.premier_pro}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </section>
  );
}
