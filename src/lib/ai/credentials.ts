import { iso } from "@/lib/core/dates";
import { db, dbGuard } from "@/lib/db";
import { newId } from "@/lib/core/ids";
import { lastFour, open, seal } from "@/lib/security/crypto";
import { AppError } from "@/lib/errors";

/**
 * Provider credentials never leave the server in plaintext.
 * Only the last four characters are ever exposed.
 */
export interface PublicCredential {
  id: string;
  provider: string;
  label: string;
  lastFour: string;
  baseUrl: string | null;
  enabled: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastErrorCategory: string | null;
}

export async function saveCredential(params: {
  userId: string;
  provider: string;
  apiKey: string;
  label?: string;
  baseUrl?: string | null;
}): Promise<PublicCredential> {
  const sealed = seal(params.apiKey);
  const row = {
    id: newId("cred"),
    user_id: params.userId,
    provider: params.provider,
    label: params.label ?? params.provider,
    ciphertext: sealed.ciphertext,
    iv: sealed.iv,
    auth_tag: sealed.authTag,
    key_version: sealed.keyVersion,
    last_four: lastFour(params.apiKey),
    base_url: params.baseUrl ?? null,
    enabled: true,
  };
  await dbGuard(() =>
    db
      .insertInto("provider_credentials")
      .values(row)
      .onConflict((oc) =>
        oc.columns(["user_id", "provider"]).doUpdateSet({
          ciphertext: row.ciphertext,
          iv: row.iv,
          auth_tag: row.auth_tag,
          key_version: row.key_version,
          last_four: row.last_four,
          base_url: row.base_url,
          label: row.label,
          enabled: true,
          last_error: null,
        }),
      )
      .execute(),
  );
  const saved = await getPublicCredential(params.userId, params.provider);
  if (!saved) throw new AppError("INTERNAL_ERROR", "Credential could not be saved.");
  return saved;
}

export async function getPublicCredential(userId: string, provider: string): Promise<PublicCredential | null> {
  const row = await dbGuard(() =>
    db
      .selectFrom("provider_credentials")
      .selectAll()
      .where("user_id", "=", userId)
      .where("provider", "=", provider)
      .executeTakeFirst(),
  );
  return row ? toPublic(row) : null;
}

export async function listPublicCredentials(userId: string): Promise<PublicCredential[]> {
  const rows = await dbGuard(() =>
    db.selectFrom("provider_credentials").selectAll().where("user_id", "=", userId).orderBy("provider").execute(),
  );
  return rows.map(toPublic);
}

function toPublic(row: {
  id: string;
  provider: string;
  label: string;
  last_four: string;
  base_url: string | null;
  enabled: boolean;
  last_success_at: Date | null;
  last_failure_at: Date | null;
  last_error: string | null;
}): PublicCredential {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    lastFour: row.last_four,
    baseUrl: row.base_url,
    enabled: row.enabled,
    lastSuccessAt: row.last_success_at ? iso(row.last_success_at) : null,
    lastFailureAt: row.last_failure_at ? iso(row.last_failure_at) : null,
    lastErrorCategory: row.last_error,
  };
}

/** Server-only. The decrypted key must stay within the calling scope. */
export async function resolveSecret(userId: string, provider: string): Promise<{ apiKey: string; baseUrl: string | null } | null> {
  const row = await dbGuard(() =>
    db
      .selectFrom("provider_credentials")
      .select(["ciphertext", "iv", "auth_tag", "key_version", "base_url", "enabled"])
      .where("user_id", "=", userId)
      .where("provider", "=", provider)
      .executeTakeFirst(),
  );
  if (!row || !row.enabled) return null;
  const apiKey = open({
    ciphertext: row.ciphertext,
    iv: row.iv,
    authTag: row.auth_tag,
    keyVersion: row.key_version,
  });
  return { apiKey, baseUrl: row.base_url };
}

export async function deleteCredential(userId: string, provider: string): Promise<void> {
  await dbGuard(() =>
    db.deleteFrom("provider_credentials").where("user_id", "=", userId).where("provider", "=", provider).execute(),
  );
}

export async function recordProviderOutcome(
  userId: string,
  provider: string,
  outcome: { ok: boolean; errorCategory?: string },
): Promise<void> {
  await dbGuard(() =>
    db
      .updateTable("provider_credentials")
      .set(
        outcome.ok
          ? { last_success_at: new Date(), last_error: null }
          : { last_failure_at: new Date(), last_error: outcome.errorCategory ?? "PROVIDER_ERROR" },
      )
      .where("user_id", "=", userId)
      .where("provider", "=", provider)
      .execute(),
  );
}
