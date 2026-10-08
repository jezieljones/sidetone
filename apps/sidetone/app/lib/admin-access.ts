import { currentUser } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";

type SidetonePrivateMetadata = {
  admin?: unknown;
  sidetone?: {
    notesLab?: unknown;
  };
};

export function hasAdminAccess(user: { privateMetadata?: unknown } | null | undefined) {
  const metadata = user?.privateMetadata as SidetonePrivateMetadata | undefined;
  return metadata?.admin === true;
}

export function hasNotesLabAccess(user: { privateMetadata?: unknown } | null | undefined) {
  const metadata = user?.privateMetadata as SidetonePrivateMetadata | undefined;
  return metadata?.sidetone?.notesLab === true;
}

export async function requireAdminUser(redirectPath = "/admin") {
  const user = await currentUser();

  if (!user) {
    redirect(`/sign-in?redirect_url=${encodeURIComponent(redirectPath)}`);
  }

  if (!hasAdminAccess(user)) {
    notFound();
  }

  return user;
}
