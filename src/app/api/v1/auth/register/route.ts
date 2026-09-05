import { z } from "zod";
import { db, dbGuard } from "@/lib/db";
import { newId } from "@/lib/core/ids";
import { AppError } from "@/lib/errors";
import { apiHandler } from "@/lib/api/handler";
import { hashPassword, startSession } from "@/lib/security/auth";
import { audit } from "@/lib/services/audit";
import { cleanText } from "@/lib/security/sanitize";

const Schema = z.object({
  name: z.string().min(1, "Please enter your name").max(120),
  email: z.string().email("Please enter a valid email address").max(200),
  password: z.string().min(10, "Use at least 10 characters").max(200),
});

export const POST = apiHandler({ auth: false, csrf: false, schema: Schema, rateLimit: "register" }, async ({ body }) => {
  const email = body.email.trim().toLowerCase();
  const existing = await dbGuard(() => db.selectFrom("users").select(["id"]).where("email", "=", email).executeTakeFirst());
  if (existing) throw new AppError("CONFLICT", "An account with that email already exists.");

  const id = newId("usr");
  const name = cleanText(body.name, 120);
  const passwordHash = await hashPassword(body.password);
  await dbGuard(() =>
    db
      .insertInto("users")
      .values({ id, email, name, password_hash: passwordHash, role: "USER" })
      .execute(),
  );
  await startSession(id);
  await audit({ userId: id, action: "user.registered" });
  return { id, email, name };
});
