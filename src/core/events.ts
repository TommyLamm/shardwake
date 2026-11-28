// 全遊戲的事件表（集中在這一個檔案）。之後每份計畫把自己的事件加在對應段落，
// 事件名稱用「領域:動作」，payload 一律是普通物件（或 void），由 EventBus 同步派送。
// 熱迴圈內每步都會發的事件，payload 應重複使用同一個物件，避免配置記憶體。
import type { DamageInfo } from '@/combat/Damage';
import type { Settings, SettingsKey } from '@/core/Settings';

/** 遊戲模式：boot → title → playing ⇄ paused（paused／playing 可回 title）。 */
export type GameMode = 'boot' | 'title' | 'playing' | 'paused';

/** 進入暫停的原因；UI 依此決定顯示內容（例如「點擊繼續」）。 */
export type PauseReason = 'user' | 'hidden' | 'blur' | 'pointerlock' | 'debug';

export interface GameEvents {
  // ── core：Game ──────────────────────────────────────────
  /** 模式切換後發出。 */
  'game:mode': { from: GameMode; to: GameMode; reason?: PauseReason | undefined };

  // ── core：Settings ─────────────────────────────────────
  /** 設定變更（已驗證、已存檔）後發出；changed 為實際改變的欄位。 */
  'settings:changed': { settings: Readonly<Settings>; changed: readonly SettingsKey[] };

  // ── core：Storage ──────────────────────────────────────
  /** 儲存狀態改變（例如寫入失敗而退回記憶體）；UI 顯示「目前無法存檔」。 */
  'storage:status': { persistent: boolean; reason?: string | undefined };

  // ── core：Viewport ─────────────────────────────────────
  /** 遊戲容器（iframe 內）尺寸或像素比改變後發出；寬高為 CSS 像素。 */
  'viewport:resize': { width: number; height: number; pixelRatio: number; aspect: number };

  // ── core：Lifecycle ────────────────────────────────────
  /** 頁面可見性改變（切分頁、縮小視窗）。 */
  'lifecycle:visibility': { hidden: boolean };
  /** iframe 取得／失去焦點。 */
  'lifecycle:focus': { focused: boolean };

  // ── input（M1-03）────────────────────────────────────
  /** 滑鼠鎖定狀態改變或鎖定失敗（error 有值）。raw：是否為原始輸入（unadjustedMovement）。 */
  'input:pointerlock': { locked: boolean; raw: boolean; error?: string | undefined };
  /** 按鍵綁定變更（已存檔）。 */
  'input:bindings': Record<string, never>;

  // ── physics（M1-04）──────────────────────────────────
  /** 物理世界重建（換關卡）；舊的 Collider 與 handle 全部失效。 */
  'physics:reset': Record<string, never>;

  // ── world：Level（M1-04）─────────────────────────────
  /** 關卡載入完成（碰撞體與網格都已建立）。 */
  'level:loaded': { id: string; name: string };
  /** 關卡卸載（物理世界重建前）。 */
  'level:unloaded': { id: string };
  /** 追蹤對象（玩家或自由相機）進入／離開區域；event 為區域資料指定的觸發事件名稱。 */
  'level:zone': { levelId: string; zoneId: string; entered: boolean; event?: string | undefined };
  /** 追蹤對象落入 killVolume，回到檢查點。 */
  'level:respawn': { levelId: string; checkpointId: string };

  // ── player：移動（M1-05）──────────────────────────────
  // payload 物件由 PlayerController 重複使用：要保存請自行複製。
  /** 移動狀態切換（ground／air／slide／wallRun／mantle／dash／grapple）。 */
  'player:state': { from: string; to: string };
  /** 起跳（地面、土狼時間或滑鏟中）。 */
  'player:jump': { fromState: string; coyote: boolean };
  /** 落地；impactSpeed 為落地前的下落速度（m/s，正值）。 */
  'player:land': { impactSpeed: number; surface: string };
  /** 開始滑鏟；boosted 表示這次有推進（不在冷卻中）。 */
  'player:slideStart': { speed: number; boosted: boolean };
  /** 結束滑鏟。 */
  'player:slideEnd': { speed: number };
  /** 姿勢改變（蹲下或起身）。 */
  'player:crouch': { crouched: boolean };
  /** 腳步（地面移動每走 footstepStride 公尺一次）；surface 為腳下表面材質。 */
  'player:footstep': { surface: string; speed: number };
  /** 落入 killVolume 後回到檢查點（速度歸零）；pos 為重生的腳底位置。 */
  'player:respawn': { pos: { x: number; y: number; z: number } };

  // ── player：跑牆、蹬牆跳、攀爬（M1-06）─────────────────
  /** 開始跑牆；side 為牆在玩家（行進方向）的哪一側，normal 為牆面法線（水平、朝牆外）。 */
  'player:wallRunStart': { side: 'left' | 'right'; normal: { x: number; y: number; z: number } };
  /**
   * 結束跑牆；reason：jump（蹬牆跳）、released（放開前進）、wallEnded（偵測不到牆）、slow（速度太低）、
   * crouch（按蹲）、timeout（超過最長時間）、landed（著地）、mantle（轉為攀爬）、other（其他狀態打斷）。
   */
  'player:wallRunEnd': { reason: string; duration: number };
  /** 蹬牆跳；normal 為蹬離的牆面法線，grace 表示是在離牆後的寬限時間內起跳。 */
  'player:wallJump': { normal: { x: number; y: number; z: number }; speed: number; grace: boolean };
  /** 開始攀爬；height 為邊緣高度（腳底以上，m），duration 為動作時間（武器短暫放低用）。 */
  'player:mantle': { height: number; duration: number; fromState: string };
  /** 空中能力重置（M1-07 的二段跳次數；重生時另外補滿燃料、Dash 充能並清除抓鉤冷卻）：著地、開始跑牆、抓鉤附著、重生。 */
  'player:airReset': { reason: 'land' | 'wallRun' | 'grapple' | 'respawn' };

  // ── player：二段跳、噴射、Dash、抓鉤（M1-07）───────────
  // HUD（M1-14）、音效（M1-13）、鏡頭（M1-08）使用；唯讀狀態見 player.abilities.state。
  /** 二段跳；remaining 為剩餘空中跳躍次數。 */
  'player:doubleJump': { speed: number; remaining: number };
  /** 噴射開始；fuel 為剩餘燃料（s）。 */
  'player:jetStart': { fuel: number };
  /** 噴射停止；reason：released（放開跳）、empty（燃料耗盡）、landed（著地）、state（離開空中狀態）、disabled。 */
  'player:jetStop': { fuel: number; reason: string };
  /** Dash；dir 為水平單位方向，charges 為使用後剩餘的充能。 */
  'player:dash': { dir: { x: number; y: number; z: number }; fromState: string; charges: number };
  /** 發射鉤爪；origin 為相機位置，dir 為視線方向（單位向量）。 */
  'player:grappleFire': { origin: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number } };
  /** 鉤爪附著；distance 為發射點到錨點的距離（m）。 */
  'player:grappleAttach': {
    point: { x: number; y: number; z: number };
    normal: { x: number; y: number; z: number };
    distance: number;
  };
  /** 脫鉤；reason：close（距離夠近）、passed（越過錨點）、input（放開／再按）、jump、timeout、disabled、other。 */
  'player:grappleRelease': { reason: string; duration: number };
  /** 鉤爪落空：range（超出射程）、surface（打到不可勾的表面）、cancel（飛行中放開）；point 為鉤爪停下的位置。 */
  'player:grappleMiss': { reason: string; point: { x: number; y: number; z: number } };
  /** 準星輔助：視線上射程內是否有可勾的表面（改變時發出）；distance 為命中距離（沒有時為 0）。 */
  'player:grappleAim': { available: boolean; distance: number };
  /** 能力恢復可用：Dash 回充一格、抓鉤冷卻結束、噴射燃料回滿。 */
  'player:abilityReady': { ability: 'dash' | 'grapple' | 'jet'; charges: number };

  // ── weapons：武器（M1-10）──────────────────────────────
  // viewmodel／特效／準星（M1-11）、靶標（M1-12）、音效（M1-13）、HUD（M1-14）使用；唯讀狀態見 weapons.state。
  // payload 物件重複使用（同一步可能發好幾次，例如全自動補發、霰彈每顆彈丸）：要保存請自行複製。
  /**
   * 開火（每發一次，霰彈的所有彈丸算一發）。origin 為射擊起點（眼睛），dir 為中心方向（含後座偏移與整體散布）；
   * spread 為這一發的散布半角（度）；recoil 為這一發加上的後座（度，視角慣例：pitch 往上、yaw 往左為正）。
   */
  'weapon:fire': {
    weaponId: string;
    slot: number;
    shotId: number;
    time: number;
    origin: { x: number; y: number; z: number };
    dir: { x: number; y: number; z: number };
    pellets: number;
    ammo: number;
    mag: number;
    spread: number;
    ads: number;
    mode: string;
    firstShot: boolean;
    recoilPitch: number;
    recoilYaw: number;
  };
  /** hitscan 每顆彈丸一次（曳光、彈孔）：end 為終點；hitWorld 時 normal／surface 為命中的牆面；targets 為命中的目標數。 */
  'weapon:hitscan': {
    shotId: number;
    weaponId: string;
    pellet: number;
    origin: { x: number; y: number; z: number };
    end: { x: number; y: number; z: number };
    normal: { x: number; y: number; z: number };
    hitWorld: boolean;
    surface: string | null;
    targets: number;
  };
  /** 扣扳機但彈匣是空的（沒有自動換彈時；音效「喀」）。 */
  'weapon:dryFire': { weaponId: string; slot: number };
  /** 開始換彈；kind：tactical（還有彈）、empty（空倉）、shell（逐發裝填）；duration 為預計時間（s）。 */
  'weapon:reloadStart': { weaponId: string; slot: number; kind: string; duration: number; ammo: number; time: number };
  /** 逐發裝填：一發入膛。 */
  'weapon:reloadShell': { weaponId: string; slot: number; ammo: number; time: number };
  /**
   * 換彈結束：completed（動作做完）或被取消（reason：swap、sprint、fire、melee、other）；refilled 表示彈匣已補（或已入膛至少一發）。
   */
  'weapon:reloadEnd': {
    weaponId: string;
    slot: number;
    completed: boolean;
    refilled: boolean;
    reason: string;
    ammo: number;
    /** 結束的模擬時間（s；M1-11 viewmodel 的換彈姿勢淡出從這裡起算）。reloadStart／reloadShell 的 time 同為模擬時間。 */
    time: number;
  };
  /**
   * 切換武器：phase 'out'（開始收槍，duration = 收槍 + 掏槍總時間）、'in'（換成新槍、開始掏槍）、'done'（可以射擊）。
   * slot 為 0..4。
   */
  'weapon:swap': {
    phase: 'out' | 'in' | 'done';
    fromId: string;
    toId: string;
    fromSlot: number;
    toSlot: number;
    duration: number;
  };
  /** 開鏡目標改變（active：開始開鏡／開始退出）；forced 表示被 Dash、攀爬、切槍、近戰強制退出。 */
  'weapon:ads': { weaponId: string; active: boolean; forced: boolean };
  /** 近戰：start（出手；lunge 表示有目標並突進）、hit（命中，damage 為傷害）、miss（沒打到）。 */
  'weapon:melee': { phase: 'start' | 'hit' | 'miss'; lunge: boolean; damage: number };
  /** 投射物生成、命中、逾時（音效與特效；外觀讀 ballistics.projectiles）。 */
  'weapon:projectile': {
    phase: 'spawn' | 'impact' | 'expire';
    id: number;
    shotId: number;
    weaponId: string;
    position: { x: number; y: number; z: number };
    velocity: { x: number; y: number; z: number };
  };
  /** 爆炸（投射物命中）：targets 為受到範圍傷害的目標數，selfKnockback 為玩家受到的擊退速度（m/s；0 = 不在範圍內）。 */
  'weapon:explosion': {
    shotId: number;
    weaponId: string;
    point: { x: number; y: number; z: number };
    normal: { x: number; y: number; z: number };
    radius: number;
    targets: number;
    selfKnockback: number;
  };

  // ── combat：傷害（M1-10 發出，M1-12 受擊回饋）───────────
  /**
   * 每一筆傷害（每顆彈丸、每次範圍傷害、每次近戰；M1-12 起也包含打在玩家身上的傷害，target 為 PlayerHealth、
   * source 為攻擊者 id）；欄位見 combat/Damage.ts 的 DamageInfo。
   */
  'combat:damage': DamageInfo;
  /**
   * 命中確認（M1-12）：玩家這一步造成的傷害彙總（每個固定步最多一次；霰彈 10 顆彈丸只發一次）。
   * kind 為最高優先的結果（kill > crit > hit）；命中標記（ui/HitMarker）與 M1-13 命中音效使用。
   */
  'combat:hit': { kind: 'hit' | 'crit' | 'kill'; hits: number; crits: number; kills: number; amount: number; weaponId: string };

  // ── player：生命與護盾（M1-12）──────────────────────────
  // HUD（M1-14）、音效（M1-13）、鏡頭與受擊回饋使用；唯讀狀態見 PlayerHealth.state。payload 物件重複使用。
  /**
   * 玩家受到傷害。amount 為這一筆的傷害量（blocked 時為原始傷害、實際未扣血），shieldDamage／healthDamage 為實際扣掉的量；
   * dir 為傷害行進方向（攻擊者 → 玩家），sourcePos 為攻擊者位置（受擊方向指示用）；shieldBroken 表示這一筆把護盾打到 0。
   */
  'player:damaged': {
    amount: number;
    shieldDamage: number;
    healthDamage: number;
    shield: number;
    health: number;
    shieldBroken: boolean;
    blocked: boolean;
    dir: { x: number; y: number; z: number };
    sourcePos: { x: number; y: number; z: number };
    source: string;
    weaponId: string;
  };
  /** 玩家死亡（開始淡出；deathFadeTime 後重生）。 */
  'player:died': { source: string; weaponId: string; deaths: number };
  /** 死亡後重生完成（已傳送到出生點、護盾與生命回滿）。 */
  'player:revived': { deaths: number };
  /** 護盾開始回充（受傷後 shieldRegenDelay 秒）或回滿。 */
  'player:shield': { phase: 'recharge' | 'full'; shield: number };

  // ── combat：靶標與敵方投射物（M1-12；M3 的敵人沿用）──────
  /** 靶標或敵人被擊殺；kind：dummy（靜態假人）、mover（移動靶）、drone（訓練無人機）。point 為目標中心。 */
  'target:killed': { id: string; kind: string; point: { x: number; y: number; z: number }; weaponId: string; isCrit: boolean };
  /** 靶標重置（假人站起、無人機重生）。 */
  'target:reset': { id: string; kind: string };
  /** 敵方開火（無人機能量球；M3 的敵人沿用）：position 為發射點，dir 為單位方向。 */
  'enemy:fire': { source: string; position: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number }; speed: number };
  /** 敵方投射物結束：impact（打到世界）、hitPlayer（打到玩家）、expire（逾時）。 */
  'enemy:projectile': {
    phase: 'impact' | 'hitPlayer' | 'expire';
    id: number;
    source: string;
    position: { x: number; y: number; z: number };
    normal: { x: number; y: number; z: number };
  };

  // ── debug ──────────────────────────────────────────────
  /** 調參面板開啟或關閉。 */
  'debug:panel': { open: boolean };
}

export type GameEventName = keyof GameEvents;
