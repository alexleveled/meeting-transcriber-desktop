// @ts-check
/**
 * Assemble the standalone Next server for the Electron package.
 *
 * Ordering matters (see docs/ELECTRON-PLAN.md "better-sqlite3 ABI"):
 *   1. Root node_modules/better-sqlite3 stays Node-ABI so `npm run dev` keeps working AND so
 *      `next build` — which runs under system Node and may evaluate src/server/db.ts during
 *      prerender — doesn't crash on an Electron-ABI binary.
 *   2. `ELECTRON_BUILD=1 next build` (webpack, NOT turbopack) emits .next/standalone with
 *      better-sqlite3 traced into standalone/node_modules (thanks to serverExternalPackages).
 *   3. Copy .next/static and public INTO the standalone tree (Next doesn't do this automatically).
 *   4. Build/fetch an Electron-ABI better_sqlite3.node and overwrite ONLY the copy inside
 *      standalone/node_modules — the root copy is never touched.
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const root = process.cwd();
const p = (...s) => join(root, ...s);
const log = (m) => console.log(`\n\x1b[36m[package-electron]\x1b[0m ${m}`);

const STANDALONE = p(".next", "standalone");
const electronVersion = JSON.parse(
  readFileSync(p("node_modules", "electron", "package.json"), "utf8"),
).version;

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: "inherit", ...opts });
}

// --- 2. standalone build (webpack) ------------------------------------------
// The tracer reaches whisper-server.exe by path (env.ts pins "vendor/whisper/win-x64") and sweeps
// EVERY copy it finds — including the previous package under dist-electron/. That nests the whole
// build one level deeper per run (app-server/dist-electron/win-unpacked/resources/app-server/…).
// outputFileTracingExcludes does not stop it, so delete last run's output before tracing: with no
// previous build on disk there is nothing to sweep. Left unchecked the paths pass Windows' 260-char
// MAX_PATH, and NSIS RMDir /r silently cannot delete those — the uninstaller leaves them behind and
// the next install dies with "Failed to uninstall old application files" / "cannot be closed".
log("clearing previous build output (dist-electron, .next/standalone)");
rmSync(p("dist-electron"), { recursive: true, force: true });
rmSync(p(".next", "standalone"), { recursive: true, force: true });
run(process.execPath, [p("node_modules", "next", "dist", "bin", "next"), "build"], {
  env: { ...process.env, ELECTRON_BUILD: "1" },
});

if (!existsSync(join(STANDALONE, "server.js"))) {
  throw new Error("Standalone build produced no server.js — did output:'standalone' take effect?");
}

// Belt-and-braces: prune anything the tracer pulled in that the packaged app never reads. whisper
// ships via extraResources (WHISPER_BIN_DIR), so a traced vendor/ copy is pure duplication — and it
// is the seed the next build would nest.
for (const junk of ["dist-electron", "vendor"]) {
  if (existsSync(join(STANDALONE, junk))) {
    log(`pruning traced ${junk}/ from standalone tree`);
    rmSync(join(STANDALONE, junk), { recursive: true, force: true });
  }
}

// --- 3. copy static assets INTO the standalone tree -------------------------
log("copying .next/static and public into standalone");
cpSync(p(".next", "static"), join(STANDALONE, ".next", "static"), { recursive: true });
if (existsSync(p("public"))) {
  cpSync(p("public"), join(STANDALONE, "public"), { recursive: true });
}

// --- 4. Electron-ABI better_sqlite3.node swap (standalone copy only) ---------
const sqliteDir = join(STANDALONE, "node_modules", "better-sqlite3");
if (!existsSync(sqliteDir)) {
  throw new Error(
    `better-sqlite3 was not traced into the standalone tree at ${sqliteDir}. ` +
      "Check serverExternalPackages and outputFileTracingRoot in next.config.ts.",
  );
}

log(`building Electron-ABI better_sqlite3.node (target ${electronVersion}) in standalone copy`);
const prebuildInstall = p("node_modules", "prebuild-install", "bin.js");
let swapped = false;
if (existsSync(prebuildInstall)) {
  try {
    // Fast path: better-sqlite3 publishes Electron prebuilds — no compiler needed.
    run(
      process.execPath,
      [
        prebuildInstall,
        "--runtime",
        "electron",
        "--target",
        electronVersion,
        "--platform",
        process.platform,
        "--arch",
        process.arch,
      ],
      { cwd: sqliteDir },
    );
    swapped = true;
  } catch {
    log("prebuild-install failed — falling back to electron-rebuild (needs VS Build Tools)");
  }
}

if (!swapped) {
  // Fallback: compile against Electron's headers directly into the standalone copy.
  const electronRebuild = p("node_modules", ".bin", process.platform === "win32" ? "electron-rebuild.cmd" : "electron-rebuild");
  run(
    electronRebuild,
    ["-f", "-w", "better-sqlite3", "-v", electronVersion, "--module-dir", STANDALONE],
    { cwd: root, shell: process.platform === "win32" },
  );
}

// --- 5. MAX_PATH guard ------------------------------------------------------
// Everything here lands under <install>\resources\app-server\, and NSIS's RMDir /r cannot delete a
// path over 260 chars — it just leaves it, which permanently breaks uninstall AND every future
// update. Fail the build rather than ship an installer that can never be removed.
const INSTALL_PREFIX_BUDGET = 90; // e.g. C:\Users\<user>\AppData\Local\Programs\meeting-transcriber\resources\app-server\
const MAX_RELATIVE = 260 - INSTALL_PREFIX_BUDGET;
let longest = "";
for (const rel of readdirSync(STANDALONE, { recursive: true, encoding: "utf8" })) {
  if (rel.length > longest.length) longest = rel;
}
if (longest.length > MAX_RELATIVE) {
  throw new Error(
    `Standalone tree has a path ${longest.length} chars long (budget ${MAX_RELATIVE}); it would ` +
      `exceed Windows MAX_PATH once installed and NSIS could never uninstall it:\n  ${longest}`,
  );
}
log(`MAX_PATH guard OK — longest relative path ${longest.length}/${MAX_RELATIVE} chars`);

log("done — standalone server ready at .next/standalone (server.js + Electron-ABI sqlite)");
