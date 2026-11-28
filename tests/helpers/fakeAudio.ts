// 測試用的最小 Web Audio 假物件（Vitest 的 node 環境沒有 AudioContext）。
// 只實作 AudioEngine 用到的部分，並記錄建立的節點數、開始／停止的音源，讓測試檢查節點配置與發聲數。

export class FakeParam {
  events: { type: string; value: number; time: number }[] = [];
  constructor(public value = 0) {}
  cancelScheduledValues(t: number): this {
    this.events.push({ type: 'cancel', value: this.value, time: t });
    return this;
  }
  setValueAtTime(v: number, t: number): this {
    this.value = v;
    this.events.push({ type: 'set', value: v, time: t });
    return this;
  }
  linearRampToValueAtTime(v: number, t: number): this {
    this.events.push({ type: 'ramp', value: v, time: t });
    return this;
  }
  setTargetAtTime(v: number, t: number): this {
    this.value = v;
    this.events.push({ type: 'target', value: v, time: t });
    return this;
  }
}

class FakeNode {
  outputs: unknown[] = [];
  connect<T>(n: T): T {
    this.outputs.push(n);
    return n;
  }
  disconnect(): void {
    this.outputs = [];
  }
}

export class FakeBuffer {
  data: Float32Array | null = null;
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {}
  get duration(): number {
    return this.length / this.sampleRate;
  }
  copyToChannel(d: Float32Array): void {
    this.data = d;
  }
}

export class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  loop = false;
  playbackRate = new FakeParam(1);
  startedAt: number | null = null;
  offset = 0;
  stoppedAt: number | null = null;
  constructor(private readonly ctx: FakeAudioContext) {
    super();
  }
  start(t = 0, offset = 0): void {
    this.startedAt = t;
    this.offset = offset;
    this.ctx.started.push(this);
  }
  stop(t = 0): void {
    this.stoppedAt = t;
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}

export class FakePanner extends FakeNode {
  positionX = new FakeParam();
  positionY = new FakeParam();
  positionZ = new FakeParam();
  panningModel = 'equalpower';
  distanceModel = 'inverse';
  refDistance = 1;
  maxDistance = 10000;
  rolloffFactor = 1;
}

export class FakeStereo extends FakeNode {
  pan = new FakeParam();
}

export class FakeCompressor extends FakeNode {
  threshold = new FakeParam(-24);
  knee = new FakeParam(30);
  ratio = new FakeParam(12);
  attack = new FakeParam(0.003);
  release = new FakeParam(0.25);
}

export class FakeAudioContext {
  state: 'running' | 'suspended' | 'closed' = 'running';
  currentTime = 0;
  sampleRate = 48000;
  baseLatency = 0.01;
  destination = new FakeNode();
  listener = {
    positionX: new FakeParam(),
    positionY: new FakeParam(),
    positionZ: new FakeParam(),
    forwardX: new FakeParam(),
    forwardY: new FakeParam(),
    forwardZ: new FakeParam(-1),
    upX: new FakeParam(),
    upY: new FakeParam(1),
    upZ: new FakeParam(),
  };
  created: Record<string, number> = { gain: 0, source: 0, panner: 0, stereo: 0, compressor: 0, buffer: 0 };
  started: FakeSource[] = [];
  resumes = 0;
  suspends = 0;
  /** resume 後的狀態（模擬 autoplay 被擋：設成 'suspended'）。 */
  resumeTo: 'running' | 'suspended' = 'running';

  createGain(): FakeGain {
    this.created.gain!++;
    return new FakeGain();
  }
  createBufferSource(): FakeSource {
    this.created.source!++;
    return new FakeSource(this);
  }
  createPanner(): FakePanner {
    this.created.panner!++;
    return new FakePanner();
  }
  createStereoPanner(): FakeStereo {
    this.created.stereo!++;
    return new FakeStereo();
  }
  createDynamicsCompressor(): FakeCompressor {
    this.created.compressor!++;
    return new FakeCompressor();
  }
  createBuffer(ch: number, len: number, sr: number): FakeBuffer {
    this.created.buffer!++;
    return new FakeBuffer(ch, len, sr);
  }
  resume(): Promise<void> {
    this.resumes++;
    this.state = this.resumeTo;
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.suspends++;
    this.state = 'suspended';
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }
  /** 正在播放（已開始、未停止、還沒播完）的音源數。 */
  playing(now = this.currentTime): number {
    return this.started.filter((s) => {
      if (s.startedAt === null) return false;
      if (s.stoppedAt !== null && s.stoppedAt <= now) return false;
      if (s.loop) return true;
      const dur = (s.buffer?.duration ?? 0) / Math.max(0.05, s.playbackRate.value);
      return s.startedAt + dur > now;
    }).length;
  }
}

/** 轉型成 AudioContext（AudioEngine 的 createContext 選項）。 */
export function asAudioContext(ctx: FakeAudioContext): AudioContext {
  return ctx as unknown as AudioContext;
}
