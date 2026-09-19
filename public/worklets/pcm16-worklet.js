/**
 * pcm16-worklet.js — AudioWorkletProcessor that turns live audio into the PCM16 chunks the
 * transcription providers expect.
 *
 * Per render quantum it:
 *   1. mixes all input channels down to mono
 *   2. linearly resamples from the context's sample rate to 24 kHz (a no-op when the context
 *      already runs at 24 kHz; the fallback path for browsers that ignore the requested rate)
 *   3. accumulates 24 kHz mono samples into ~100 ms chunks (2400 samples / 4800 bytes)
 *   4. posts each chunk as a transferable ArrayBuffer: { type: 'chunk', buffer }
 *   5. posts an RMS level ~every 250 ms for the VU meter: { type: 'rms', value }
 *
 * Framework-free and portable — the same worklet is reused for both the mic and system streams.
 */

const TARGET_RATE = 24000;
const CHUNK_SAMPLES = 2400; // 100 ms @ 24 kHz
const RMS_INTERVAL_SAMPLES = 6000; // 250 ms @ 24 kHz

class Pcm16Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Resampling: ratio of input samples consumed per output sample.
    this._step = sampleRate / TARGET_RATE;
    this._readPos = 0; // fractional read cursor into _queue
    this._queue = new Float32Array(0); // pending mono input samples

    // Output chunk accumulator.
    this._chunk = new Int16Array(CHUNK_SAMPLES);
    this._chunkFill = 0;

    // RMS accumulation (over output/target-rate samples).
    this._sumSq = 0;
    this._rmsCount = 0;

    this._running = true;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === "stop") this._running = false;
    };
  }

  _emitChunk() {
    // Copy into a fresh buffer so we can transfer ownership without losing our accumulator.
    const out = new Int16Array(CHUNK_SAMPLES);
    out.set(this._chunk);
    this.port.postMessage({ type: "chunk", buffer: out.buffer }, [out.buffer]);
    this._chunkFill = 0;
  }

  _pushSample(f) {
    // Clamp + convert float [-1,1] to Int16.
    let s = f;
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    this._chunk[this._chunkFill++] = s < 0 ? s * 0x8000 : s * 0x7fff;
    if (this._chunkFill >= CHUNK_SAMPLES) this._emitChunk();

    // RMS bookkeeping.
    this._sumSq += f * f;
    if (++this._rmsCount >= RMS_INTERVAL_SAMPLES) {
      const rms = Math.sqrt(this._sumSq / this._rmsCount);
      this.port.postMessage({ type: "rms", value: rms });
      this._sumSq = 0;
      this._rmsCount = 0;
    }
  }

  process(inputs) {
    if (!this._running) return false;
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const frames = input[0].length;
    const channels = input.length;

    // 1. mixdown to mono for this block
    const mono = new Float32Array(frames);
    for (let ch = 0; ch < channels; ch++) {
      const data = input[ch];
      for (let i = 0; i < frames; i++) mono[i] += data[i];
    }
    if (channels > 1) {
      for (let i = 0; i < frames; i++) mono[i] /= channels;
    }

    // Append to the pending queue.
    const merged = new Float32Array(this._queue.length + mono.length);
    merged.set(this._queue, 0);
    merged.set(mono, this._queue.length);
    this._queue = merged;

    // 2 + 3. resample the queue down to 24 kHz, feeding output samples.
    // We can interpolate up to the second-to-last sample; keep a 1-sample tail for the next block.
    let pos = this._readPos;
    const n = this._queue.length;
    while (pos + 1 < n) {
      const i = Math.floor(pos);
      const frac = pos - i;
      const sample = this._queue[i] * (1 - frac) + this._queue[i + 1] * frac;
      this._pushSample(sample);
      pos += this._step;
    }

    // Drop fully-consumed samples, keep the remainder + fractional cursor for continuity.
    const consumed = Math.floor(pos);
    if (consumed > 0) {
      this._queue = this._queue.slice(consumed);
      pos -= consumed;
    }
    this._readPos = pos;

    return true;
  }
}

registerProcessor("pcm16-worklet", Pcm16Processor);
