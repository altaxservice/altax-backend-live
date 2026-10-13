import { AuthedRequest } from "../../common/requireAuth";
import { canAccessClient } from "../../common/assignment";

/** A document with no client belongs to whoever made it (and to admins); otherwise the usual client access rules apply. */
export async function canAccessDoc(req: AuthedRequest, clientId: string | null, createdBy: string | null): Promise<boolean> {
  if (!clientId) return req.user!.role === "admin" || String(createdBy || "").toLowerCase() === req.user!.email.toLowerCase();
  return canAccessClient(req.user!, clientId);
}
