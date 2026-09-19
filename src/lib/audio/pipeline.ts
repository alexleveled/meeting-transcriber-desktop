/**
 * AudioPipeline — turns one MediaStream into a stream of PCM16 chunks + RMS levels via the
 * pcm16-worklet. Framework-free. One AudioContext is shared across both source pipelines
 * (mic + system); each pipeline owns its own AudioWorkletNode.
 */

const WORKLET_URL = "/worklets/pcm16-worklet.js";
const TARGET_RATE = 24000;

const modulesLoaded = new WeakSet<AudioContext>();

/** Create the shared 24 kHz AudioContext. Some browsers ignore the rate → worklet resamples. */
export function createAudioContext(): AudioContext {
  const Ctor: typeof AudioContext =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  try {
    return new Ctor({ sampleRate: TARGET_RATE });
  } catch {
    // Browser refused the explicit rate — fall back to default; the worklet still resamples.
    return new Ctor();
  }
}

async function ensureWorklet(ctx: AudioContext): Promise<void> {
  if (modulesLoaded.has(ctx)) return;
  await ctx.audioWorklet.addModule(WORKLET_URL);
  modulesLoaded.add(ctx);
}

export interface PipelineCallbacks {
  onChunk: (pcm16: ArrayBuffer) => void;
  onRms: (level: number) => void;
}

export class AudioPipeline {
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private started = false;

  constructor(
    private readonly ctx: AudioContext,
    private readonly stream: MediaStream,
    private readonly cb: PipelineCallbacks,
  ) {}

  get contextSampleRate(): number {
    return this.ctx.sampleRate;
  }

  async start(): Promise<void> {
    if (this.started) return;
    await ensureWorklet(this.ctx);
    if (this.ctx.state === "suspended") await this.ctx.resume();

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "pcm16-worklet", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });

    this.node.port.onmessage = (e: MessageEvent) => {
      const data = e.data as { type: string; buffer?: ArrayBuffer; value?: number };
      if (data.type === "chunk" && data.buffer) this.cb.onChunk(data.buffer);
      else if (data.type === "rms" && typeof data.value === "number") this.cb.onRms(data.value);
    };

    // source → worklet → destination. The worklet never writes to its output, so the
    // destination receives silence (no echo/feedback) while process() keeps being pulled.
    this.source.connect(this.node);
    this.node.connect(this.ctx.destination);
    this.started = true;
  }

  /** Swap in a new MediaStream (mid-session share recovery) without recreating the context. */
  async replaceStream(stream: MediaStream): Promise<void> {
    this.source?.disconnect();
    this.source = this.ctx.createMediaStreamSource(stream);
    if (this.node) this.source.connect(this.node);
  }

  stop(): void {
    this.node?.port.postMessage({ type: "stop" });
    try {
      this.source?.disconnect();
      this.node?.disconnect();
    } catch {
      /* already disconnected */
    }
    this.source = null;
    this.node = null;
    this.started = false;
  }
}
