import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { listPublicCredentials, saveCredential } from "@/lib/ai/credentials";
import { providerHealth } from "@/lib/ai/factory";
import { MODELS } from "@/lib/ai/registry";
import { isEncryptionConfigured } from "@/lib/security/crypto";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/services/audit";

const Schema = z.object({
  provider: z.enum(["openai"]),
  apiKey: z.string().min(8, "That does not look like a valid API key").max(400),
  label: z.string().max(80).optional(),
  baseUrl: z.string().url().max(300).optional().or(z.literal("")),
});

export const GET = apiHandler({ rateLimit: "read" }, async ({ user }) => ({
  // Only safe metadata. Keys are never returned in any form beyond last four.
  credentials: await listPublicCredentials(user.id),
  health: await providerHealth(user.id),
  encryptionConfigured: isEncryptionConfigured(),
  models: MODELS.filter((m) => m.provider !== "demo").map((m) => ({
    provider: m.provider,
    model: m.model,
    capability: m.capability,
    unit: m.unit,
    unitCostUsd: m.unitCostUsd,
    maxConcurrency: m.maxConcurrency,
  })),
}));

export const POST = apiHandler({ schema: Schema, rateLimit: "mutation" }, async ({ user, body }) => {
  if (!isEncryptionConfigured()) {
    throw new AppError("CONFIGURATION_ERROR", "Credentials cannot be stored because encryption is not configured on the server.");
  }
  const saved = await saveCredential({
    userId: user.id,
    provider: body.provider,
    apiKey: body.apiKey,
    label: body.label,
    baseUrl: body.baseUrl || null,
  });
  await audit({ userId: user.id, action: "credential.saved", targetType: "provider", targetId: body.provider });
  return saved;
});
