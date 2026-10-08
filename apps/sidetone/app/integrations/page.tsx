import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AppHeader } from "../components/AppHeader";
import { IntegrationSettingsRuntime } from "../components/IntegrationSettingsRuntime";

export const metadata = {
  title: "Integrations · Sidetone",
  description: "Manage the business systems Sidetone can draft actions for."
};

export default async function IntegrationsPage({
  searchParams
}: {
  searchParams: Promise<{ integration?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in?redirect_url=/integrations");
  }
  const params = await searchParams;

  return (
    <>
      <AppHeader active="integrations" />
      <div className="theme-dashboard min-h-screen">
        <main className="mx-auto grid w-full max-w-5xl gap-6 px-4 pb-20 pt-6 md:px-6">
          <IntegrationSettingsRuntime selectedIntegration={params.integration} />
        </main>
      </div>
    </>
  );
}
