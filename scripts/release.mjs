// @ts-check
/**
 * Cut a release: bump the version, commit, tag, push. The `v*` tag triggers
 * .github/workflows/release.yml, which builds the Windows NSIS installer and attaches it to a
 * GitHub Release, which the in-app updater picks up automatically. Shipping is one command:
 *
 *   npm run release            # patch  0.1.0 -> 0.1.1
 *   npm run release -- minor   #        0.1.0 -> 0.2.0
 *   npm run release -- major
 *   npm run release -- 1.4.0   # explicit version
 *   npm run release -- patch --dry-run
 *
 * Preflight refuses to run on a dirty tree, off main, or when the tag already exists — a bad tag
 * is annoying to undo once it's on the remote.
 */
import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE_BRANCH = "main";
const REPO = "alexleveled/meeting-transcriber-desktop";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const bump = args.find((a) => !a.startsWith("-")) || "patch";

if (!/^(patch|minor|major|\d+\.\d+\.\d+)$/.test(bump)) {
  fail(`Invalid bump "${bump}". Use patch | minor | major | x.y.z`);
}

function run(cmd, cmdArgs, { capture = false } = {}) {
  const opts = {
    cwd: ROOT,
    encoding: "utf-8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  };
  // git is a real .exe, so no shell — which also means args with spaces (commit messages) survive
  // intact. npm is a .cmd shim on Windows and needs a shell; its args here are all simple tokens,
  // so joining is safe.
  if (cmd === "npm") return execSync([cmd, ...cmdArgs].join(" "), opts);
  return execFileSync(cmd, cmdArgs, opts);
}

function git(...gitArgs) {
  return run("git", gitArgs, { capture: true }).trim();
}

function fail(msg) {
  console.error(`\n  release: ${msg}\n`);
  process.exit(1);
}

function readVersion() {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")).version;
}

// ── Preflight ────────────────────────────────────────────────────────────────
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== RELEASE_BRANCH) {
  fail(`on branch "${branch}" — releases cut from "${RELEASE_BRANCH}". Merge first.`);
}

if (git("status", "--porcelain")) {
  fail("working tree is dirty. Commit or stash before releasing.");
}

// Make sure we're not about to push a version someone else already released.
try {
  run("git", ["fetch", "origin", "--tags", "--quiet"], { capture: true });
} catch {
  console.warn("  release: could not fetch tags from origin (offline?) — continuing.");
}

const behind = git("rev-list", "--count", `HEAD..origin/${RELEASE_BRANCH}`);
if (behind !== "0") {
  fail(`local ${RELEASE_BRANCH} is ${behind} commit(s) behind origin. Pull first.`);
}

// ── Bump ─────────────────────────────────────────────────────────────────────
const from = readVersion();
run("npm", ["version", bump, "--no-git-tag-version", "--allow-same-version=false"]);
const to = readVersion();
const tag = `v${to}`;

if (git("tag", "--list", tag)) {
  run("git", ["checkout", "--", "package.json", "package-lock.json"]);
  fail(`tag ${tag} already exists. Pick a different version.`);
}

console.log(`\n  ${from} -> ${to}   tag ${tag}\n`);

if (dryRun) {
  run("git", ["checkout", "--", "package.json", "package-lock.json"]);
  console.log("  --dry-run: version reverted, nothing committed or pushed.\n");
  process.exit(0);
}

// ── Commit, tag, push ────────────────────────────────────────────────────────
run("git", ["add", "package.json", "package-lock.json"]);
run("git", ["commit", "-m", `release: ${tag}`]);
run("git", ["tag", "-a", tag, "-m", `Release ${tag}`]);
run("git", ["push", "origin", RELEASE_BRANCH, "--follow-tags"]);

console.log(`
  Pushed ${tag}. CI is building the installer now:
    https://github.com/${REPO}/actions

  When the run is green the Release will carry the Setup .exe, and installed
  copies will see it on their next update check.
`);
