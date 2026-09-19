import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module — it must not be bundled by webpack/turbopack, and file
  // tracing must copy it into the standalone tree (below) so the packaged server can require it.
  serverExternalPackages: ["better-sqlite3"],
  // Electron packaging build only: emit a standalone server tree (.next/standalone/server.js).
  // The browser/dev workflow leaves this undefined so nothing changes there.
  output: process.env.ELECTRON_BUILD ? "standalone" : undefined,
  // Pin the tracing/workspace root — a parent lockfile exists, so Next would otherwise infer a
  // too-high root (dev/turbopack) or trace the wrong tree (standalone/webpack).
  outputFileTracingRoot: __dirname,
  // The tracer picks up whisper binaries by path, which also sweeps the PREVIOUS packaged build in
  // dist-electron/ into the new standalone tree (nesting one level deeper on every rebuild).
  // The packaged app gets its whisper dir from extraResources via WHISPER_BIN_DIR, never from here.
  // NOTE: this exclude does NOT actually stop the sweep — verified still nesting after it landed.
  // The real fix is in scripts/package-electron.mjs, which deletes dist-electron/ before tracing and
  // prunes dist-electron/ and vendor/ out of the standalone tree afterwards. Kept as defence in depth.
  outputFileTracingExcludes: {
    "*": ["dist-electron/**"],
  },
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
