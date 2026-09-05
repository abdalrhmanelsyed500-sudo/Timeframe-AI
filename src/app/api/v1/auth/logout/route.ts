import { apiHandler } from "@/lib/api/handler";
import { endSession } from "@/lib/security/auth";

export const POST = apiHandler({ auth: false, csrf: false }, async () => {
  await endSession();
  return { ok: true };
});
