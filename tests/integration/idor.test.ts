import "../helpers/env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupUser, dbAvailable, makeProject, makeUser } from "../helpers/fixtures";
import { archiveProject, deleteProject, listProjects, requireProject, updateProject } from "@/lib/services/projects";
import { getAudio } from "@/lib/services/audio";
import { getTranscript } from "@/lib/services/transcript";
import { latestStoryPlan } from "@/lib/services/story";
import { latestTimeline } from "@/lib/services/timeline";
import { getRender } from "@/lib/services/render";
import { AppError } from "@/lib/errors";
import { saveCredential, getPublicCredential, listPublicCredentials, resolveSecret } from "@/lib/ai/credentials";
import { costSummary } from "@/lib/services/cost";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
if (!available) console.warn("SKIPPED: integration/idor — PostgreSQL is not reachable at DATABASE_URL.");

d("cross-tenant isolation (real PostgreSQL)", () => {
  let alice: { id: string; email: string };
  let bob: { id: string; email: string };
  let aliceProject: string;

  beforeAll(async () => {
    alice = await makeUser("alice");
    bob = await makeUser("bob");
    aliceProject = (await makeProject(alice.id, "Alice's documentary")).id;
  });

  afterAll(async () => {
    if (alice) await cleanupUser(alice.id);
    if (bob) await cleanupUser(bob.id);
  });

  it("lets the owner load their own project", async () => {
    const p = await requireProject(aliceProject, alice.id);
    expect(p.name).toBe("Alice's documentary");
  });

  it("denies a non-owner and does not confirm the project exists", async () => {
    const err = await requireProject(aliceProject, bob.id).catch((e) => e as AppError);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("NOT_FOUND");
    // Identical to a genuinely missing id — no existence oracle.
    const missing = await requireProject("prj_does_not_exist", bob.id).catch((e) => e as AppError);
    expect((err as AppError).message).toBe((missing as AppError).message);
  });

  it("keeps another user's project out of the list", async () => {
    const list = await listProjects(bob.id);
    expect(list.items.some((p) => p.id === aliceProject)).toBe(false);
  });

  it("refuses cross-tenant mutation, archival and deletion", async () => {
    await expect(updateProject(aliceProject, bob.id, { name: "hijacked" })).rejects.toThrowError(AppError);
    await expect(archiveProject(aliceProject, bob.id, true)).rejects.toThrowError(AppError);
    await expect(deleteProject(aliceProject, bob.id)).rejects.toThrowError(AppError);
    // Still intact and owned by Alice.
    expect((await requireProject(aliceProject, alice.id)).name).toBe("Alice's documentary");
  });

  it("scopes every child resource lookup to the project", async () => {
    const bobProject = (await makeProject(bob.id, "Bob's film")).id;
    expect(await getAudio(bobProject)).toBeNull();
    expect(await getTranscript(bobProject)).toBeNull();
    expect(await latestStoryPlan(bobProject)).toBeNull();
    expect(await latestTimeline(bobProject)).toBeNull();
    // A render id from another project must not resolve here.
    expect(await getRender("rnd_from_elsewhere", bobProject)).toBeNull();
  });

  it("scopes cost accounting per user", async () => {
    const summary = await costSummary(bob.id);
    expect(summary.todayUsd).toBe(0);
    expect(summary.totalUsd).toBe(0);
    expect(summary.operations).toBe(0);
  });
});

d("credential storage (real PostgreSQL)", () => {
  let user: { id: string; email: string };
  let other: { id: string; email: string };
  const secret = "sk-test-abcdefghijklmnop1234567890";

  beforeAll(async () => {
    user = await makeUser("cred");
    other = await makeUser("cred-other");
    await saveCredential({ userId: user.id, provider: "openai", apiKey: secret });
  });

  afterAll(async () => {
    if (user) await cleanupUser(user.id);
    if (other) await cleanupUser(other.id);
  });

  it("never exposes the key in the public view", async () => {
    const pub = await getPublicCredential(user.id, "openai");
    expect(pub).not.toBeNull();
    expect(JSON.stringify(pub)).not.toContain(secret);
    expect(pub!.lastFour).toBe(secret.slice(-4));
  });

  it("stores the key encrypted, not as plaintext", async () => {
    const { db, dbGuard } = await import("@/lib/db");
    const row = await dbGuard(() =>
      db.selectFrom("provider_credentials").selectAll().where("user_id", "=", user.id).executeTakeFirstOrThrow(),
    );
    const blob = JSON.stringify(row);
    expect(blob).not.toContain(secret);
    expect(blob).not.toContain("sk-test-abcdefghijklmnop");
  });

  it("decrypts back to the exact original for the owner", async () => {
    const resolved = await resolveSecret(user.id, "openai");
    expect(resolved?.apiKey).toBe(secret);
  });

  it("never resolves another user's credential", async () => {
    expect(await resolveSecret(other.id, "openai")).toBeNull();
    expect(await getPublicCredential(other.id, "openai")).toBeNull();
    expect(await listPublicCredentials(other.id)).toHaveLength(0);
  });
});
