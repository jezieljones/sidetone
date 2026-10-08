import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AppHeader } from "../components/AppHeader";
import { CallArchiveRuntime } from "../components/CallArchiveRuntime";

export const metadata = {
  title: "All calls · Sidetone",
  description: "Every call Sidetone has joined, with summaries and recordings."
};

export default async function CallsPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in?redirect_url=/calls");
  }

  return (
    <>
      <AppHeader active="calls" />
      <div className="theme-archive min-h-screen">
        <main className="mx-auto grid w-full max-w-7xl gap-6 px-4 pb-20 pt-6 md:px-6" id="main">
          <CallArchiveRuntime />
        </main>
      </div>
    </>
  );
}
