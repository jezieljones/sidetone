import { billingEnabled } from "../lib/config";
import { redirect as redirectSelfHosted } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AppHeader } from "../components/AppHeader";
import { SubscriptionRuntime } from "../components/SubscriptionRuntime";

export default async function SubscriptionsPage({
  searchParams
}: {
  searchParams: Promise<{ plan?: string | string[]; checkout?: string | string[] }>;
}) {
  if (!billingEnabled()) redirectSelfHosted("/dashboard");
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in?redirect_url=/subscriptions");
  }

  const params = await searchParams;
  const plan = Array.isArray(params.plan) ? params.plan[0] : params.plan;
  const checkout = Array.isArray(params.checkout) ? params.checkout[0] : params.checkout;

  return (
    <>
      <AppHeader active="subscriptions" />
      <div className="theme-archive min-h-screen">
        <main className="mx-auto grid w-full max-w-7xl gap-6 px-4 pb-20 pt-6 md:px-6" id="main">
          <SubscriptionRuntime initialPlan={plan} checkoutState={checkout} />
        </main>
      </div>
    </>
  );
}
