// @ts-check
/**
 * Fetch the whisper.cpp Windows (x64, CPU) binaries used by the free Local Whisper provider and
 * stage them at vendor/whisper/win-x64 so electron-builder can ship them via extraResources.
 *
 * Idempotent: if whisper-server.exe is already present it exits early. The ggml MODEL files are NOT
 * downloaded here — those are fetched on demand at runtime into the app's userData dir.
 *
 * Extraction uses bundled `tar` (Windows 10+ ships bsdtar, which reads .zip). We copy every .exe and
 * .dll from the archive into a flat win-x64 dir, and alias server.exe → whisper-server.exe if an
 * older release used the shorter name.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Pinned whisper.cpp release. Update deliberately (the /inference JSON shape is what manager.ts parses).
const VERSION = "1.9.1";
const ASSET = "whisper-bin-x64.zip";
const URL = `https://github.com/ggml-org/whisper.cpp/releases/download/v${VERSION}/${ASSET}`;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "vendor", "whisper", "win-x64");
const serverExe = join(outDir, "whisper-server.exe");

if (existsSync(serverExe)) {
  console.log(`[fetch-whisper] already present at ${serverExe} — skipping.`);
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "whisper-dl-"));
const zipPath = join(tmp, ASSET);

try {
  console.log(`[fetch-whisper] downloading ${URL}`);
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const { writeFileSync } = await import("node:fs");
  writeFileSync(zipPath, buf);

  console.log("[fetch-whisper] extracting…");
  const extractDir = join(tmp, "extracted");
  mkdirSync(extractDir, { recursive: true });
  extractZip(zipPath, extractDir);

  // Copy only what whisper-server needs (the archive also ships parakeet/llama/tests/SDL2 we skip):
  //   whisper-server.exe, whisper.dll, and every ggml*.dll (incl. the per-CPU ggml-cpu-*.dll variants
  //   that whisper-server dispatches to at runtime).
  const wanted = (/** @type {string} */ name) =>
    /^whisper-server\.exe$/i.test(name) || /^whisper\.dll$/i.test(name) || /^ggml.*\.dll$/i.test(name);

  let copied = 0;
  for (const file of walk(extractDir)) {
    const name = basename(file);
    if (wanted(name)) {
      cpSync(file, join(outDir, name));
      copied++;
    }
  }

  // Older releases named the server `server.exe`; the manager expects whisper-server.exe.
  if (!existsSync(serverExe)) {
    const legacy = walk(extractDir).find((f) => /^server\.exe$/i.test(basename(f)));
    if (legacy) {
      cpSync(legacy, serverExe);
      copied++;
    }
  }
  if (!existsSync(serverExe)) {
    throw new Error("whisper-server.exe not found in the downloaded archive");
  }

  console.log(`[fetch-whisper] staged ${copied} files at ${outDir}`);
} catch (err) {
  console.error(`[fetch-whisper] ERROR: ${/** @type {Error} */ (err).message}`);
  process.exit(1);
} finally {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

/**
 * Extract a .zip. On Windows use PowerShell's Expand-Archive (unambiguous, always present); on other
 * platforms fall back to bsdtar. `cwd`-relative args avoid GNU tar treating `C:\` as a remote host.
 * @param {string} zip @param {string} dest
 */
function extractZip(zip, dest) {
  if (process.platform === "win32") {
    const ps = spawnSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath "${zip}" -DestinationPath "${dest}" -Force`],
      { stdio: "inherit" },
    );
    if (ps.status !== 0) throw new Error("Expand-Archive extraction failed");
    return;
  }
  const tar = spawnSync("tar", ["-xf", zip, "-C", dest], { stdio: "inherit" });
  if (tar.status !== 0) throw new Error("tar extraction failed (is bsdtar available?)");
}

/** @param {string} p */
function basename(p) {
  return p.split(/[\\/]/).pop() ?? p;
}

/** Recursively yield file paths under `dir`. @param {string} dir @returns {string[]} */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
