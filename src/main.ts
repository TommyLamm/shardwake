// M1-01 開機場景：確認 renderer、建置後的 Rapier WASM 與平台 iframe 環境都正常。
// 真正的主迴圈、Viewport 與 Stats 由 M1-02 取代。
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { BOOT_SCENE_CONFIG as CFG } from '@/bootConfig';
import './style.css';

function getAppRoot(): HTMLElement {
  const el = document.getElementById('app');
  if (!el) throw new Error('找不到 #app 容器');
  return el;
}

async function initPhysics(): Promise<RAPIER.World> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: CFG.gravityY, z: 0 });
  console.info(
    `[shardwake] Rapier ${RAPIER.version()} 已初始化；crossOriginIsolated=${String(
      globalThis.crossOriginIsolated ?? false,
    )}；SharedArrayBuffer ${typeof SharedArrayBuffer === 'undefined' ? '不可用' : '可用'}（不需要）`,
  );
  return world;
}

function createScene(app: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CFG.maxPixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(CFG.clearColor);
  app.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(CFG.clearColor, 6, 30);
  const camera = new THREE.PerspectiveCamera(CFG.fov, 1, 0.05, 200);
  camera.position.set(0, 1.4, 4.2);
  camera.lookAt(0, 0.6, 0);

  scene.add(new THREE.HemisphereLight(0x5a7a9a, 0x05080d, 0.6));
  const key = new THREE.PointLight(CFG.glowColor, CFG.glowLightIntensity, 12, 2);
  key.position.set(0, 0.6, 0);
  scene.add(key);

  const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
  const cube = new THREE.Mesh(
    cubeGeo,
    new THREE.MeshStandardMaterial({
      color: 0x0b1a22,
      emissive: CFG.glowColor,
      emissiveIntensity: CFG.emissiveIntensity,
      metalness: 0.3,
      roughness: 0.35,
    }),
  );
  cube.position.y = 0.6;
  cube.add(
    new THREE.LineSegments(
      new THREE.EdgesGeometry(cubeGeo),
      new THREE.LineBasicMaterial({ color: 0xe6fdff }),
    ),
  );
  // 簡易光暈殼：加法混色的背面放大方塊（正式 Bloom 在 M1-09）。
  const halo = new THREE.Mesh(
    cubeGeo,
    new THREE.MeshBasicMaterial({
      color: CFG.glowColor,
      transparent: true,
      opacity: CFG.haloOpacity,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  halo.scale.setScalar(CFG.haloScale);
  cube.add(halo);
  scene.add(cube);

  const grid = new THREE.GridHelper(40, 40, CFG.glowColor, 0x1b2a36);
  scene.add(grid);

  return { renderer, scene, camera, cube };
}

function createFpsLabel(app: HTMLElement): HTMLDivElement {
  const label = document.createElement('div');
  label.className = 'sw-fps';
  label.textContent = 'FPS --';
  app.appendChild(label);
  return label;
}

async function boot(): Promise<void> {
  const app = getAppRoot();
  const { renderer, scene, camera, cube } = createScene(app);
  const fpsLabel = createFpsLabel(app);

  // iframe 尺寸會因平台顯示模式切換而改變（不重載），追蹤容器而不是 window。
  const resize = (): void => {
    const w = Math.max(1, app.clientWidth);
    const h = Math.max(1, app.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(app);
  resize();

  const world = await initPhysics();

  let frames = 0;
  let windowStart = performance.now();
  let last = windowStart;
  renderer.setAnimationLoop((now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    world.step();
    cube.rotation.x += CFG.spinSpeed.x * dt;
    cube.rotation.y += CFG.spinSpeed.y * dt;
    renderer.render(scene, camera);

    frames++;
    const elapsed = now - windowStart;
    if (elapsed >= CFG.fpsSampleMs) {
      const fps = (frames * 1000) / elapsed;
      fpsLabel.textContent = `FPS ${fps.toFixed(0).padStart(3, ' ')}  ${(elapsed / frames).toFixed(2)} ms`;
      frames = 0;
      windowStart = now;
    }
  });

  document.documentElement.dataset.swBoot = 'ready';
}

boot().catch((err: unknown) => {
  document.documentElement.dataset.swBoot = 'error';
  console.error('[shardwake] 啟動失敗', err);
});
