import { apiHandler } from "@/lib/api/handler";
import { deleteCredential } from "@/lib/ai/credentials";
import { audit } from "@/lib/services/audit";

export const DELETE = apiHandler({ rateLimit: "mutation" }, async ({ user, params }) => {
  await deleteCredential(user.id, params.provider);
  await audit({ userId: user.id, action: "credential.deleted", targetType: "provider", targetId: params.provider });
  return { deleted: true };
});
