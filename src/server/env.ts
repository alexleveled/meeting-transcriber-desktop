import "server-only";

/**
 * Server-side environment access. API keys normally live in the SQLite settings table
 * (entered via the UI); these env vars are only consulted as a fallback when no key is
 * saved. See src/server/settings.ts for the merge logic.
 */
export const env = {
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  deepgramApiKey: process.env.DEEPGRAM_API_KEY ?? "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  /** Absolute path to the SQLite database file. */
  dbPath: process.env.TRANSCRIBER_DB_PATH ?? "data/transcriber.db",
  /**
   * Directory holding the whisper.cpp Windows binaries (whisper-server.exe + DLLs). In dev these
   * are fetched into vendor/whisper/win-x64; in the packaged app electron/server.ts points this at
   * resources/whisper.
   */
  whisperBinDir: process.env.WHISPER_BIN_DIR ?? "vendor/whisper/win-x64",
  /**
   * Directory where downloaded ggml Whisper model files live. Kept OUT of the installer (models are
   * hundreds of MB) — downloaded on demand into the app's userData dir at runtime.
   */
  modelsDir: process.env.TRANSCRIBER_MODELS_DIR ?? "data/models",
};
