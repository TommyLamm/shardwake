// 物理的可調數值（調參面板「物理」資料夾）。物件保持可變，Physics 每次使用時讀取最新值。

export interface PhysicsConfig {
  /** 世界重力 y（m/s²），只作用在動態物件（碎片、掉落物）；玩家用 MovementConfig 的自訂重力（M1-05）。 */
  worldGravityY: number;
  /** 動態物件的速度求解迭代次數（Rapier numSolverIterations）。 */
  solverIterations: number;
}

export const PHYSICS_CONFIG: PhysicsConfig = {
  worldGravityY: -9.81,
  solverIterations: 4,
};
