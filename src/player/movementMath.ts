// 移動用的純函式（無頭測試、與狀態無關）：Source 式加速／摩擦、Quake 式空中加速、
// 水平速度旋轉、超速阻力、跳躍初速、速度沿碰撞法線投影。
// 速度一律用「可寫的 { x, y, z }」（THREE.Vector3 符合），函式就地修改並回傳同一個物件。

export interface MutableVec3 {
  x: number;
  y: number;
  z: number;
}

/** 由跳躍高度與重力反推起跳初速：v = √(2 g h)。 */
export function jumpSpeedFor(height: number, gravity: number): number {
  return Math.sqrt(Math.max(0, 2 * gravity * height));
}

export function horizontalSpeed(v: Readonly<MutableVec3>): number {
  return Math.hypot(v.x, v.z);
}

/**
 * Source 式加速（只看水平分量）：沿 wishDir（水平單位向量）補速度，
 * 直到 v·wishDir 達到 wishSpeed；每步最多補 accel × wishSpeed × dt。
 * capSpeed：與 v·wishDir 比較的上限（Quake 空中加速用較小的值）；省略時等於 wishSpeed。
 * 回傳實際增加的速度量。
 */
export function accelerate(
  v: MutableVec3,
  wishX: number,
  wishZ: number,
  wishSpeed: number,
  accel: number,
  dt: number,
  capSpeed: number = wishSpeed,
): number {
  if (wishSpeed <= 0 || (wishX === 0 && wishZ === 0)) return 0;
  const current = v.x * wishX + v.z * wishZ;
  const add = capSpeed - current;
  if (add <= 0) return 0;
  const step = Math.min(accel * wishSpeed * dt, add);
  v.x += wishX * step;
  v.z += wishZ * step;
  return step;
}

/**
 * Source 式地面摩擦（只作用在水平分量）：drop = max(speed, stopSpeed) × friction × dt，
 * 速度不會反向（最低歸零）。回傳摩擦後的水平速度。
 */
export function applyFriction(v: MutableVec3, friction: number, stopSpeed: number, dt: number): number {
  const speed = Math.hypot(v.x, v.z);
  if (speed < 1e-6) {
    v.x = 0;
    v.z = 0;
    return 0;
  }
  const control = Math.max(speed, stopSpeed);
  const next = Math.max(0, speed - control * friction * dt);
  const k = next / speed;
  v.x *= k;
  v.z *= k;
  return next;
}

/**
 * 把水平速度朝 (dirX, dirZ)（水平單位向量）旋轉最多 maxAngle 弧度，不改變速率。
 * 兩者夾角大於 maxConeAngle 時不旋轉（例如按後退時不讓速度掉頭）。回傳實際旋轉的角度。
 */
export function rotateHorizontalTowards(
  v: MutableVec3,
  dirX: number,
  dirZ: number,
  maxAngle: number,
  maxConeAngle = Math.PI / 2,
): number {
  const speed = Math.hypot(v.x, v.z);
  if (speed < 1e-6 || maxAngle <= 0 || (dirX === 0 && dirZ === 0)) return 0;
  const cur = Math.atan2(v.x, v.z);
  const target = Math.atan2(dirX, dirZ);
  let delta = target - cur;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  if (Math.abs(delta) > maxConeAngle + 1e-6) return 0;
  const turn = Math.max(-maxAngle, Math.min(maxAngle, delta));
  const a = cur + turn;
  v.x = Math.sin(a) * speed;
  v.z = Math.cos(a) * speed;
  return Math.abs(turn);
}

/**
 * 超速阻力：水平速度超過 softCap 時，只對超出部分施加指數衰減（rate 為 1/s），與步長無關。
 * 回傳處理後的水平速度。
 */
export function applyOverspeedDrag(v: MutableVec3, softCap: number, rate: number, dt: number): number {
  const speed = Math.hypot(v.x, v.z);
  if (speed <= softCap || rate <= 0) return speed;
  const next = softCap + (speed - softCap) * Math.exp(-rate * dt);
  const k = next / speed;
  v.x *= k;
  v.z *= k;
  return next;
}

/** 把水平速度限制在 maxSpeed 以內（方向不變）。回傳處理後的水平速度。 */
export function clampHorizontalSpeed(v: MutableVec3, maxSpeed: number): number {
  const speed = Math.hypot(v.x, v.z);
  if (speed <= maxSpeed || speed < 1e-9) return speed;
  const k = Math.max(0, maxSpeed) / speed;
  v.x *= k;
  v.z *= k;
  return maxSpeed;
}

/** 速度沿法線投影：v 有朝法線內側的分量時移除（撞牆不累積速度、沿牆滑行）。回傳移除的量。 */
export function clipVelocity(v: MutableVec3, nx: number, ny: number, nz: number): number {
  const d = v.x * nx + v.y * ny + v.z * nz;
  if (d >= 0) return 0;
  v.x -= nx * d;
  v.y -= ny * d;
  v.z -= nz * d;
  return -d;
}

/**
 * 重力沿坡面的水平分量（加在水平速度上）：g_t = g − (g·n)n，g = (0, −G, 0)，
 * 水平部分 = G · n.y · (n.x, n.z)，大小 G sinθ cosθ。
 */
export function slopeGravityHorizontal(
  gravity: number,
  nx: number,
  ny: number,
  nz: number,
  out: { x: number; z: number },
): { x: number; z: number } {
  out.x = gravity * ny * nx;
  out.z = gravity * ny * nz;
  return out;
}

/** 輸入方向 (moveX 向右, moveY 向前) 與正前方的夾角（弧度，0..π）。 */
export function inputAngleFromForward(moveX: number, moveY: number): number {
  return Math.abs(Math.atan2(moveX, moveY));
}

/**
 * 依視角 yaw（0 面向 -Z、正值向左）把移動輸入轉成世界水平方向（未正規化，長度 = 輸入長度）。
 */
export function wishDirection(moveX: number, moveY: number, yaw: number, out: { x: number; z: number }): { x: number; z: number } {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  // forward = (-sin, -cos)，right = (cos, -sin)
  out.x = -s * moveY + c * moveX;
  out.z = -c * moveY - s * moveX;
  return out;
}
