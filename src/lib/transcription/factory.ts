import type { Provider } from "@/lib/types";
import type { TranscriptionProvider } from "./provider";
import { OpenAIRealtimeProvider } from "./openai-realtime";
import { DeepgramProvider } from "./deepgram";
import { LocalWhisperProvider } from "./local-whisper";

/** Instantiate the transcription provider selected in Settings. */
export function createProvider(name: Provider): TranscriptionProvider {
  switch (name) {
    case "openai":
      return new OpenAIRealtimeProvider();
    case "deepgram":
      return new DeepgramProvider();
    case "local":
      return new LocalWhisperProvider();
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}
