import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AppHeader } from "../../components/AppHeader";
import { CallRecordRuntime } from "../../components/CallRecordRuntime";
import { hasNotesLabAccess } from "../../lib/notes-lab-access";

export default async function CallRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId } = await auth();

  if (!userId) {
    redirect(`/sign-in?redirect_url=${encodeURIComponent(`/calls/${id}`)}`);
  }

  const user = await currentUser();
  const notesLabEnabled = hasNotesLabAccess(user);

  return (
    <>
      <AppHeader active="calls" />
      <div className="theme-archive min-h-screen">
        <CallRecordRuntime callSessionId={id} notesLabEnabled={notesLabEnabled} />
      </div>
    </>
  );
}
