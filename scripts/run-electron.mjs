// @ts-check
/**
 * Launch Electron for dev, defensively stripping ELECTRON_RUN_AS_NODE from the environment.
 *
 * Editors that are themselves Electron apps (VS Code, Cursor) export ELECTRON_RUN_AS_NODE=1 to
 * their integrated-terminal subprocesses. If that leaks into `electron .`, Electron boots as plain
 * Node — `require('electron')` returns the path string, `app` is undefined, and the app crashes at
 * startup. Spawning through this launcher guarantees a real Electron GUI process regardless of who
 * started the terminal. (The packaged app launched from Explorer is unaffected.)
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electronPath = /** @type {string} */ (require("electron"));

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ["."], { stdio: "inherit", env });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
