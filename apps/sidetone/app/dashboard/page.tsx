import { featureEnabled } from "../lib/config";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AppHeader } from "../components/AppHeader";
import { SidetoneConsole } from "../components/SidetoneConsole";
import { hasAdminAccess } from "../lib/admin-access";

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in?redirect_url=/dashboard");
  }
  const user = await currentUser();
  const isAdmin = hasAdminAccess(user);

  return (
    <>
      <AppHeader active="dashboard" />
      <div className="theme-dashboard min-h-screen">
        <main id="main" className="mx-auto grid w-full max-w-7xl gap-6 px-4 pb-20 pt-6 md:px-6">
          <SidetoneConsole phoneEnabled={featureEnabled("phone")} meetingSourcesEnabled={isAdmin && (featureEnabled("zoom") || featureEnabled("vexa"))} />
        </main>
      </div>
    </>
  );
}
