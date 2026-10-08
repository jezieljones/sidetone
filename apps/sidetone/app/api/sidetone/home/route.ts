import { auth, currentUser } from "@clerk/nextjs/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";
import { getConvexAuthToken } from "../../../lib/clerk-convex";

function normalizePhone(input?: string | null) {
  if (!input) {
    return undefined;
  }

  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  return input.trim() || undefined;
}

function normalizeTimeZone(input?: string | null) {
  const value = input?.trim();
  if (!value) {
    return undefined;
  }

  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(new Date());
    return value;
  } catch {
    return undefined;
  }
}

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const timezone = normalizeTimeZone(url.searchParams.get("timezone"));
    const token = await getConvexAuthToken();
    const user = await currentUser();
    const ownerPhoneNumber = normalizePhone(user?.primaryPhoneNumber?.phoneNumber);
    await fetchMutation(api.billing.ensureTrialForAuthenticatedOwner, { clerkUserId: userId }, { token });
    let home = await fetchQuery(api.entities.ownerHome, {}, { token });

    if (!home.workspaces.length) {
      await fetchMutation(
        api.entities.ensureDefaultEntity,
        {
          name: "My Sidetone",
          ownerPhoneNumber,
          timezone,
          defaultIndustryProfile: "general"
        },
        { token }
      );
      home = await fetchQuery(api.entities.ownerHome, {}, { token });
    } else if (ownerPhoneNumber || timezone) {
      await Promise.all(
        home.workspaces.map((workspace: any) =>
          fetchMutation(
            api.entities.syncOwnerPhoneNumber,
            {
              entityId: workspace.entity._id,
              ownerPhoneNumber,
              timezone
            },
            { token }
          )
        )
      );
      home = await fetchQuery(api.entities.ownerHome, {}, { token });
    }

    return NextResponse.json(home);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load Sidetone workspace." },
      { status: 500 }
    );
  }
}
