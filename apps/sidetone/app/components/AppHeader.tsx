import { UserButton } from "@clerk/nextjs";
import { auth, currentUser } from "@clerk/nextjs/server";
import { hasAdminAccess } from "../lib/admin-access";
import { billingEnabled, featureEnabled } from "../lib/config";
import { BrandLockup } from "./BrandMark";

export async function AppHeader({ active = "home" }: { active?: string }) {
  const configured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
  const { userId } = configured ? await auth() : { userId: null };
  const admin = userId ? hasAdminAccess(await currentUser()) : false;
  const links = userId ? [
    { href: "/dashboard", label: "Dashboard", key: "dashboard" },
    { href: "/calls", label: "Recordings", key: "calls" },
    { href: "/intelligence", label: "Intelligence", key: "intelligence" },
    ...(admin && ["zoom", "vexa", "discord"].some(f => featureEnabled(f as "zoom" | "vexa" | "discord")) ? [{ href: "/sources", label: "Sources", key: "sources" }] : []),
    ...(billingEnabled() ? [{ href: "/subscriptions", label: "Subscription", key: "subscriptions" }] : [])
  ] : [{ href: "/docs", label: "Guide", key: "docs" }, { href: configured ? "/sign-in" : "/setup", label: configured ? "Sign in" : "Set up", key: "sign-in" }];
  return <header className="border-b border-border"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 md:px-6"><a href="/" aria-label="Sidetone home"><BrandLockup /></a><nav aria-label="Main navigation" className="flex flex-wrap items-center gap-4">{links.map(link => <a key={link.key} href={link.href} aria-current={active === link.key ? "page" : undefined} className={active === link.key ? "font-semibold text-primary" : "text-sm text-muted-foreground hover:text-foreground"}>{link.label}</a>)}{userId ? <UserButton /> : null}</nav></div></header>;
}
