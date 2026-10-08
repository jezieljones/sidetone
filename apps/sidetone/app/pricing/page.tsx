import { billingEnabled } from "../lib/config";
import { redirect as redirectSelfHosted } from "next/navigation";
import { ArrowRight, Check, Minus } from "lucide-react";
import type { Metadata } from "next";
import { AppHeader } from "../components/AppHeader";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";

type TierKey = "free" | "smooth-operator" | "premier-pro";

const tiers: Array<{
  key: TierKey;
  name: string;
  price: string;
  cadence: string;
  blurb: string;
  highlight: boolean;
  cta: { label: string; href: string };
}> = [
  {
    key: "free",
    name: "Free",
    price: "$0",
    cadence: "forever",
    blurb: "For occasional users or to try it out.",
    highlight: false,
    cta: { label: "Get started", href: "/sign-in?redirect_url=/dashboard" }
  },
  {
    key: "smooth-operator",
    name: "Smooth Operator",
    price: "$14",
    cadence: "per month",
    blurb: "For phone-active professionals who want searchable call intelligence.",
    highlight: true,
    cta: { label: "Start Smooth Operator", href: "/sign-in?redirect_url=/subscriptions?plan=smooth-operator" }
  },
  {
    key: "premier-pro",
    name: "Premier Pro",
    price: "$29",
    cadence: "per month",
    blurb: "For heavy phone schedules and back-to-back meeting days.",
    highlight: false,
    cta: { label: "Start Premier Pro", href: "/sign-in?redirect_url=/subscriptions?plan=premier-pro" }
  }
];

type Row = {
  label: string;
  helper?: string;
  values: Record<TierKey, string | null>;
};

const rows: Row[] = [
  {
    label: "Phone calls",
    helper: "Add Sidetone to any call.",
    values: {
      free: "100 min",
      "smooth-operator": "1,000 min",
      "premier-pro": "2,500 min"
    }
  },
  {
    label: "Phone overage",
    helper: "Pay only for what you actually use beyond the included minutes.",
    values: {
      free: null,
      "smooth-operator": "$0.10 / min",
      "premier-pro": "$0.06 / min"
    }
  },
  {
    label: "Call Intelligence",
    helper: "Ask questions across calls, semantic transcript search, and cited call cards.",
    values: {
      free: null,
      "smooth-operator": "Included",
      "premier-pro": "Included"
    }
  }
];

export const metadata: Metadata = {
  title: "Sidetone pricing | Call intelligence for every conversation",
  description:
    "Simple pricing for Sidetone. Free to start. Smooth Operator at $14/month. Premier Pro at $29/month. Teams can contact us for custom pricing.",
  alternates: {
    canonical: "/pricing"
  },
  openGraph: {
    title: "Sidetone pricing",
    description:
      "Plans for calls, meetings, and everything in between.",
    url: "/pricing",
    images: ["/opengraph-image"]
  },
  twitter: {
    card: "summary_large_image",
    title: "Sidetone pricing",
    description: "Plans for calls, meetings, and everything in between.",
    images: ["/twitter-image"]
  }
};

export default function PricingPage() {
  if (!billingEnabled()) redirectSelfHosted("/dashboard");
  return (
    <>
      <AppHeader active="pricing" />
      <main>
        <section className="mx-auto grid w-full max-w-7xl gap-6 px-4 pb-12 pt-10 md:px-6 md:pb-16 md:pt-16">
          <Badge variant="primary" className="w-fit">
            Pricing
          </Badge>
          <h1 className="roster-display max-w-5xl text-4xl leading-tight sm:text-5xl md:text-7xl md:leading-[0.92]">
            Plans for calls, meetings, and everything in between
          </h1>
        </section>

        <section
          className="mx-auto grid w-full max-w-7xl gap-5 px-4 pb-12 md:grid-cols-3 md:px-6 md:pb-16"
          aria-label="Sidetone pricing tiers"
        >
          {tiers.map((tier) => (
            <Card
              className={
                tier.highlight
                  ? "relative border-primary/60 shadow-electric"
                  : "relative"
              }
              key={tier.key}
            >
              <CardHeader className="gap-4 p-6 md:p-7">
                <div className="flex min-h-7 items-center justify-between gap-3">
                  <p className="roster-eyebrow text-primary">{tier.name}</p>
                  {tier.highlight ? (
                    <Badge variant="accent" className="shrink-0">
                      Most popular
                    </Badge>
                  ) : null}
                </div>
                <div className="flex items-end gap-2">
                  <CardTitle className="text-5xl leading-none md:text-7xl">
                    {tier.price}
                  </CardTitle>
                  <span className="pb-2 text-sm text-muted-foreground">
                    {tier.cadence}
                  </span>
                </div>
                <p className="roster-copy text-sm">{tier.blurb}</p>
              </CardHeader>
              <CardContent className="grid gap-3 px-6 pb-6 md:px-7 md:pb-7">
                <Button
                  asChild
                  size="lg"
                  variant={tier.highlight ? "default" : "secondary"}
                >
                  <a href={tier.cta.href}>
                    {tier.cta.label}
                    <ArrowRight className="size-4" />
                  </a>
                </Button>
              </CardContent>
            </Card>
          ))}
        </section>

        <section
          className="mx-auto w-full max-w-7xl px-4 pb-12 md:px-6 md:pb-16"
          aria-label="Sidetone plan comparison"
        >
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th
                      className="px-5 py-4 roster-eyebrow text-muted-foreground md:px-6"
                      scope="col"
                    >
                      Included
                    </th>
                    {tiers.map((tier) => (
                      <th className="px-5 py-4 md:px-6" key={tier.key} scope="col">
                        <div className="grid gap-1">
                          <span
                            className={
                              tier.highlight
                                ? "roster-eyebrow text-primary"
                                : "roster-eyebrow text-muted-foreground"
                            }
                          >
                            {tier.name}
                          </span>
                          <span className="text-sm text-foreground">
                            {tier.price}
                            <span className="text-muted-foreground"> / {tier.cadence}</span>
                          </span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr
                      className={
                        idx % 2 === 0
                          ? "border-b border-border/60 bg-card/40"
                          : "border-b border-border/60"
                      }
                      key={row.label}
                    >
                      <th className="px-5 py-4 align-top md:px-6 md:py-5" scope="row">
                        <div className="grid gap-1">
                          <span className="text-sm font-semibold text-foreground">
                            {row.label}
                          </span>
                          {row.helper ? (
                            <span className="text-xs leading-5 text-muted-foreground">
                              {row.helper}
                            </span>
                          ) : null}
                        </div>
                      </th>
                      {tiers.map((tier) => {
                        const value = row.values[tier.key];

                        return (
                          <td
                            className="px-5 py-4 align-top text-sm leading-6 md:px-6 md:py-5"
                            key={tier.key}
                          >
                            {value === null ? (
                              <span
                                aria-label="Not included"
                                className="inline-flex items-center gap-1.5 text-muted-foreground"
                              >
                                <Minus aria-hidden className="size-4" />
                                <span className="text-xs">not included</span>
                              </span>
                            ) : value === "Included" ? (
                              <span
                                aria-label="Included"
                                className="inline-flex items-center gap-1.5 text-success"
                              >
                                <Check aria-hidden className="size-4" />
                                <span>Included</span>
                              </span>
                            ) : (
                              <span className="text-foreground">{value}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>

        <section className="mx-auto w-full max-w-7xl px-4 pb-14 md:px-6 md:pb-20">
          <Card className="overflow-hidden">
            <div className="grid gap-4 p-5 md:grid-cols-[1fr_auto] md:items-center md:p-6">
              <div className="grid gap-2">
                <Badge variant="success" className="w-fit">
                  Teams
                </Badge>
                <h2 className="roster-display max-w-3xl text-3xl leading-tight md:text-5xl">
                  Contact us for custom pricing for your team
                </h2>
              </div>
              <Button asChild variant="accent">
                <a href="/support">
                  Contact us
                  <ArrowRight className="size-4" />
                </a>
              </Button>
            </div>
          </Card>
        </section>

        <section className="mx-auto w-full max-w-7xl px-4 pb-16 text-sm leading-6 text-muted-foreground md:px-6 md:pb-24">
          <p className="max-w-3xl">
            Overage is billed per minute at the rate shown, with usage visible in your
            dashboard. Sidetone listens only when you add it to a call, call through it,
            or open it before a meeting.
          </p>
        </section>
      </main>
    </>
  );
}
