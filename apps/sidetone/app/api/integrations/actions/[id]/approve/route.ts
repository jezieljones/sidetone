import { featureEnabled } from "../../../../../lib/config";
import { auth } from "@clerk/nextjs/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../../../convex/_generated/api";
import { buildiumRequest, type BuildiumCredentials } from "../../../../../lib/buildium";
import { getConvexAuthToken } from "../../../../../lib/clerk-convex";
import { decryptIntegrationSecret } from "../../../../../lib/integration-secrets";

function buildiumWriteRequest(draft: {
  actionType: string;
  payloadJson: string;
}) {
  const payload = JSON.parse(draft.payloadJson) as Record<string, unknown>;
  const tenantId = typeof payload.tenantId === "number" || typeof payload.tenantId === "string" ? String(payload.tenantId) : "";
  const ownerId = typeof payload.ownerResourceId === "number" || typeof payload.ownerResourceId === "string" ? String(payload.ownerResourceId) : "";
  const body = payload.body && typeof payload.body === "object" ? payload.body : payload;

  if (draft.actionType === "tenant_note" && tenantId) {
    return { path: `/rentals/tenants/${encodeURIComponent(tenantId)}/notes`, body };
  }
  if (draft.actionType === "owner_note" && ownerId) {
    return { path: `/rentals/owners/${encodeURIComponent(ownerId)}/notes`, body };
  }
  if (draft.actionType === "association_owner_note" && ownerId) {
    return { path: `/associations/owners/${encodeURIComponent(ownerId)}/notes`, body };
  }
  if (draft.actionType === "maintenance_work_order") {
    return { path: "/maintenance/workorders", body };
  }
  if (draft.actionType === "maintenance_contact_request") {
    return { path: "/maintenance/tasks/contactrequests", body };
  }
  throw new Error("This Buildium draft needs a matched record before Sidetone can submit it.");
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const writesEnabled = process.env.SIDETONE_INTEGRATION_WRITES_ENABLED === "1"
    || process.env.SIDETONE_INTEGRATION_WRITES_ENABLED === "true";
  const { id } = await params;
  const token = await getConvexAuthToken();
  if (!writesEnabled) {
    await fetchMutation(api.entities.markIntegrationActionDraftStatus, {
      draftId: id as any,
      status: "blocked",
      error: "External integration writes are disabled for this environment."
    }, { token });
    return NextResponse.json({ error: "External integration writes are disabled." }, { status: 409 });
  }

  const payload = await fetchQuery(api.entities.integrationActionExecutionPayload, {
    draftId: id as any
  }, { token });
  if (!payload?.draft || !payload.connection) {
    return NextResponse.json({ error: "Integration action draft is not ready." }, { status: 404 });
  }
  if (payload.draft.integrationId !== "buildium" || payload.connection.integrationId !== "buildium") {
    return NextResponse.json({ error: "Only Buildium drafts can be approved in this pass." }, { status: 400 });
  }
  if (payload.connection.status !== "active" || !payload.connection.encryptedCredentials) {
    return NextResponse.json({ error: "Buildium is not connected." }, { status: 409 });
  }

  try {
    const credentials = decryptIntegrationSecret<BuildiumCredentials>(payload.connection.encryptedCredentials);
    const request = buildiumWriteRequest(payload.draft);
    const result = await buildiumRequest(credentials, request.path, {
      method: "POST",
      body: JSON.stringify(request.body)
    });
    await fetchMutation(api.entities.markIntegrationActionDraftStatus, {
      draftId: id as any,
      status: "sent",
      externalResultJson: JSON.stringify(result)
    }, { token });
    return NextResponse.json({ ok: true });
  } catch (err) {
    await fetchMutation(api.entities.markIntegrationActionDraftStatus, {
      draftId: id as any,
      status: "failed",
      error: err instanceof Error ? err.message : "Buildium write failed."
    }, { token });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Buildium write failed." }, { status: 502 });
  }
}
