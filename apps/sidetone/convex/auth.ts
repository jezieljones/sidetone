import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

type AnyCtx = Pick<MutationCtx, "auth" | "db"> | Pick<QueryCtx, "auth" | "db">;

export async function requireAuthenticatedIdentity(ctx: AnyCtx) {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) {
    throw new Error("Authentication required.");
  }

  return identity;
}

export async function requireOwnedEntity(
  ctx: AnyCtx,
  entityId: Id<"entityProfiles">
): Promise<Doc<"entityProfiles">> {
  const identity = await requireAuthenticatedIdentity(ctx);
  const entity = await ctx.db.get(entityId);

  if (!entity) {
    throw new Error("Workspace not found.");
  }

  if (entity.ownerTokenIdentifier !== identity.tokenIdentifier) {
    throw new Error("You do not have access to this workspace.");
  }

  return entity;
}
