/*
 * The 3D hutch is drawn in two layers. Almost all of it stands still between changes: it is rendered once, with its
 * multisampling, shadows and ambient occlusion, into a cached colour and depth image. Every frame then copies that image
 * and draws only what moves (the photons, the beam outline, the electron bunches) on top, depth tested against the
 * cached depth, before bloom, vignette and tone mapping. On an Intel UHD 770 at 4K this took a frame from about 180 ms
 * (ambient occlusion and the whole hutch recomputed 30 times a second) to the moving layer and the final effects.
 *
 * The cached image is the same picture as before. The one difference is physical: the glowing packets no longer write
 * the depth the ambient occlusion reads, so they no longer darken the walls around them; light sources cast no
 * ambient shadow.
 */
import * as THREE from 'three';
import type { EffectComposer, Pass } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

/** The layer of everything that moves every frame; objects on it are left out of the cached image. */
export const MOVING_LAYER = 1;

let version = 0;
/** Something in the still part of the hutch changed: redraw the cached image on the next frame. */
export function markStaticDirty() { version++; }

/**
 * How long a frame that redraws the still image takes, ms (smoothed; zero until measured): its GPU work shows up as
 * the gap to the next frame. Frames in the first two seconds are left out (shaders compile, textures upload). The idle
 * sway turns the camera, which redraws the still image every frame: it starts as a trial while the cost is unknown,
 * which measures it within a few frames, and holds still for good once a redraw is found not to fit in a frame.
 */
let stillFrame_ms = 0;
export const stillRedrawFits = (frame_ms = 1000 / 30) => stillFrame_ms === 0 || stillFrame_ms <= frame_ms * 1.3;
const WARM_UP_MS = 2000;

/** Put an object (not its children: three.js layers are not inherited) on the moving layer. */
export function moving(object: THREE.Object3D | null) { object?.layers.set(MOVING_LAYER); }

/** The still image's multisampling and ambient occlusion: the quality the hutch has always had in each view. */
export interface CacheSettings { multisampling: number; quality: 'Performance' | 'Low' | 'Ultra'; halfRes: boolean }

/** Ambient occlusion as the hutch had it: radius 24 units, falloff 0.8, intensity 2.2, at the quality given. */
function makeAO(scene: THREE.Scene, camera: THREE.Camera, settings: CacheSettings) {
  const ao = new N8AOPostPass(scene, camera, 1, 1);
  Object.assign(ao.configuration, { aoRadius: 24, distanceFalloff: 0.8, intensity: 2.2, halfRes: settings.halfRes, depthAwareUpsampling: true });
  ao.setQualityMode(settings.quality);
  return ao;
}

/** Writes a colour and a depth texture into the bound target: the cached image, with its depth. */
function makeCopy() {
  const material = new THREE.ShaderMaterial({
    uniforms: { tColor: { value: null }, tDepth: { value: null } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D tColor; uniform sampler2D tDepth; varying vec2 vUv; void main() { gl_FragColor = texture2D(tColor, vUv); gl_FragDepth = texture2D(tDepth, vUv).r; }',
    depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth, toneMapped: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(quad);
  return { material, scene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
}

/**
 * Makes the composer's first pass (its RenderPass) draw the hutch from the cache. Returns a function that undoes it
 * and frees the cache's targets.
 */
export function installCache(composer: EffectComposer, scene: THREE.Scene, camera: THREE.Camera, settings: CacheSettings): () => void {
  const pass = composer.passes[0] as Pass & { render: Pass['render'] };
  const original = pass.render.bind(pass);
  const copy = makeCopy();
  let ao = makeAO(scene, camera, settings);
  let still: THREE.WebGLRenderTarget | null = null, lit: THREE.WebGLRenderTarget | null = null;
  let seen = -1, width = 0, height = 0, redrew = false, last = 0;
  const installed = performance.now();
  const view = new THREE.Matrix4(), projection = new THREE.Matrix4();

  pass.render = (renderer, inputBuffer) => {
    const now = performance.now();
    // While anything animates a frame is asked for every 33 ms, so the gap after a redraw is its cost; a gap over 30 s
    // is the view left alone with nothing moving. (Software rendering at 4K takes seconds a frame: it must still count.)
    if (redrew && last && now - installed > WARM_UP_MS && now - last < 30000) stillFrame_ms = stillFrame_ms ? 0.7 * stillFrame_ms + 0.3 * (now - last) : now - last;
    last = now; redrew = false;
    const w = inputBuffer!.width, h = inputBuffer!.height;
    if (w !== width || h !== height || !still || !lit) {
      still?.dispose(); lit?.dispose();
      still = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: settings.multisampling, depthTexture: new THREE.DepthTexture(w, h, THREE.FloatType) });
      lit = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
      ao.setSize(w, h); ao.setDepthTexture(still.depthTexture!);
      width = w; height = h; seen = -1;
    }
    camera.updateMatrixWorld();
    const moved = !view.equals(camera.matrixWorldInverse) || !projection.equals(camera.projectionMatrix);
    if (moved || seen !== version || renderer.shadowMap.needsUpdate) {
      // The still layer, with its shadows (redrawn here when they are due) and its ambient occlusion.
      const mask = camera.layers.mask;
      camera.layers.set(0);
      renderer.setRenderTarget(still);
      renderer.clear();
      renderer.render(scene, camera);
      camera.layers.mask = mask;
      ao.render(renderer, still, lit);
      view.copy(camera.matrixWorldInverse); projection.copy(camera.projectionMatrix); seen = version; redrew = true;
    }
    // Every frame: the cached image and its depth, then the moving layer on top.
    copy.material.uniforms.tColor.value = lit.texture;
    copy.material.uniforms.tDepth.value = still.depthTexture;
    renderer.setRenderTarget(inputBuffer!);
    renderer.clear();
    renderer.render(copy.scene, copy.camera);
    const mask = camera.layers.mask, background = scene.background, autoClear = renderer.autoClear;
    camera.layers.set(MOVING_LAYER); scene.background = null; renderer.autoClear = false;
    renderer.render(scene, camera);
    camera.layers.mask = mask; scene.background = background; renderer.autoClear = autoClear;
  };

  return () => {
    pass.render = original;
    still?.dispose(); lit?.dispose(); ao.dispose();
    copy.material.dispose(); (copy.scene.children[0] as THREE.Mesh).geometry.dispose();
  };
}
