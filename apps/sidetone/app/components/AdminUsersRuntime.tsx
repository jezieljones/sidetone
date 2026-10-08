"use client";

import { RefreshCw, ShieldCheck, UserRound, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "./ui/button";

type SidetoneAppUser = {
  ownerTokenIdentifier: string;
  stripeCustomerAttached: boolean;
  plan: string | null;
  status: string | null;
  trialEnd: number | null;
  periodEnd: number | null;
  finalizedUsageSeconds: number;
  allowanceSeconds: number;
  callCount: number;
  callCountIsTruncated: boolean;
  lastCallAt: number | null;
  createdAt: number;
  updatedAt: number;
};

type AdminUser = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  imageUrl: string;
  createdAt: number;
  updatedAt: number;
  lastSignInAt: number | null;
  lastActiveAt: number | null;
  banned: boolean;
  locked: boolean;
  admin: boolean;
  notesLab: boolean;
  app: SidetoneAppUser | null;
};

type AdminUsersResponse = {
  fetchedAt: string;
  totalClerkUsers: number;
  users: AdminUser[];
};

function formatDate(value: number | string | null | undefined) {
  if (!value) {
    return "Never";
  }

  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatPlan(plan: string | null, status: string | null) {
  if (!plan && !status) {
    return "Not initialized";
  }

  const label = (plan ?? "unknown").replace(/_/g, " ");
  return status ? `${label} - ${status}` : label;
}

function formatMinutes(seconds: number) {
  return Math.ceil(seconds / 60).toLocaleString();
}

export function AdminUsersRuntime() {
  const [data, setData] = useState<AdminUsersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function loadUsers({ quiet = false } = {}) {
    if (quiet) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const response = await fetch("/api/admin/users", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to load users.");
      }
      setData(payload);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to load users.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void loadUsers();
    }, 0);
    const interval = window.setInterval(() => {
      void loadUsers({ quiet: true });
    }, 15000);

    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, []);

  const initializedUsers = useMemo(
    () => data?.users.filter((user) => user.app).length ?? 0,
    [data]
  );

  if (isLoading && !data) {
    return (
      <section className="enamel-panel grid gap-4 p-6 md:p-8" aria-live="polite">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-amber-400">Loading</p>
        <p className="text-2xl font-semibold text-foreground">Fetching Clerk users.</p>
      </section>
    );
  }

  return (
    <section className="grid gap-5">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="enamel-panel p-5">
          <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-amber-400">
            <Users className="size-4" aria-hidden="true" />
            Clerk users
          </p>
          <p className="mt-3 text-4xl font-bold text-foreground">{data?.totalClerkUsers ?? 0}</p>
        </div>
        <div className="enamel-panel p-5">
          <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-amber-400">
            <UserRound className="size-4" aria-hidden="true" />
            Initialized
          </p>
          <p className="mt-3 text-4xl font-bold text-foreground">{initializedUsers}</p>
        </div>
        <div className="enamel-panel flex flex-col justify-between gap-4 p-5">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-400">Updated</p>
            <p className="mt-3 text-xl font-semibold text-foreground">{formatDate(data?.fetchedAt)}</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void loadUsers({ quiet: true })}
            disabled={isRefreshing}
          >
            <RefreshCw className={isRefreshing ? "size-4 animate-spin" : "size-4"} aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </div>

      {error ? (
        <div className="enamel-panel border-crimson-400/60 p-5 text-crimson-100" role="alert">
          {error}
        </div>
      ) : null}

      <div className="enamel-panel overflow-hidden">
        <div className="border-b border-cream-200/40 px-5 py-4 md:px-6">
          <h2 className="text-xl font-semibold text-foreground">Users</h2>
          <p className="mt-1 text-sm text-muted-foreground">Auto-refreshes every 15 seconds.</p>
        </div>

        {data?.users.length ? (
          <div className="divide-y divide-cream-200/30">
            {data.users.map((user) => (
              <article key={user.id} className="grid gap-4 p-5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] md:items-center md:p-6">
                <div className="flex min-w-0 items-center gap-4">
                  <div
                    aria-hidden="true"
                    className="flex size-12 shrink-0 items-center justify-center rounded-md border border-cream-200/40 bg-cream-100/10 text-base font-semibold text-foreground"
                  >
                    {user.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-lg font-semibold text-foreground">{user.name}</h3>
                      {user.admin ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-amber-400/70 px-2 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">
                          <ShieldCheck className="size-3" aria-hidden="true" />
                          Admin
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate text-sm text-muted-foreground">{user.email ?? user.phone ?? user.id}</p>
                    {user.email && user.phone ? (
                      <p className="mt-1 text-sm text-muted-foreground">{user.phone}</p>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-1 text-sm text-muted-foreground">
                  <p>
                    <span className="font-semibold text-foreground">Joined:</span> {formatDate(user.createdAt)}
                  </p>
                  <p>
                    <span className="font-semibold text-foreground">Last sign-in:</span> {formatDate(user.lastSignInAt)}
                  </p>
                  <p>
                    <span className="font-semibold text-foreground">Sidetone:</span> {formatPlan(user.app?.plan ?? null, user.app?.status ?? null)}
                  </p>
                </div>

                <div className="grid gap-1 text-sm text-muted-foreground md:text-right">
                  <p className="font-semibold text-foreground">
                    {user.app ? `${user.app.callCount}${user.app.callCountIsTruncated ? "+" : ""} calls` : "No app activity"}
                  </p>
                  <p>{user.app ? `${formatMinutes(user.app.finalizedUsageSeconds)} min used` : "No billing row yet"}</p>
                  <p>{user.notesLab ? "Notes lab enabled" : "Notes lab off"}</p>
                  {user.locked || user.banned ? (
                    <p className="font-semibold text-crimson-100">{user.locked ? "Locked" : "Banned"}</p>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="p-6 text-muted-foreground">No Clerk users found.</div>
        )}
      </div>
    </section>
  );
}
