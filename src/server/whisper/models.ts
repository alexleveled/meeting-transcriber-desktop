import "server-only";
import { createWriteStream, existsSync, mkdirSync, rmSync, statSync, statfsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { env } from "../env";
import { MODELS } from "../settings";

/**
 * Local Whisper model registry + download-on-demand.
 *
 * Models are ggml files served from huggingface.co/ggerganov/whisper.cpp. They are large
 * (hundreds of MB) so they are NOT shipped in the installer — the user downloads the one they
 * want into `env.modelsDir` (userData/models in the packaged app). Download progress is tracked
 * in a module-level map so GET /api/local-whisper/models can report a live percentage.
 */

export interface ModelInfo {
  /** ggml filename, e.g. "ggml-small.en.bin" — matches MODELS.local and the settings model value. */
  file: string;
  url: string;
  /** Approximate size in bytes, for the disk-space hint before a download starts. */
  approxBytes: number;
}

const HF_BASE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

const REGISTRY: Record<string, ModelInfo> = {
  "ggml-small.en.bin": {
    file: "ggml-small.en.bin",
    url: `${HF_BASE}/ggml-small.en.bin`,
    approxBytes: 488_000_000, // ~466 MiB
  },
};

export function knownModels(): ModelInfo[] {
  // Only surface models declared in the settings enum, in that order.
  return MODELS.local.map((f) => REGISTRY[f]).filter(Boolean);
}

export function isKnownModel(file: string): boolean {
  return file in REGISTRY && MODELS.local.includes(file);
}

function modelsDir(): string {
  const dir = resolve(process.cwd(), env.modelsDir);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function modelPath(file: string): string {
  return join(modelsDir(), file);
}

export function isDownloaded(file: string): boolean {
  const p = modelPath(file);
  if (!existsSync(p)) return false;
  // A leftover empty/partial file shouldn't count as downloaded.
  try {
    return statSync(p).size > 1_000_000;
  } catch {
    return false;
  }
}

// ---- download progress tracking -------------------------------------------

interface DownloadState {
  receivedBytes: number;
  totalBytes: number;
  error?: string;
}

const downloads = new Map<string, DownloadState>();

export function downloadState(file: string): DownloadState | null {
  return downloads.get(file) ?? null;
}

/** Free bytes on the volume backing the models dir (best-effort; 0 if unavailable). */
export function freeDiskBytes(): number {
  try {
    const s = statfsSync(modelsDir());
    return s.bavail * s.bsize;
  } catch {
    return 0;
  }
}

/**
 * Begin (or no-op if already running/complete) downloading a model. Streams to a `.part` file and
 * atomically renames on success. Returns immediately; poll downloadState()/isDownloaded() for
 * progress. Safe to call repeatedly.
 */
export function startDownload(file: string): { ok: boolean; error?: string } {
  if (!isKnownModel(file)) return { ok: false, error: `Unknown model: ${file}` };
  if (isDownloaded(file)) return { ok: true };
  if (downloads.has(file) && !downloads.get(file)!.error) return { ok: true }; // in progress

  const info = REGISTRY[file];
  const free = freeDiskBytes();
  if (free > 0 && free < info.approxBytes * 1.1) {
    return { ok: false, error: "Not enough free disk space for this model." };
  }

  downloads.set(file, { receivedBytes: 0, totalBytes: info.approxBytes });
  void runDownload(info).catch((e: unknown) => {
    downloads.set(file, {
      receivedBytes: downloads.get(file)?.receivedBytes ?? 0,
      totalBytes: info.approxBytes,
      error: (e as Error).message,
    });
  });
  return { ok: true };
}

async function runDownload(info: ModelInfo): Promise<void> {
  const dest = modelPath(info.file);
  const part = `${dest}.part`;
  const res = await fetch(info.url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (HTTP ${res.status})`);
  }
  const total = Number(res.headers.get("content-length")) || info.approxBytes;
  downloads.set(info.file, { receivedBytes: 0, totalBytes: total });

  const out = createWriteStream(part);
  let received = 0;
  const nodeStream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  nodeStream.on("data", (chunk: Buffer) => {
    received += chunk.length;
    downloads.set(info.file, { receivedBytes: received, totalBytes: total });
  });

  await new Promise<void>((resolvePromise, reject) => {
    nodeStream.pipe(out);
    out.on("finish", () => resolvePromise());
    out.on("error", reject);
    nodeStream.on("error", reject);
  });

  // Rename .part → final only after a clean finish.
  try {
    rmSync(dest, { force: true });
  } catch {
    /* ignore */
  }
  const { renameSync } = await import("node:fs");
  renameSync(part, dest);
  downloads.delete(info.file);
}

/** Delete a downloaded model (and any stray .part). */
export function deleteModel(file: string): { ok: boolean; error?: string } {
  if (!isKnownModel(file)) return { ok: false, error: `Unknown model: ${file}` };
  if (downloads.has(file)) return { ok: false, error: "Model is currently downloading." };
  try {
    rmSync(modelPath(file), { force: true });
    rmSync(`${modelPath(file)}.part`, { force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
