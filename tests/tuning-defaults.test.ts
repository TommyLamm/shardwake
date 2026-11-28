// M1-16 手感總調校：定案預設值的一致性檢查（沒有真人試玩，只檢查可以用數據證明的問題）。
// - 每個調參面板欄位的預設值都在滑桿範圍內（否則一碰滑桿就被夾住，調參與匯出的預設會悄悄改值）。
// - 移動數值之間的關係（門檻與目標速度、滑鏟與衝刺、跑牆進出、跳躍可攀上的高度）。
// - 5 把武器的定案值通過 validateWeaponDef。
import { describe, expect, it } from 'vitest';
import type { ConfigSchema, ParamSpec } from '@/debug/DebugPanel';
import { MOVEMENT_CONFIG, MOVEMENT_PANEL } from '@/player/MovementConfig';
import { CAMERA_CONFIG, CAMERA_PANEL } from '@/camera/CameraConfig';
import { VIEWMODEL_CONFIG, VIEWMODEL_PANEL } from '@/weapons/ViewmodelConfig';
import { WEAPON_SYSTEM_CONFIG, WEAPON_SYSTEM_PANEL } from '@/weapons/WeaponConfig';
import { readWeaponField, WEAPON_FIELD_GROUPS } from '@/weapons/WeaponPanel';
import { ARCHETYPES } from '@/weapons/archetypes';
import { validateWeaponDef } from '@/weapons/WeaponDef';
import { FX_CONFIG, FX_PANEL, FX_STYLE_PANEL, WEAPON_FX_STYLES } from '@/fx/FxConfig';
import { FEEDBACK_CONFIG, DAMAGE_NUMBER_PANEL, HIT_CAMERA_PANEL, HIT_MARKER_PANEL, INDICATOR_PANEL, SCREEN_DAMAGE_PANEL } from '@/ui/FeedbackConfig';
import { DRONE_PANEL, DUMMY_PANEL, FLASH_PANEL, MOVER_PANEL, TARGET_CONFIG } from '@/combat/targets/TargetConfig';
import { PLAYER_HEALTH_CONFIG, PLAYER_HEALTH_PANEL } from '@/combat/PlayerHealth';
import { CROSSHAIR_CONFIG, CROSSHAIR_PANEL } from '@/ui/Crosshair';
import { HUD_ABILITY_PANEL, HUD_CONFIG, HUD_LAYOUT_PANEL, HUD_MESSAGE_PANEL, HUD_VITALS_PANEL, HUD_WEAPON_PANEL } from '@/ui/HudConfig';
import { SPEED_LINES_CONFIG, SPEED_LINES_PANEL } from '@/fx/SpeedLines';
import { HOLO_PANEL, LIGHTING_PANEL, POSTFX_PANEL, SKY_PANEL } from '@/fx/VisualPanel';
import { POSTFX_CONFIG } from '@/fx/PostFX';
import { LIGHTING_CONFIG } from '@/world/Lighting';
import { SKY_CONFIG } from '@/world/Sky';
import { HOLO_CONFIG } from '@/world/HoloBoards';
import { AUDIO_CONFIG, AUDIO_DYNAMICS_PANEL, AUDIO_EVENT_PANEL, AUDIO_MIX_PANEL, AUDIO_PLAYBACK_PANEL, AUDIO_SPATIAL_PANEL } from '@/audio/AudioConfig';

/** 找出數值欄位中，預設值不在 [min, max] 的欄位。 */
function outOfRange(name: string, obj: object, schema: ConfigSchema<never> | Record<string, ParamSpec | undefined>): string[] {
  const bad: string[] = [];
  for (const [key, spec] of Object.entries(schema as Record<string, ParamSpec | undefined>)) {
    if (!spec || spec.readonly) continue;
    const v = (obj as Record<string, unknown>)[key];
    if (typeof v !== 'number') continue;
    if ((spec.min !== undefined && v < spec.min - 1e-9) || (spec.max !== undefined && v > spec.max + 1e-9))
      bad.push(`${name}.${key} = ${v}（範圍 ${spec.min ?? '-∞'}–${spec.max ?? '∞'}）`);
  }
  return bad;
}

describe('預設值都在調參面板的範圍內', () => {
  it('移動、鏡頭、viewmodel、武器系統', () => {
    const bad: string[] = [];
    for (const g of MOVEMENT_PANEL) bad.push(...outOfRange(`移動/${g.folder}`, MOVEMENT_CONFIG, g.schema));
    for (const g of CAMERA_PANEL) bad.push(...outOfRange(`鏡頭/${g.folder}`, CAMERA_CONFIG, g.schema));
    for (const g of VIEWMODEL_PANEL) bad.push(...outOfRange(`viewmodel/${g.folder}`, VIEWMODEL_CONFIG, g.schema));
    for (const g of WEAPON_SYSTEM_PANEL) bad.push(...outOfRange(`武器系統/${g.folder}`, WEAPON_SYSTEM_CONFIG, g.schema));
    expect(bad).toEqual([]);
  });

  it('5 把武器的每個面板欄位', () => {
    const bad: string[] = [];
    for (const def of ARCHETYPES)
      for (const g of WEAPON_FIELD_GROUPS)
        for (const f of g.fields) {
          const v = readWeaponField(def, f.path);
          if (typeof v !== 'number' || (f.optional && v === 0)) continue;
          const s = f.spec;
          if ((s.min !== undefined && v < s.min - 1e-9) || (s.max !== undefined && v > s.max + 1e-9)) bad.push(`${def.id}.${f.path} = ${v}（範圍 ${s.min}–${s.max}）`);
        }
    expect(bad).toEqual([]);
  });

  it('特效、回饋、靶標、生命、準星、HUD、速度線', () => {
    const bad: string[] = [
      ...outOfRange('特效', FX_CONFIG, FX_PANEL),
      ...Object.entries(WEAPON_FX_STYLES).flatMap(([k, s]) => outOfRange(`特效風格/${k}`, s, FX_STYLE_PANEL)),
      ...outOfRange('命中標記', FEEDBACK_CONFIG.hitMarker, HIT_MARKER_PANEL),
      ...outOfRange('傷害數字', FEEDBACK_CONFIG.numbers, DAMAGE_NUMBER_PANEL),
      ...outOfRange('受擊方向', FEEDBACK_CONFIG.indicator, INDICATOR_PANEL),
      ...outOfRange('受擊畫面', FEEDBACK_CONFIG.screen, SCREEN_DAMAGE_PANEL),
      ...outOfRange('受擊鏡頭', FEEDBACK_CONFIG.camera, HIT_CAMERA_PANEL),
      ...outOfRange('假人', TARGET_CONFIG.dummy, DUMMY_PANEL),
      ...outOfRange('移動靶', TARGET_CONFIG.mover, MOVER_PANEL),
      ...outOfRange('無人機', TARGET_CONFIG.drone, DRONE_PANEL),
      ...outOfRange('受擊閃光', TARGET_CONFIG.flash, FLASH_PANEL),
      ...outOfRange('玩家生命', PLAYER_HEALTH_CONFIG, PLAYER_HEALTH_PANEL),
      ...outOfRange('準星', CROSSHAIR_CONFIG, CROSSHAIR_PANEL),
      ...outOfRange('HUD 版面', HUD_CONFIG.layout, HUD_LAYOUT_PANEL),
      ...outOfRange('HUD 生命條', HUD_CONFIG.vitals, HUD_VITALS_PANEL),
      ...outOfRange('HUD 能力', HUD_CONFIG.abilities, HUD_ABILITY_PANEL),
      ...outOfRange('HUD 武器', HUD_CONFIG.weapon, HUD_WEAPON_PANEL),
      ...outOfRange('HUD 訊息', HUD_CONFIG.messages, HUD_MESSAGE_PANEL),
      ...outOfRange('速度線', SPEED_LINES_CONFIG, SPEED_LINES_PANEL),
      ...outOfRange('後處理', POSTFX_CONFIG, POSTFX_PANEL),
      ...outOfRange('燈光', LIGHTING_CONFIG, LIGHTING_PANEL),
      ...outOfRange('天空', SKY_CONFIG, SKY_PANEL),
      ...outOfRange('全息看板', HOLO_CONFIG, HOLO_PANEL),
      ...outOfRange('音效混音', AUDIO_CONFIG.mix, AUDIO_MIX_PANEL),
      ...outOfRange('音效動態', AUDIO_CONFIG.dynamics, AUDIO_DYNAMICS_PANEL),
      ...outOfRange('音效播放', AUDIO_CONFIG.playback, AUDIO_PLAYBACK_PANEL),
      ...outOfRange('音效空間', AUDIO_CONFIG.spatial, AUDIO_SPATIAL_PANEL),
      ...outOfRange('音效事件', AUDIO_CONFIG.events, AUDIO_EVENT_PANEL),
    ];
    expect(bad).toEqual([]);
  });
});

describe('移動數值之間的關係', () => {
  const m = MOVEMENT_CONFIG;
  it('地面速度與滑鏟、跑牆的門檻', () => {
    expect(m.crouchSpeed).toBeLessThan(m.runSpeed);
    expect(m.runSpeed).toBeLessThan(m.sprintSpeed);
    // 跑步與衝刺都能直接滑鏟；滑鏟結束速度低於開始門檻（不會一開始就結束）。
    expect(m.slideMinSpeed).toBeLessThanOrEqual(m.runSpeed);
    expect(m.slideEndSpeed).toBeLessThan(m.slideMinSpeed);
    expect(m.slideBoostMaxSpeed).toBeGreaterThan(m.sprintSpeed);
    // 衝刺起跳可以進入跑牆；跑牆結束速度低於進入門檻。
    expect(m.wallRunMinSpeed).toBeLessThanOrEqual(m.sprintSpeed);
    expect(m.wallRunEndSpeed).toBeLessThan(m.wallRunMinSpeed);
    expect(m.wallRunEntrySpeed).toBeGreaterThanOrEqual(m.wallRunMinSpeed);
    // 坡度：能爬的坡不會同時被判定成滑落。
    expect(m.maxSlopeClimbDeg).toBeLessThanOrEqual(m.minSlopeSlideDeg);
  });

  it('跳躍、二段跳與攀爬可以上到 4 m 牆（訓練場攀爬測試牆）', () => {
    const v0 = Math.sqrt(2 * m.gravity * m.jumpHeight);
    const doubleRise = (m.doubleJumpSpeed * m.doubleJumpSpeed) / (2 * m.gravity);
    const reach = m.jumpHeight + doubleRise + m.mantleMaxHeight;
    expect(v0).toBeGreaterThan(0);
    expect(reach).toBeGreaterThan(4);
    // 只跳一次可以攀上 2.5 m 平台邊緣以上（mantle 上限 + 跳高）。
    expect(m.jumpHeight + m.mantleMaxHeight).toBeGreaterThan(2.5);
  });

  it('Dash 與抓鉤的速度', () => {
    const dashSpeed = m.dashDistance / m.dashDuration;
    expect(dashSpeed).toBeGreaterThan(m.sprintSpeed);
    expect(m.dashExitMinSpeed).toBeLessThan(dashSpeed);
    expect(m.grappleMaxSpeed).toBeGreaterThan(m.sprintSpeed);
    expect(m.grappleReleaseDistance).toBeLessThan(m.grappleRange);
    expect(m.jetMaxRiseSpeed).toBeLessThan(m.doubleJumpSpeed);
  });
});

describe('武器定案值', () => {
  it('5 把武器都通過 validateWeaponDef，id 不重複', () => {
    for (const def of ARCHETYPES) expect(validateWeaponDef(def), def.id).toMatchObject({ ok: true });
    expect(new Set(ARCHETYPES.map((d) => d.id)).size).toBe(5);
  });
});
