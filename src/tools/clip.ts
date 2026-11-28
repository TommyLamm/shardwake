// 輸入錄影格式（M1-15；純邏輯，可無頭測試）。之後的回歸測試與 bug 重現沿用這個格式。
//
// InputClip（JSON）：
//   { format: 'shardwake-replay', version: 1, name, gameVersion, createdAt, hz, steps,
//     start: ReplayStart,              起始狀態：關卡、視角、玩家快照、武器與靶標的時間與亂數、影響模擬的設定
//     frames: EncodedFrames,           每個固定步的 InputFrame（held／pressed／released／move／yaw／pitch）
//     path: { stride, points },        錄製時的腳底路徑（每 stride 步一點、含起點與終點；鬼影用，四位小數）
//     final: { pos },                  最後一步後的腳底位置（完整精度；重播驗證用）
//     marks: [[step, name], …],        錄製時的移動事件（滑鏟、跑牆、蹬牆跳、二段跳、Dash、抓鉤…；示範驗證用）
//     tuning: TuningValues }           錄製時與預設不同的調參數值（可「套用錄製時的參數」）
// 編碼：held、move、yaw、pitch 用遊程編碼 [值, 次數, 值, 次數, …]；pressed／released 只記非零的步 [步, 遮罩, …]。
// 數字以 JSON 原樣保存（double 可完整來回），-0 另存成字串 "-0"（JSON 會把 -0 寫成 0，atan2 等函式會因此不同）。
// 位元遮罩依 input/Actions.ts 的動作順序（只能在尾端新增，所以舊錄影仍可讀）。
import { ACTION_BIT } from '@/input/Actions';
import type { InputFrame } from '@/input/InputFrame';
import type { PlayerSnapshot } from '@/player/PlayerController';
import type { TuningValues } from '@/tools/tuning';
import type { WeaponReplayState } from '@/weapons/WeaponManager';

export const CLIP_FORMAT = 'shardwake-replay';
export const CLIP_VERSION = 1;

/** 不錄進影片的動作（即時的系統／開發鍵：重播時不應該觸發暫停、開面板或再次錄製）。restartCourse 會錄（計時賽重來是模擬的一部分）。 */
export const UNRECORDED_MASK = (ACTION_BIT.pause | ACTION_BIT.debugPanel | ACTION_BIT.recordToggle | ACTION_BIT.replayToggle) >>> 0;

export interface ReplayStart {
  levelId: string;
  /** 玩家視角（弧度，不含後座偏移）。 */
  yaw: number;
  pitch: number;
  player: PlayerSnapshot;
  weapons?: WeaponReplayState;
  targets?: { time: number; rng: number };
  /** 影響模擬的玩家設定。 */
  settings: { autoSprint: boolean };
}

type Num = number | '-0';

export interface EncodedFrames {
  held: number[];
  pressed: number[];
  released: number[];
  moveX: Num[];
  moveY: Num[];
  yaw: Num[];
  pitch: Num[];
}

export interface InputClip {
  format: typeof CLIP_FORMAT;
  version: number;
  name: string;
  gameVersion?: string;
  createdAt?: string;
  /** 錄製時的模擬頻率（重播時暫時切換成這個頻率）。 */
  hz: number;
  steps: number;
  start: ReplayStart;
  frames: EncodedFrames;
  path: { stride: number; points: number[] };
  final: { pos: [number, number, number] };
  marks: [number, string][];
  tuning: TuningValues;
}

/** 解碼後的逐步資料（重播用）。 */
export interface DecodedFrames {
  steps: number;
  held: Uint32Array;
  pressed: Uint32Array;
  released: Uint32Array;
  moveX: Float64Array;
  moveY: Float64Array;
  yaw: Float64Array;
  pitch: Float64Array;
}

const enc = (v: number): Num => (Object.is(v, -0) ? '-0' : v);
const dec = (v: unknown): number => (v === '-0' ? -0 : (v as number));

function rle(values: ArrayLike<number>, n: number): Num[] {
  const out: Num[] = [];
  let i = 0;
  while (i < n) {
    const v = values[i]!;
    let j = i + 1;
    while (j < n && Object.is(values[j], v)) j++;
    out.push(enc(v), j - i);
    i = j;
  }
  return out;
}

function sparse(values: ArrayLike<number>, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (values[i]) out.push(i, values[i]! >>> 0);
  return out;
}

/** 逐步記錄 InputFrame 的緩衝（錄製中使用，容量自動成長）。 */
export class FrameBuffer {
  steps = 0;
  held: number[] = [];
  pressed: number[] = [];
  released: number[] = [];
  moveX: number[] = [];
  moveY: number[] = [];
  yaw: number[] = [];
  pitch: number[] = [];

  push(f: Readonly<InputFrame>): void {
    const keep = ~UNRECORDED_MASK >>> 0;
    this.held.push((f.held & keep) >>> 0);
    this.pressed.push((f.pressed & keep) >>> 0);
    this.released.push((f.released & keep) >>> 0);
    this.moveX.push(f.move.x);
    this.moveY.push(f.move.y);
    this.yaw.push(f.yaw);
    this.pitch.push(f.pitch);
    this.steps++;
  }

  encode(): EncodedFrames {
    const n = this.steps;
    return {
      held: rle(this.held, n) as number[],
      pressed: sparse(this.pressed, n),
      released: sparse(this.released, n),
      moveX: rle(this.moveX, n),
      moveY: rle(this.moveY, n),
      yaw: rle(this.yaw, n),
      pitch: rle(this.pitch, n),
    };
  }
}

function unRle(src: readonly unknown[], out: Float64Array | Uint32Array, name: string, errors: string[]): void {
  let i = 0;
  for (let k = 0; k + 1 < src.length; k += 2) {
    const v = dec(src[k]);
    const count = src[k + 1];
    if ((typeof v !== 'number' || !Number.isFinite(v)) || typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
      errors.push(`frames.${name}：第 ${k / 2} 段不合法`);
      return;
    }
    if (i + count > out.length) {
      errors.push(`frames.${name}：總長度超過 steps`);
      return;
    }
    out.fill(out instanceof Uint32Array ? v >>> 0 : v, i, i + count);
    i += count;
  }
  if (src.length % 2 !== 0) errors.push(`frames.${name}：長度必須是偶數`);
  else if (i !== out.length) errors.push(`frames.${name}：總長度 ${i} 與 steps ${out.length} 不符`);
}

function unSparse(src: readonly unknown[], out: Uint32Array, name: string, errors: string[]): void {
  if (src.length % 2 !== 0) {
    errors.push(`frames.${name}：長度必須是偶數`);
    return;
  }
  for (let k = 0; k < src.length; k += 2) {
    const step = src[k];
    const mask = src[k + 1];
    if (typeof step !== 'number' || !Number.isInteger(step) || step < 0 || step >= out.length || typeof mask !== 'number' || !Number.isInteger(mask)) {
      errors.push(`frames.${name}：第 ${k / 2} 筆不合法`);
      return;
    }
    out[step] = mask >>> 0;
  }
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const vec3 = (x: unknown): x is [number, number, number] => Array.isArray(x) && x.length === 3 && x.every(finite);

/** 解碼並驗證 frames；errors 為空時結果可用。 */
export function decodeFrames(frames: unknown, steps: number, errors: string[]): DecodedFrames {
  const out: DecodedFrames = {
    steps,
    held: new Uint32Array(steps),
    pressed: new Uint32Array(steps),
    released: new Uint32Array(steps),
    moveX: new Float64Array(steps),
    moveY: new Float64Array(steps),
    yaw: new Float64Array(steps),
    pitch: new Float64Array(steps),
  };
  if (!isPlainObject(frames)) {
    errors.push('frames 必須是物件');
    return out;
  }
  for (const k of ['held', 'moveX', 'moveY', 'yaw', 'pitch'] as const) {
    const a = frames[k];
    if (!Array.isArray(a)) errors.push(`frames.${k} 必須是陣列`);
    else unRle(a, out[k], k, errors);
  }
  for (const k of ['pressed', 'released'] as const) {
    const a = frames[k];
    if (!Array.isArray(a)) errors.push(`frames.${k} 必須是陣列`);
    else unSparse(a, out[k], k, errors);
  }
  return out;
}

/** 把第 i 步寫進 InputFrame。 */
export function readFrame(d: Readonly<DecodedFrames>, i: number, out: InputFrame): InputFrame {
  out.held = d.held[i]!;
  out.pressed = d.pressed[i]!;
  out.released = d.released[i]!;
  out.move.x = d.moveX[i]!;
  out.move.y = d.moveY[i]!;
  out.yaw = d.yaw[i]!;
  out.pitch = d.pitch[i]!;
  return out;
}

export interface ClipValidation {
  ok: boolean;
  errors: string[];
  clip: InputClip | null;
  frames: DecodedFrames | null;
}

function validatePlayerSnapshot(p: unknown, errors: string[]): void {
  if (!isPlainObject(p)) {
    errors.push('start.player 必須是物件');
    return;
  }
  if (!vec3(p.pos)) errors.push('start.player.pos 不合法');
  if (!vec3(p.vel)) errors.push('start.player.vel 不合法');
  if (p.state !== 'ground' && p.state !== 'air') errors.push('start.player.state 必須是 ground 或 air');
  for (const k of ['crouchAmount', 'simTime', 'airTime', 'stepsOnGround', 'doubleJumpsLeft', 'dashCharges', 'dashElapsed', 'jetFuel', 'groundedTime', 'grappleCooldown', 'grappleCooldownTotal']) {
    if (!finite(p[k])) errors.push(`start.player.${k} 不合法`);
  }
  if (typeof p.crouchTarget !== 'boolean') errors.push('start.player.crouchTarget 不合法');
  if (p.slideBoostTimer !== null && !finite(p.slideBoostTimer)) errors.push('start.player.slideBoostTimer 不合法');
}

/** 驗證錄影 JSON（物件或文字），並解碼 frames。 */
export function validateClip(input: unknown): ClipValidation {
  const errors: string[] = [];
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (err) {
      return { ok: false, errors: [`不是有效的 JSON（${err instanceof Error ? err.message : String(err)}）`], clip: null, frames: null };
    }
  }
  if (!isPlainObject(raw)) return { ok: false, errors: ['錄影必須是物件'], clip: null, frames: null };
  if (raw.format !== CLIP_FORMAT) return { ok: false, errors: [`格式「${String(raw.format)}」不是輸入錄影`], clip: null, frames: null };
  const v = raw.version;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) errors.push('version 必須是正整數');
  else if (v > CLIP_VERSION) errors.push(`version ${v} 比這個版本支援的 ${CLIP_VERSION} 新，請更新遊戲`);
  if (!finite(raw.hz) || raw.hz < 10 || raw.hz > 1000) errors.push('hz 不合法');
  const steps = raw.steps;
  if (typeof steps !== 'number' || !Number.isInteger(steps) || steps < 0 || steps > 1_000_000) errors.push('steps 不合法');
  const start = raw.start;
  if (!isPlainObject(start)) errors.push('start 必須是物件');
  else {
    if (typeof start.levelId !== 'string') errors.push('start.levelId 必須是字串');
    if (!finite(start.yaw) || !finite(start.pitch)) errors.push('start.yaw／pitch 不合法');
    validatePlayerSnapshot(start.player, errors);
    if (!isPlainObject(start.settings) || typeof start.settings.autoSprint !== 'boolean') errors.push('start.settings.autoSprint 不合法');
    const w = start.weapons;
    if (w !== undefined && (!isPlainObject(w) || !finite(w.time) || !finite(w.rng) || !Array.isArray(w.ammo) || !Array.isArray(w.reserve))) {
      errors.push('start.weapons 不合法');
    }
    const t = start.targets;
    if (t !== undefined && (!isPlainObject(t) || !finite(t.time) || !finite(t.rng))) errors.push('start.targets 不合法');
  }
  const path = raw.path;
  if (!isPlainObject(path) || !finite(path.stride) || path.stride < 1 || !Array.isArray(path.points) || path.points.length % 3 !== 0 || !path.points.every(finite)) {
    errors.push('path 不合法');
  }
  if (!isPlainObject(raw.final) || !vec3(raw.final.pos)) errors.push('final.pos 不合法');
  if (!Array.isArray(raw.marks) || !raw.marks.every((m) => Array.isArray(m) && finite(m[0]) && typeof m[1] === 'string')) errors.push('marks 不合法');
  if (raw.tuning !== undefined && !isPlainObject(raw.tuning)) errors.push('tuning 必須是物件');
  if (errors.length > 0) return { ok: false, errors, clip: null, frames: null };
  const frames = decodeFrames(raw.frames, steps as number, errors);
  if (errors.length > 0) return { ok: false, errors, clip: null, frames: null };
  const clip = raw as unknown as InputClip;
  if (!clip.tuning) clip.tuning = {};
  if (typeof clip.name !== 'string' || !clip.name.trim()) clip.name = '未命名錄影';
  return { ok: true, errors, clip, frames };
}

/** 序列化（不縮排；錄影很長）。 */
export function serializeClip(clip: Readonly<InputClip>): string {
  return JSON.stringify(clip);
}

/** 錄影長度（s）。 */
export function clipDuration(clip: Readonly<Pick<InputClip, 'steps' | 'hz'>>): number {
  return clip.steps / clip.hz;
}

/** 四捨五入到 4 位小數（路徑點）。 */
export function roundPath(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}
