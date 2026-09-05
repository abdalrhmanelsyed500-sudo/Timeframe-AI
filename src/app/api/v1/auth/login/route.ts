import { z } from "zod";
import { db, dbGuard } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiHandler } from "@/lib/api/handler";
import { startSession, verifyPassword } from "@/lib/security/auth";
import { audit } from "@/lib/services/audit";

const Schema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

export const POST = apiHandler({ auth: false, csrf: false, schema: Schema, rateLimit: "login" }, async ({ body }) => {
  const email = body.email.trim().toLowerCase();
  const user = await dbGuard(() =>
    db.selectFrom("users").select(["id", "email", "name", "password_hash"]).where("email", "=", email).executeTakeFirst(),
  );
  // Identical message for unknown email and wrong password: no user enumeration.
  const invalid = new AppError("AUTH_ERROR", "That email or password is not correct.");
  if (!user) {
    await verifyPassword(body.password, "$2b$12$0000000000000000000000000000000000000000000000000000");
    throw invalid;
  }
  if (!(await verifyPassword(body.password, user.password_hash))) throw invalid;

  await startSession(user.id);
  await audit({ userId: user.id, action: "user.login" });
  return { id: user.id, email: user.email, name: user.name };
});
