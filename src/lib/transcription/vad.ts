/**
 * Tiny energy-based voice-activity detector for the local Whisper provider. Whisper is not a
 * streaming model, so we buffer audio and only ship a window to it once the speaker pauses. This
 * gate decides, frame by frame, whether the current ~100 ms chunk contains speech, adapting to the
 * ambient noise floor so it works in quiet and noisy rooms alike. Framework-free.
 */

/** Normalized RMS in [0, 1] for a mono Int16 frame. */
export function computeRms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    const s = pcm[i] / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / pcm.length);
}

export class NoiseGate {
  // Slow-moving estimate of the background noise level.
  private floor = 0.01;
  private static readonly ABS_MIN = 0.006; // treat anything below this as silence regardless
  private static readonly RATIO = 2.5; // speech must exceed floor × RATIO

  /** Feed one frame's RMS; returns true if it looks like speech. */
  update(rms: number): boolean {
    const threshold = Math.max(NoiseGate.ABS_MIN, this.floor * NoiseGate.RATIO);
    const speaking = rms > threshold;
    // Only adapt the floor toward quiet frames, so sustained speech doesn't raise the bar.
    if (!speaking) this.floor = this.floor * 0.95 + rms * 0.05;
    return speaking;
  }
}
