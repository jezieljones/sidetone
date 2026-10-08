import { clerkClient, currentUser } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";
import { hasAdminAccess, hasNotesLabAccess } from "../../../lib/admin-access";

export const dynamic = "force-dynamic";

function primaryEmail(user: Awaited<ReturnType<Awaited<ReturnType<typeof clerkClient>>["users"]["getUser"]>>) {
  return user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId)?.emailAddress
    ?? user.emailAddresses[0]?.emailAddress
    ?? null;
}

function primaryPhone(user: Awaited<ReturnType<Awaited<ReturnType<typeof clerkClient>>["users"]["getUser"]>>) {
  return user.phoneNumbers.find((phone) => phone.id === user.primaryPhoneNumberId)?.phoneNumber
    ?? user.phoneNumbers[0]?.phoneNumber
    ?? null;
}

function displayName(input: {
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  email: string | null;
  phone: string | null;
}) {
  return [input.firstName, input.lastName].filter(Boolean).join(" ")
    || input.username
    || input.email
    || input.phone
    || "Unnamed user";
}

export async function GET() {
  const requestingUser = await currentUser();
  if (!requestingUser) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (!hasAdminAccess(requestingUser)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  try {
    const client = await clerkClient();
    const [clerkUsers, appUsers] = await Promise.all([
      client.users.getUserList({ limit: 100, orderBy: "-created_at" }),
      process.env.SIDETONE_WORKER_TOKEN
        ? fetchQuery(api.admin.usersOverviewForWorker, {
            workerToken: process.env.SIDETONE_WORKER_TOKEN,
            limit: 200
          }).catch(() => [])
        : Promise.resolve([])
    ]);

    const appUsersByClerkId = new Map(
      appUsers
        .filter((user) => user.clerkUserId)
        .map((user) => [user.clerkUserId as string, user])
    );

    return NextResponse.json({
      fetchedAt: new Date().toISOString(),
      totalClerkUsers: clerkUsers.totalCount,
      users: clerkUsers.data.map((user) => {
        const email = primaryEmail(user);
        const phone = primaryPhone(user);
        const appUser = appUsersByClerkId.get(user.id) ?? null;

        return {
          id: user.id,
          name: displayName({
            firstName: user.firstName,
            lastName: user.lastName,
            username: user.username,
            email,
            phone
          }),
          email,
          phone,
          imageUrl: user.imageUrl,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          lastSignInAt: user.lastSignInAt,
          lastActiveAt: user.lastActiveAt,
          banned: user.banned,
          locked: user.locked,
          admin: hasAdminAccess(user),
          notesLab: hasNotesLabAccess(user),
          app: appUser
            ? {
                ownerTokenIdentifier: appUser.ownerTokenIdentifier,
                stripeCustomerAttached: appUser.stripeCustomerAttached,
                plan: appUser.plan,
                status: appUser.status,
                trialEnd: appUser.trialEnd,
                periodEnd: appUser.periodEnd,
                finalizedUsageSeconds: appUser.finalizedUsageSeconds,
                allowanceSeconds: appUser.allowanceSeconds,
                callCount: appUser.callCount,
                callCountIsTruncated: appUser.callCountIsTruncated,
                lastCallAt: appUser.lastCallAt,
                createdAt: appUser.createdAt,
                updatedAt: appUser.updatedAt
              }
            : null
        };
      })
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load admin users.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
