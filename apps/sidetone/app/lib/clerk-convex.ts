"use server";

import { auth } from "@clerk/nextjs/server";

export async function getConvexAuthToken() {
  const clerk = await auth();

  if (!clerk.userId) {
    throw new Error("Authentication required.");
  }

  const token = await clerk.getToken({ template: "convex" });

  if (!token) {
    throw new Error("Unable to mint Convex auth token.");
  }

  return token;
}
