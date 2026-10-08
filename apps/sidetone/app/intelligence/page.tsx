import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AppHeader } from "../components/AppHeader";
import { CallIntelligenceWorkspace } from "../components/CallIntelligenceWorkspace";

export default async function IntelligencePage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in?redirect_url=/intelligence");
  }

  return (
    <>
      <AppHeader active="intelligence" />
      <div className="theme-archive min-h-screen">
        <main className="mx-auto grid w-full max-w-7xl gap-6 px-4 pb-20 pt-6 md:px-6" id="main">
          <CallIntelligenceWorkspace />
        </main>
      </div>
    </>
  );
}
