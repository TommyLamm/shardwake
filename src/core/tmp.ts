// 熱迴圈用的共用暫存物件，避免每畫面配置記憶體。
// 規則：
//   1. 只在單一函式內短暫使用，函式結束前用完；不要保存參考或回傳給呼叫端長期持有。
//   2. 使用暫存物件期間不要呼叫「可能也使用同一個暫存物件」的其他函式；
//      不確定時改用模組自己的暫存（例如檔案頂層 const _v = new Vector3()）。
//   3. 依序號從小到大取用，函式內同時需要多個時用不同序號。
import { Euler, Matrix4, Quaternion, Vector2, Vector3 } from 'three';

export const tmpV2a = new Vector2();
export const tmpV2b = new Vector2();

export const tmpV3a = new Vector3();
export const tmpV3b = new Vector3();
export const tmpV3c = new Vector3();
export const tmpV3d = new Vector3();
export const tmpV3e = new Vector3();
export const tmpV3f = new Vector3();

export const tmpQa = new Quaternion();
export const tmpQb = new Quaternion();
export const tmpQc = new Quaternion();

export const tmpEuler = new Euler(0, 0, 0, 'YXZ');
export const tmpM4 = new Matrix4();

/** 唯讀常數向量（不要修改）。 */
export const VEC3_ZERO: Readonly<Vector3> = Object.freeze(new Vector3(0, 0, 0));
export const VEC3_UP: Readonly<Vector3> = Object.freeze(new Vector3(0, 1, 0));
export const VEC3_FORWARD: Readonly<Vector3> = Object.freeze(new Vector3(0, 0, -1));
