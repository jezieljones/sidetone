import { featureEnabled } from "../../../../lib/config";
import { auth } from "@clerk/nextjs/server";
import { fetchMutation } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../../convex/_generated/api";
import { BuildiumError, normalizeBuildiumCredentials, testBuildiumConnection } from "../../../../lib/buildium";
import { getConvexAuthToken } from "../../../../lib/clerk-convex";
import { encryptIntegrationSecret } from "../../../../lib/integration-secrets";

export async function POST(request: Request) {
  if (!featureEnabled("integrations")) return Response.json({ error: "This feature is disabled for this installation." }, { status: 404 });
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const entityId = String(body?.entityId ?? "");
  if (!entityId) {
    return NextResponse.json({ error: "Missing Sidetone workspace." }, { status: 400 });
  }

  let credentials;
  try {
    credentials = normalizeBuildiumCredentials({
      environment: body?.environment,
      clientId: body?.clientId,
      clientSecret: body?.clientSecret
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid Buildium credentials." }, { status: 400 });
  }

  const token = await getConvexAuthToken();
  const encryptedCredentials = encryptIntegrationSecret(credentials);
  try {
    await testBuildiumConnection(credentials);
    const result = await fetchMutation(api.entities.upsertIntegrationConnection, {
      entityId: entityId as any,
      integrationId: "buildium",
      status: "active",
      environment: credentials.environment,
      displayName: "Buildium",
      encryptedCredentials,
      failureReason: undefined
    }, { token });
    return NextResponse.json({ ok: true, status: "active", connectionId: result.connectionId });
  } catch (err) {
    if (err instanceof BuildiumError && err.status === 403) {
      const result = await fetchMutation(api.entities.upsertIntegrationConnection, {
        entityId: entityId as any,
        integrationId: "buildium",
        status: "needs_attention",
        environment: credentials.environment,
        displayName: "Buildium",
        encryptedCredentials,
        failureReason: "Buildium accepted the key but it is missing at least one required permission."
      }, { token });
      return NextResponse.json({
        ok: true,
        status: "needs_attention",
        connectionId: result.connectionId,
        warning: "Buildium connected, but the API key needs additional permissions."
      });
    }

    const status = err instanceof BuildiumError && err.status === 401 ? 401 : 502;
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Buildium connection test failed."
    }, { status });
  }
}
