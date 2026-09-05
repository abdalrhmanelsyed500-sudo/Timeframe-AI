import fs from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { loadEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { assertSafeStorageKey } from "@/lib/security/sanitize";

export interface StoredObject {
  key: string;
  bytes: number;
  mime: string;
}

export interface StorageAdapter {
  readonly name: string;
  put(key: string, data: Buffer, mime: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  stream(key: string, range?: { start: number; end: number }): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  size(key: string): Promise<number>;
  delete(key: string): Promise<void>;
  /** Absolute local path if the backend is filesystem-based (needed by FFmpeg). */
  localPath(key: string): string | null;
}

class LocalStorage implements StorageAdapter {
  readonly name = "local";
  constructor(private root: string) {}

  private resolve(key: string): string {
    assertSafeStorageKey(key);
    const full = path.resolve(this.root, key);
    const rootAbs = path.resolve(this.root);
    if (!full.startsWith(rootAbs + path.sep)) {
      throw new AppError("STORAGE_ERROR", "Refusing to access a path outside the storage root.");
    }
    return full;
  }

  async put(key: string, data: Buffer, mime: string): Promise<StoredObject> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.${process.pid}.tmp`;
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, full); // atomic publish — no partially written objects
    return { key, bytes: data.byteLength, mime };
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await fs.readFile(this.resolve(key));
    } catch (e) {
      throw new AppError("STORAGE_ERROR", "Stored file could not be read.", { context: { key }, cause: e });
    }
  }

  async stream(key: string, range?: { start: number; end: number }): Promise<Readable> {
    const full = this.resolve(key);
    if (!existsSync(full)) throw new AppError("STORAGE_ERROR", "Stored file is missing.", { context: { key } });
    return createReadStream(full, range);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async size(key: string): Promise<number> {
    const s = await fs.stat(this.resolve(key));
    return s.size;
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(key));
    } catch {
      /* already gone */
    }
  }

  localPath(key: string): string {
    return this.resolve(key);
  }
}

let adapter: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (adapter) return adapter;
  const env = loadEnv();
  if (env.STORAGE_PROVIDER === "s3") {
    // S3/R2/MinIO support is not implemented in this build.
    // Failing loudly is required: silently falling back to local storage would
    // create data that production believes is in object storage.
    throw new AppError(
      "CONFIGURATION_ERROR",
      "STORAGE_PROVIDER=s3 is not available in this build. Use STORAGE_PROVIDER=local.",
    );
  }
  adapter = new LocalStorage(path.resolve(process.cwd(), env.STORAGE_ROOT));
  return adapter;
}

/** Deterministic key layout: projectId/category/scope/contentHash.ext */
export function storageKey(parts: {
  projectId: string;
  category: "audio" | "assets" | "thumbs" | "renders" | "tmp";
  scope?: string;
  contentHash: string;
  ext: string;
}): string {
  const scope = parts.scope ? `${parts.scope}/` : "";
  const ext = parts.ext.replace(/^\./, "").toLowerCase();
  return `${parts.projectId}/${parts.category}/${scope}${parts.contentHash.slice(0, 32)}.${ext}`;
}
