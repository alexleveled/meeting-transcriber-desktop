import "server-only";

/**
 * PCM16 helpers for the local Whisper path. The browser streams mono 16-bit PCM at 24 kHz;
 * whisper.cpp wants 16 kHz WAV, so we downsample (linear interpolation — fine for speech) and
 * wrap in a minimal WAV container.
 */

/** Linear-resample mono Int16 PCM from `inRate` to `outRate`. */
export function resamplePcm16(input: Int16Array, inRate: number, outRate: number): Int16Array {
  if (inRate === outRate) return input;
  const ratio = inRate / outRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = i * ratio;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    const a = input[idx] ?? 0;
    const b = input[idx + 1] ?? a;
    out[i] = (a + (b - a) * frac) | 0;
  }
  return out;
}

/** Wrap mono Int16 PCM in a 16-bit WAV container at the given sample rate. */
export function encodeWav(pcm: Int16Array, sampleRate: number): Buffer {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample; // mono
  const dataSize = pcm.length * bytesPerSample;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // channels = mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * blockAlign, 28); // byte rate
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < pcm.length; i++) {
    buf.writeInt16LE(pcm[i], 44 + i * bytesPerSample);
  }
  return buf;
}
