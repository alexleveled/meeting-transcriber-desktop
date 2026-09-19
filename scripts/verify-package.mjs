// @ts-check
/**
 * Verify the tree electron-builder actually produced, before it is handed to NSIS.
 *
 * package-electron.mjs already guards .next/standalone, but that is only the Next server slice.
 * This checks the real shipped layout (dist-electron/win-unpacked), which also carries app.asar,
 * Electron's own locales/, and resources/whisper.
 *
 * Why it matters: everything here lands under
 *   C:\Users\<user>\AppData\Local\Programs\meeting-transcriber\
 * and NSIS's recursive directory removal cannot delete a path over Windows' 260-char MAX_PATH. It
 * does not error — it silently leaves the files. The uninstaller then "succeeds" with the directory
 * still on disk, and the next install dies running it, surfacing as
 *   "Meeting Transcriber cannot be closed. Please close it manually and click Retry to continue."
 * which names the wrong cause entirely and cannot be resolved by the user.
 *
 * A build that trips this is unshippable, so fail loudly here rather than at a user's PC.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const UNPACKED = join(ROOT, "dist-electron", "win-unpacked");

// "C:\Users\" + <user> + "\AppData\Local\Programs\meeting-transcriber\" is 53 + username. 80 covers
// a 27-char username, well past anything realistic, and still leaves 180 for the tree itself.
const INSTALL_PREFIX_BUDGET = 80;
const MAX_RELATIVE = 260 - INSTALL_PREFIX_BUDGET;

const fail = (msg) => {
  console.error(`\n  verify-package: ${msg}\n`);
  process.exit(1);
};

if (!existsSync(UNPACKED)) {
  fail(`no packaged tree at ${UNPACKED} — run electron-builder first`);
}

// The specific regression that shipped in 0.1.4: the Next tracer swept the previous build back into
// the new one, nesting a level deeper each time. Assert it by name so the failure reads plainly
// instead of as an anonymous path-too-long number.
const NESTED = join(UNPACKED, "resources", "app-server", "dist-electron");
if (existsSync(NESTED)) {
  fail(
    "the packaged app contains a copy of a previous build at\n" +
      `    resources/app-server/dist-electron\n` +
      "  Each build nests one level deeper until paths pass MAX_PATH and the app can no longer be\n" +
      "  uninstalled. package-electron.mjs is supposed to prevent this — check its prune step.",
  );
}

let longest = "";
let count = 0;
for (const rel of readdirSync(UNPACKED, { recursive: true, encoding: "utf8" })) {
  count += 1;
  if (rel.length > longest.length) longest = rel;
}

if (longest.length > MAX_RELATIVE) {
  fail(
    `path ${longest.length} chars long, over the ${MAX_RELATIVE} budget:\n    ${longest}\n` +
      "  Installed, this would pass Windows' 260-char MAX_PATH and NSIS could never remove it.",
  );
}

console.log(
  `\n  verify-package: OK — ${count} entries, longest ${longest.length}/${MAX_RELATIVE} chars` +
    `\n    ${longest}\n`,
);
