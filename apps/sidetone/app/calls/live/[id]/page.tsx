import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AppHeader } from "../../../components/AppHeader";
import { LiveCallRuntime } from "../../../components/LiveCallRuntime";

export default async function LiveCallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId } = await auth();

  if (id !== "demo" && !userId) {
    redirect(`/sign-in?redirect_url=${encodeURIComponent(`/calls/live/${id}`)}`);
  }

  return (
    <>
      <AppHeader active="calls" />
      <LiveCallRuntime callId={id} />
    </>
  );
}
