"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, RefreshCcw } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

type BoundaryError = Error & {
  digest?: string;
};

export function FriendlyErrorFallback({
  error,
  reset,
  homeHref = "/dashboard",
  homeLabel = "Back to dashboard"
}: {
  error?: BoundaryError;
  reset?: () => void;
  homeHref?: string;
  homeLabel?: string;
}) {
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  useEffect(() => {
    try {
      setShowDiagnostics(
        process.env.NODE_ENV !== "production" ||
          window.localStorage.getItem("sidetone:show-diagnostics") === "true"
      );
    } catch {
      setShowDiagnostics(process.env.NODE_ENV !== "production");
    }
  }, []);

  useEffect(() => {
    if (error) {
      console.error(error);
    }
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl items-center px-4 py-10 md:px-6">
      <Card className="w-full">
        <CardHeader className="gap-5 p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Badge variant="warning">Sidetone</Badge>
            <div className="flex size-11 items-center justify-center rounded-md border border-warning/70 bg-[#122742] text-warning">
              <AlertTriangle className="size-5" />
            </div>
          </div>
          <div className="grid gap-3">
            <CardTitle className="max-w-2xl text-4xl font-semibold md:text-5xl">
              Something got interrupted.
            </CardTitle>
            <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
              Try again in a moment. If this keeps happening, return to your dashboard and reopen the call.
            </p>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5 px-6 pb-6 md:px-8 md:pb-8">
          <div className="flex flex-wrap gap-3">
            {reset ? (
              <Button onClick={reset}>
                <RefreshCcw className="size-4" />
                Try again
              </Button>
            ) : (
              <Button onClick={() => window.location.reload()} type="button">
                <RefreshCcw className="size-4" />
                Refresh page
              </Button>
            )}
            <Button asChild variant="ghost">
              <a href={homeHref}>
                <ArrowLeft className="size-4" />
                {homeLabel}
              </a>
            </Button>
          </div>
          {showDiagnostics && error ? (
            <details className="rounded-lg border border-border bg-background/70 p-4 text-sm leading-6 text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">
                Diagnostic details
              </summary>
              <p className="mt-3 break-words">{error.message}</p>
              {error.digest ? (
                <p className="mt-2 break-words font-mono text-xs">digest: {error.digest}</p>
              ) : null}
            </details>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
