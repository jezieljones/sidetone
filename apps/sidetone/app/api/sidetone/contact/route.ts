import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";
import { getConvexAuthToken } from "../../../lib/clerk-convex";

function vcardEscape(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const url = new URL(request.url);
  const entityId = url.searchParams.get("entityId");
  if (!entityId) {
    return NextResponse.json({ error: "Missing Sidetone workspace." }, { status: 400 });
  }

  const token = await getConvexAuthToken();
  const access = await fetchQuery(api.entities.ownedEntityAccess, { entityId: entityId as any }, { token });
  const number = access?.numberAssignment?.status === "active"
    ? access.numberAssignment.e164 ?? access.numberAssignment.phoneNumber
    : null;

  if (!number) {
    return NextResponse.json({ error: "Choose a Sidetone number before saving the contact." }, { status: 409 });
  }

  const contactName = "Sidetone Notes";
  const vcard = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${vcardEscape(contactName)}`,
    "N:Notes;Sidetone;;;",
    `TEL;TYPE=CELL:${number}`,
    "END:VCARD",
    ""
  ].join("\r\n");

  return new Response(vcard, {
    headers: {
      "content-type": "text/vcard; charset=utf-8",
      "content-disposition": "attachment; filename=\"sidetone-notes.vcf\"",
      "cache-control": "private, no-store"
    }
  });
}
