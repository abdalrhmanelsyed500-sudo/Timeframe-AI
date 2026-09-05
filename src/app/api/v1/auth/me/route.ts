import { apiHandler } from "@/lib/api/handler";
import { getCurrentUser } from "@/lib/security/auth";

export const GET = apiHandler({ auth: false }, async () => {
  const user = await getCurrentUser();
  return { user };
});
