import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AppHeader } from "../../../components/AppHeader";
import { IntegrationActionReviewRuntime } from "../../../components/IntegrationActionReviewRuntime";

export const metadata = {
  title: "Integration draft · Sidetone",
  description: "Review an approval-gated integration draft."
};

export default async function IntegrationActionPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { userId } = await auth();
  const { id } = await params;
  if (!userId) {
    redirect(`/sign-in?redirect_url=/integrations/actions/${id}`);
  }

  return (
    <>
      <AppHeader active="integrations" />
      <div className="theme-dashboard min-h-screen">
        <main className="mx-auto grid w-full max-w-5xl gap-6 px-4 pb-20 pt-6 md:px-6">
          <IntegrationActionReviewRuntime draftId={id} />
        </main>
      </div>
    </>
  );
}
