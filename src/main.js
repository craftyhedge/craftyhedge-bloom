import './styles.css';
import { gsap } from 'gsap';
import * as THREE from 'three/webgpu';
import { createGrowthShootField, createTuftBlanket } from './foliage.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { abs, clamp, color, mix, mx_fractal_noise_float, normalWorld, oneMinus, pass, positionWorld, smoothstep, uniform, vec4 } from 'three/tsl';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { dofWeighted } from './dofWeighted.js';
import { createDappleNode } from './dapple.js';
import fontUrl from 'three/examples/fonts/helvetiker_bold.typeface.json?url';

const startupStartedAt = performance.now();
const startupTimings = [];


function recordStartupTiming(phase, startedAt, type = 'work') {
  startupTimings.push({
    phase,
    type,
    ms: Number((performance.now() - startedAt).toFixed(1)),
  });
}

async function timeStartupAsync(phase, operation, type = 'work') {
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    recordStartupTiming(phase, startedAt, type);
  }
}

function reportStartupTimings() {
  const revealedAt = performance.now();
  const rows = [
    { phase: 'page start to main evaluation', type: 'gate', ms: Number(startupStartedAt.toFixed(1)) },
    ...startupTimings,
    {
      phase: 'MAIN EVALUATION TO REVEAL',
      type: 'total',
      ms: Number((revealedAt - startupStartedAt).toFixed(1)),
    },
    { phase: 'PAGE START TO REVEAL', type: 'total', ms: Number(revealedAt.toFixed(1)) },
  ];
  console.group('[craftyhedge] startup profile');
  console.table(rows);
  console.log('Gate timings include work performed while that gate was waiting.');
  console.groupEnd();
}

const canvas = document.querySelector('#scene');
const sceneStage = document.querySelector('[data-scene-stage]');
const fallback = document.querySelector('[data-webgpu-fallback]');
const sceneLoader = document.querySelector('[data-scene-loader]');
const sceneLoaderMessage = document.querySelector('[data-scene-loader-message]');
const overlayLayer = document.querySelector('[data-overlay-layer]');
const overlayPanel = document.querySelector('[data-overlay-panel]');
const overlayTriggers = [...document.querySelectorAll('[data-overlay-trigger]')];
const overlayContents = [...document.querySelectorAll('[data-overlay-content]')];
const overlayCloseButtons = [...document.querySelectorAll('[data-overlay-close]')];
let triggerOverlayById = () => {};
let overlayDofAperture = null;
let overlayDofMaxBlur = null;
let overlayBloomAmount = null;
let overlayFocusDistance = null;
const DEBUG_HIDE_FOLIAGE = false;
// Whole-scene dim, animated independently of the DOF/depth grade. Its own
// uniform + its own tween so its strength and timing are free to diverge from
// the blur. 0 = no dim, 1 = full dim toward OVERLAY_SCENE_DIM brightness.
let overlaySceneDim = null;
let requestedOverlayDofAmount = 0;
let requestedOverlayFocusDistance = 0;
const OVERLAY_DOF_APERTURE = 0.012;
const OVERLAY_DOF_MAX_BLUR = 0.048;
// Brightness floor the whole scene reaches at full dim (uniform, depth-agnostic).
const OVERLAY_SCENE_DIM = 0.7;

function setOverlayDofAmount(value, immediate = false) {
  requestedOverlayDofAmount = value;
  if (!overlayDofAperture || !overlayDofMaxBlur) return null;

  requestedOverlayFocusDistance = getOverlayFocusDistance();
  gsap.killTweensOf([overlayDofAperture, overlayDofMaxBlur, overlayFocusDistance]);
  overlayFocusDistance.value = requestedOverlayFocusDistance;

  if (immediate) {
    overlayDofAperture.value = OVERLAY_DOF_APERTURE * value;
    overlayDofMaxBlur.value = OVERLAY_DOF_MAX_BLUR * value;
    if (overlayBloomAmount) overlayBloomAmount.value = 1 - value;
    if (overlaySceneDim) overlaySceneDim.value = value;
    return null;
  }

  // Open durations are stretched to land with the staggered content reveal
  // (~0.9s: 0.12s start delay + (n-1)*0.07 stagger + 0.5s per line), so the
  // scene settling into blur/dim finishes alongside the last line arriving
  // rather than snapping done while the copy is still animating in. Close
  // timings are left short — the exit shouldn't drag.
  if (overlayBloomAmount) {
    gsap.killTweensOf(overlayBloomAmount);
    gsap.to(overlayBloomAmount, {
      value: 1 - value,
      duration: value > 0 ? 0.82 : 0.28,
      ease: value > 0 ? 'power2.out' : 'power1.inOut',
    });
  }

  // Whole-scene dim on its own timing — a touch slower in, quicker out — so it
  // reads as a separate beat from the blur rather than locked to it.
  if (overlaySceneDim) {
    gsap.killTweensOf(overlaySceneDim);
    gsap.to(overlaySceneDim, {
      value,
      duration: value > 0 ? 0.9 : 0.24,
      ease: value > 0 ? 'power2.inOut' : 'power1.in',
    });
  }

  return gsap.to([overlayDofAperture, overlayDofMaxBlur], {
    value: (index) => (index === 0 ? OVERLAY_DOF_APERTURE : OVERLAY_DOF_MAX_BLUR) * value,
    duration: value > 0 ? 0.82 : 0.28,
    ease: value > 0 ? 'power2.out' : 'power1.inOut',
  });
}

function setLoaderMessage(message) {
  if (sceneLoaderMessage) sceneLoaderMessage.textContent = message;
}

function showLoaderError(message) {
  setLoaderMessage(message);
  if (sceneLoader) sceneLoader.querySelector('.scene-loader__spinner')?.remove();
}

function revealScene() {
  canvas.dataset.ready = '';
  if (!sceneLoader) return;
  sceneLoader.classList.add('is-hiding');
  sceneLoader.addEventListener('transitionend', () => {
    sceneLoader.hidden = true;
  }, { once: true });
}

function showUnsupported(message) {
  if (fallback) {
    fallback.hidden = false;
    fallback.textContent = message;
  }
  showLoaderError(message);
}

function initOverlayNavigation() {
  if (!overlayLayer || !overlayPanel || overlayTriggers.length === 0 || overlayContents.length === 0) return;

  const contentById = new Map(overlayContents.map((content) => [content.dataset.overlayContent, content]));
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let activeOverlayId = overlayContents.find((content) => !content.hidden)?.dataset.overlayContent ?? null;
  let isOpen = false;

  gsap.set(overlayLayer, {
    opacity: 0,
    backgroundColor: 'rgba(8, 15, 8, 0)',
  });
  gsap.set(overlayPanel, { opacity: 0 });

  function setActiveTrigger(id) {
    for (const trigger of overlayTriggers) {
      const isActive = isOpen && trigger.dataset.overlayTrigger === id;
      trigger.classList.toggle('is-active', isActive);
      trigger.setAttribute('aria-expanded', String(isActive));
    }
  }

  // The animated children inside a content article. Media/action pieces can sit
  // earlier in the DOM for layout, but they reveal just after the intro copy.
  function revealTargets(content) {
    const box = content.querySelector('.overlay-content__box');
    const children = [...(box ?? content).children];
    const delayed = new Set(children.filter((child) => (
      child.matches('.overlay-content__person, .overlay-content__github')
    )));
    const firstParagraphIndex = children.findIndex((child) => child.matches('p:not(.overlay-content__eyebrow)'));
    const insertAt = firstParagraphIndex === -1 ? children.length : firstParagraphIndex + 1;
    return [
      ...children.slice(0, insertAt).filter((child) => !delayed.has(child)),
      ...delayed,
      ...children.slice(insertAt).filter((child) => !delayed.has(child)),
    ];
  }

  const CONTENT_IN_FROM = { opacity: 0, y: 24 };

  // The card chrome (border/background/shadow) lives on .overlay-content__box's
  // ::before. GSAP can't tween a pseudo directly, so we animate CSS vars on the
  // box element and the pseudo reads --box-opacity / --box-scale.
  const boxOf = (content) => content.querySelector('.overlay-content__box');
  const BOX_IN_FROM = { '--box-opacity': 0, '--box-scale': 0.92 };

  // Synchronously pin the card's lines to their hidden start state the instant
  // the content is shown — BEFORE the browser paints. Without this the lines
  // render at their natural position for a frame (the entrance starts on a
  // timeline delay), so you see them flash into place and then animate.
  function primeContentIn(content) {
    if (prefersReducedMotion.matches) return;
    const targets = revealTargets(content);
    if (targets.length > 0) gsap.set(targets, CONTENT_IN_FROM);
    const box = boxOf(content);
    if (box) gsap.set(box, BOX_IN_FROM);
  }

  // Fade + zoom the card chrome in. Kept on its own tween (rather than folded
  // into the line stagger) so callers can delay it slightly — the box settles
  // in while the text is already rising into place.
  function animateBoxIn(content) {
    const box = boxOf(content);
    if (!box) return null;

    if (prefersReducedMotion.matches) {
      gsap.set(box, { clearProps: '--box-opacity,--box-scale' });
      return null;
    }

    return gsap.fromTo(
      box,
      BOX_IN_FROM,
      {
        '--box-opacity': 1,
        '--box-scale': 1,
        duration: 0.6,
        ease: 'power2.out',
        clearProps: '--box-opacity,--box-scale',
      },
    );
  }

  // Staggered entrance for the content card's lines: each rises and fades in
  // just after the one above it. Returns the timeline so callers can sequence
  // it (and so swaps can kill any in-flight reveal first). Assumes the targets
  // are already at the hidden start state (see primeContentIn) so there's no
  // flash before the tween begins.
  function animateContentIn(content) {
    const targets = revealTargets(content);
    if (targets.length === 0) return null;

    if (prefersReducedMotion.matches) {
      gsap.set(targets, { clearProps: 'all' });
      return null;
    }

    return gsap.fromTo(
      targets,
      CONTENT_IN_FROM,
      {
        opacity: 1,
        y: 0,
        duration: 0.5,
        ease: 'power2.out',
        stagger: 0.07,
        clearProps: 'transform',
      },
    );
  }

  function showOverlayContent(id) {
    const nextContent = contentById.get(id);
    if (!nextContent || activeOverlayId === id) return;

    activeOverlayId = id;
    gsap.killTweensOf(overlayContents);

    for (const content of overlayContents) {
      content.hidden = content !== nextContent;
      const box = boxOf(content);
      gsap.killTweensOf(revealTargets(content));
      if (box) gsap.killTweensOf(box);
      gsap.set(content, { clearProps: 'all' });
      gsap.set(revealTargets(content), { clearProps: 'all' });
      if (box) gsap.set(box, { clearProps: '--box-opacity,--box-scale' });
    }

    // Swapping while already open: pin the new card's lines + chrome hidden in
    // the same synchronous frame they're revealed, then replay the entrance —
    // no flash. The box trails the text by a beat.
    if (isOpen) {
      primeContentIn(nextContent);
      animateContentIn(nextContent);
      gsap.delayedCall(0.12, () => animateBoxIn(nextContent));
    }
  }

  function openOverlay(id) {
    const nextContent = contentById.get(id);
    if (!nextContent) return;

    showOverlayContent(id);
    // Pin the lines hidden synchronously now, before the panel fades in, so the
    // delayed entrance (below) never lets them paint at their final position.
    primeContentIn(nextContent);
    isOpen = true;
    overlayLayer.hidden = false;
    overlayLayer.classList.add('is-open');
    setActiveTrigger(id);

    gsap.killTweensOf([overlayLayer, overlayPanel]);

    if (prefersReducedMotion.matches) {
      setOverlayDofAmount(1, true);
      gsap.set(overlayLayer, { opacity: 1 });
      gsap.set(overlayPanel, { opacity: 1 });
      overlayPanel.focus({ preventScroll: true });
      return;
    }

    setOverlayDofAmount(1);
    gsap.timeline({
      defaults: { ease: 'power1.out' },
      onComplete: () => overlayPanel.focus({ preventScroll: true }),
    })
      .to(overlayLayer, { opacity: 1, duration: 0.26 }, 0)
      .to(overlayPanel, { opacity: 1, duration: 0.24 }, 0)
      // Lines rise in just after the panel starts fading up, so they animate
      // into a visible card rather than behind a still-transparent one.
      .add(() => animateContentIn(nextContent), 0.12)
      // The card chrome fades + zooms in a beat behind the text, settling
      // around the lines that are already on their way up.
      .add(() => animateBoxIn(nextContent), 0.26);
  }

  function closeOverlay() {
    if (!isOpen) return;

    isOpen = false;
    setActiveTrigger(activeOverlayId);
    gsap.killTweensOf([overlayLayer, overlayPanel]);
    const activeContent = activeOverlayId ? contentById.get(activeOverlayId) : null;
    if (activeContent) {
      gsap.killTweensOf(revealTargets(activeContent));
      const box = boxOf(activeContent);
      if (box) gsap.killTweensOf(box);
    }

    if (prefersReducedMotion.matches) {
      setOverlayDofAmount(0, true);
      gsap.set(overlayLayer, { opacity: 0 });
      gsap.set(overlayPanel, { opacity: 0 });
      overlayLayer.classList.remove('is-open');
      overlayLayer.hidden = true;
      return;
    }

    gsap.timeline({
      defaults: { ease: 'power1.inOut' },
      onComplete: () => {
        overlayLayer.classList.remove('is-open');
        overlayLayer.hidden = true;
        setOverlayDofAmount(0);
      },
    })
      .to(overlayPanel, { opacity: 0, duration: 0.16 }, 0)
      .to(overlayLayer, { opacity: 0, duration: 0.18 }, 0);
  }

  for (const trigger of overlayTriggers) {
    trigger.addEventListener('click', () => {
      const id = trigger.dataset.overlayTrigger;
      if (isOpen && activeOverlayId === id) closeOverlay();
      else openOverlay(id);
    });
  }

  triggerOverlayById = (id) => {
    if (isOpen && activeOverlayId === id) closeOverlay();
    else openOverlay(id);
  };

  for (const button of overlayCloseButtons) {
    button.addEventListener('click', closeOverlay);
  }

  // Clicking the panel anywhere outside the content box closes the overlay —
  // the box's margins read as dead space, so a click there is an intent to
  // dismiss (same as the backdrop). Clicks inside the box are left alone so
  // text selection and links keep working.
  overlayPanel.addEventListener('click', (event) => {
    if (!event.target.closest('.overlay-content__box')) closeOverlay();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeOverlay();
  });
}

initOverlayNavigation();

// WebGPU is required: bail out before touching the renderer if the browser has
// no `navigator.gpu` at all, so the user sees a clear message instead of a blank
// canvas or an unhandled construction error.
if (!navigator.gpu) {
  showUnsupported(
    'This experience needs WebGPU, which isn’t available in this browser. '
    + 'Try the latest Chrome, Edge, or another WebGPU-capable browser.',
  );
  throw new Error('[craftyhedge] WebGPU is not supported in this browser.');
}

const renderer = new THREE.WebGPURenderer({
  antialias: true,
  canvas,
});

// Adaptive resolution: the scene is fill-rate bound (foliage overdraw + soft
// shadows + full-screen bloom), so cost scales with the number of fragments.
// On a 4K panel even a 1.6× device-pixel cap is ~21M fragments/frame, which is
// what "melts" weaker GPUs. We cap the starting ratio by the actual rendered
// pixel budget — small high-DPI laptops keep their sharpness, big panels start
// more conservatively — then let the runtime monitor (see below) scale further.
const MAX_PIXEL_RATIO = 1.6;
const MIN_PIXEL_RATIO = 0.7;
// Roughly a 1080p-at-1.5× budget. Above this we trade sharpness for frame rate.
const PIXEL_BUDGET = 1920 * 1080 * 1.5 * 1.5;

function pixelRatioForStage() {
  const stagePixels = sceneStage.clientWidth * sceneStage.clientHeight;
  const dprCap = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  if (stagePixels <= 0) return dprCap;
  // Largest ratio whose framebuffer stays within the pixel budget, clamped to
  // the device cap above and a hard floor below.
  const budgetRatio = Math.sqrt(PIXEL_BUDGET / stagePixels);
  return THREE.MathUtils.clamp(Math.min(dprCap, budgetRatio), MIN_PIXEL_RATIO, MAX_PIXEL_RATIO);
}

renderer.setPixelRatio(pixelRatioForStage());
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Neutral (Khronos PBR Neutral) instead of ACES: ACES rolls saturated brights
// toward white, which was quietly pastel-ising the neon flowers. Neutral keeps
// highlights in check while preserving saturation, so the cyberpunk palette pops.
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.3;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x173f18);
// scene.fog = new THREE.Fog(0x173f18, 13, 44);

const DESIGN_ASPECT = 16 / 9;
const DESIGN_VERTICAL_FOV = 42;
const GROUND_Y = 0;
const MOBILE_CAMERA_ZOOM_BREAKPOINT = 640;
const MOBILE_CAMERA_FULL_ZOOM_WIDTH = 430;
const MOBILE_CAMERA_SCALE = 0.7;
const MOBILE_TEXT_WIDTH_SCALE = 0.94;

// Responsive text size (computed once at load, NOT live-reactive). The camera
// fits itself to the text frame, so a fixed-size title forces the camera to pull
// back on narrow screens — which shrinks the fixed-world-size tufts/flowers and
// packs them denser. Scaling the title DOWN with viewport width instead keeps the
// camera at a roughly constant distance, so tuft/flower on-screen size and density
// stay consistent across devices. Desktop (>= reference width) keeps the original
// 2.75; narrower screens scale ~proportionally to width down to a floor.
const TEXT_SIZE_DESKTOP = 2.75;       // size at/above the reference width (unchanged desktop look)
const TEXT_SIZE_REFERENCE_WIDTH = 1440; // px at which the desktop size applies
const TEXT_SIZE_MIN_SCALE = 0.55;     // floor so very small screens don't get a tiny title
function computeTextSize() {
  const width = sceneStage.clientWidth || TEXT_SIZE_REFERENCE_WIDTH;
  // Below the reference width, scale proportionally to width; never exceed the
  // desktop size on larger screens (desktop density is already where we want it).
  const scale = THREE.MathUtils.clamp(width / TEXT_SIZE_REFERENCE_WIDTH, TEXT_SIZE_MIN_SCALE, 1);
  return TEXT_SIZE_DESKTOP * scale;
}
const TEXT_SIZE = computeTextSize();
const TEXT_CENTER_Z = -1.8;
const TEXT_LINE_SPACING = TEXT_SIZE * 1.22;
const INITIAL_STAGE_ASPECT = sceneStage.clientWidth / sceneStage.clientHeight;
const TEXT_FRAME_HALF_WIDTH = TEXT_SIZE * 3;
const TEXT_FRAME_HALF_DEPTH = TEXT_LINE_SPACING / 2 + TEXT_SIZE * 0.62;
const TEXT_FRAME_HEIGHT = TEXT_SIZE * 0.26;
const TEXT_SCREEN_HALF_WIDTH = 0.78;
const TEXT_SCREEN_HALF_HEIGHT = 0.72;
const TEXT_SCREEN_CENTER_Y = -0.25;
const SUPPORTED_ASPECTS = Array.from({ length: 34 }, (_, index) => 0.7 + index * 0.1);
const cameraTarget = new THREE.Vector3(0, 0.4, TEXT_CENTER_Z - 0.35);
const cameraHome = new THREE.Vector3(0, 14, 6);
const cameraOffset = cameraHome.clone().sub(cameraTarget);
const camera = new THREE.PerspectiveCamera(DESIGN_VERTICAL_FOV, INITIAL_STAGE_ASPECT, 0.08, 120);
const textFrameCorners = [];
const overlayFocusPoint = new THREE.Vector3();
const TEXT_WIDTH_SCALE = sceneStage.clientWidth < MOBILE_CAMERA_ZOOM_BREAKPOINT
  ? MOBILE_TEXT_WIDTH_SCALE
  : 1;

for (const x of [-TEXT_FRAME_HALF_WIDTH, TEXT_FRAME_HALF_WIDTH]) {
  for (const y of [GROUND_Y, GROUND_Y + TEXT_FRAME_HEIGHT]) {
    for (const z of [TEXT_CENTER_Z - TEXT_FRAME_HALF_DEPTH, TEXT_CENTER_Z + TEXT_FRAME_HALF_DEPTH]) {
      textFrameCorners.push(new THREE.Vector3(x, y, z));
    }
  }
}

function setCameraScale(scale) {
  camera.position.copy(cameraTarget).addScaledVector(cameraOffset, scale);
  camera.lookAt(cameraTarget);
  camera.updateMatrixWorld();
}

function mobileCameraScaleForWidth(width) {
  if (width >= MOBILE_CAMERA_ZOOM_BREAKPOINT) return 1;
  const t = THREE.MathUtils.clamp(
    (width - MOBILE_CAMERA_FULL_ZOOM_WIDTH) / (MOBILE_CAMERA_ZOOM_BREAKPOINT - MOBILE_CAMERA_FULL_ZOOM_WIDTH),
    0,
    1,
  );
  return THREE.MathUtils.lerp(MOBILE_CAMERA_SCALE, 1, t);
}

function fitCameraToText(aspect, finalScaleMultiplier = 1) {
  camera.aspect = aspect;
  camera.fov = DESIGN_VERTICAL_FOV;
  camera.updateProjectionMatrix();
  // Ultrawide projections naturally make the text occupy less horizontal NDC,
  // which used to let the fit solver move the camera closer. Fit against at
  // most the 16:9 design aspect, while keeping the real projection aspect, so
  // wider screens reveal more hedge instead of enlarging the scene subjects.
  const fitAspect = Math.min(aspect, DESIGN_ASPECT);

  let nearScale = 0.5;
  let farScale = 4;

  for (let i = 0; i < 18; i += 1) {
    const scale = (nearScale + farScale) / 2;
    setCameraScale(scale);
    const projectedCorners = textFrameCorners.map((point) => point.clone().project(camera));
    const maxScreenX = Math.max(...projectedCorners.map((point) => Math.abs(point.x)))
      * (aspect / fitAspect);
    const halfScreenHeight = (
      Math.max(...projectedCorners.map((point) => point.y))
      - Math.min(...projectedCorners.map((point) => point.y))
    ) / 2;

    if (maxScreenX > TEXT_SCREEN_HALF_WIDTH || halfScreenHeight > TEXT_SCREEN_HALF_HEIGHT) nearScale = scale;
    else farScale = scale;
  }

  setCameraScale(farScale * finalScaleMultiplier);

  const projectedText = textFrameCorners.map((point) => point.clone().project(camera));
  const textScreenCenterY = (
    Math.min(...projectedText.map((point) => point.y))
    + Math.max(...projectedText.map((point) => point.y))
  ) / 2;
  camera.projectionMatrix.elements[9] += textScreenCenterY - TEXT_SCREEN_CENTER_Y;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

fitCameraToText(INITIAL_STAGE_ASPECT);

function getOverlayFocusDistance() {
  // In front of the lower word's midline. Pushing the focus plane further toward
  // the camera (larger +Z term) leaves the text further off-focus, so the bottom
  // band reads softer rather than pin-sharp while the rest still falls away.
  overlayFocusPoint.set(0, GROUND_Y, TEXT_CENTER_Z + TEXT_LINE_SPACING / 2 + TEXT_SIZE * 1.6);
  overlayFocusPoint.applyMatrix4(camera.matrixWorldInverse);
  return -overlayFocusPoint.z;
}

function getGroundCorner(ndcX, ndcY) {
  const point = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera);
  const direction = point.sub(camera.position).normalize();
  return camera.position.clone().addScaledVector(direction, -camera.position.y / direction.y);
}

const HEDGE_FRUSTUM_OVERSCAN = 1.15;
const supportedGroundFootprints = SUPPORTED_ASPECTS.map((aspect) => {
  fitCameraToText(aspect);
  return [
    getGroundCorner(-HEDGE_FRUSTUM_OVERSCAN, -HEDGE_FRUSTUM_OVERSCAN),
    getGroundCorner(HEDGE_FRUSTUM_OVERSCAN, -HEDGE_FRUSTUM_OVERSCAN),
    getGroundCorner(HEDGE_FRUSTUM_OVERSCAN, HEDGE_FRUSTUM_OVERSCAN),
    getGroundCorner(-HEDGE_FRUSTUM_OVERSCAN, HEDGE_FRUSTUM_OVERSCAN),
  ];
});
const supportedGroundCorners = supportedGroundFootprints.flat();
const HEDGE_MIN_X = Math.min(...supportedGroundCorners.map((point) => point.x));
const HEDGE_MAX_X = Math.max(...supportedGroundCorners.map((point) => point.x));
const HEDGE_NEAR_Z = Math.max(...supportedGroundCorners.map((point) => point.z));
const HEDGE_FAR_Z = Math.min(...supportedGroundCorners.map((point) => point.z));
const HEDGE_WIDTH = HEDGE_MAX_X - HEDGE_MIN_X;
const HEDGE_DEPTH = HEDGE_NEAR_Z - HEDGE_FAR_Z;
const HEDGE_CENTER_X = (HEDGE_MIN_X + HEDGE_MAX_X) / 2;
const HEDGE_CENTER_Z = (HEDGE_NEAR_Z + HEDGE_FAR_Z) / 2;
const isInsideFootprint = (x, z, footprint) => {
  let direction = 0;

  for (let i = 0; i < footprint.length; i += 1) {
    const a = footprint[i];
    const b = footprint[(i + 1) % footprint.length];
    const cross = (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x);
    if (Math.abs(cross) < 0.0001) continue;

    const edgeDirection = Math.sign(cross);
    if (direction === 0) direction = edgeDirection;
    else if (edgeDirection !== direction) return false;
  }

  return true;
};
const isInVisibleHedge = (x, z) => {
  return supportedGroundFootprints.some((footprint) => isInsideFootprint(x, z, footprint));
};

fitCameraToText(INITIAL_STAGE_ASPECT);
// The base plane spans every supported aspect ratio, but generating tuft
// instances for that entire union wastes most startup work on off-screen moss.
// Populate only the current camera footprint with enough overscan to absorb
// normal viewport changes without exposing the base beneath it.
const MOSS_FRUSTUM_OVERSCAN = 1.25;
const initialMossFootprint = [
  getGroundCorner(-MOSS_FRUSTUM_OVERSCAN, -MOSS_FRUSTUM_OVERSCAN),
  getGroundCorner(MOSS_FRUSTUM_OVERSCAN, -MOSS_FRUSTUM_OVERSCAN),
  getGroundCorner(MOSS_FRUSTUM_OVERSCAN, MOSS_FRUSTUM_OVERSCAN),
  getGroundCorner(-MOSS_FRUSTUM_OVERSCAN, MOSS_FRUSTUM_OVERSCAN),
];
const MOSS_MIN_X = Math.min(...initialMossFootprint.map((point) => point.x));
const MOSS_MAX_X = Math.max(...initialMossFootprint.map((point) => point.x));
const MOSS_NEAR_Z = Math.max(...initialMossFootprint.map((point) => point.z));
const MOSS_FAR_Z = Math.min(...initialMossFootprint.map((point) => point.z));
const MOSS_WIDTH = MOSS_MAX_X - MOSS_MIN_X;
const MOSS_DEPTH = MOSS_NEAR_Z - MOSS_FAR_Z;
const MOSS_CENTER_X = (MOSS_MIN_X + MOSS_MAX_X) / 2;
const MOSS_CENTER_Z = (MOSS_NEAR_Z + MOSS_FAR_Z) / 2;
const isInInitialMoss = (x, z) => isInsideFootprint(x, z, initialMossFootprint);

const hedgeBaseGeometry = new THREE.BufferGeometry();
hedgeBaseGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
  HEDGE_MIN_X, GROUND_Y, HEDGE_NEAR_Z,
  HEDGE_MAX_X, GROUND_Y, HEDGE_NEAR_Z,
  HEDGE_MIN_X, GROUND_Y, HEDGE_FAR_Z,
  HEDGE_MAX_X, GROUND_Y, HEDGE_FAR_Z,
], 3));
hedgeBaseGeometry.setIndex([0, 2, 1, 1, 2, 3]);
hedgeBaseGeometry.computeVertexNormals();

const hedgeBase = new THREE.Mesh(
  hedgeBaseGeometry,
  new THREE.MeshStandardMaterial({
    // Matched to the dark blade-root tone (~0x071f08) so the ground reads as the
    // same deep green where it shows through the gaps of the sparser 8-blade
    // tufts, rather than the brighter green it used to be.
    color: 0x061806,
    roughness: 1,
    metalness: 0,
  }),
);
hedgeBase.position.y = -0.012;
hedgeBase.receiveShadow = true;

// Shared "light through a tree" gobo, projected from the sun. Used by both the
// moss ground and the rock text so the dappled pools line up across the scene.
const SUN_POSITION = new THREE.Vector3(-6, 15, 8);
const SUN_TARGET = new THREE.Vector3(0, 0, -2);
const sunDirection = SUN_TARGET.clone().sub(SUN_POSITION).normalize();
const dappleConfig = {
  sunDirection,
  scale: 0.4,
  shadeMin: 0.9,
  sunBoost: 0.5,
  coverage: 0.5,
  swaySpeed: 0.6,
  swayAmount: 0.12,
};

// Tuft variant: same dapple, but the warm sun-pool multiplier is capped at 1.0
// so it can only darken the moss, never push the already-bright tip vertex
// colours past white. The uncapped boost is what blew out isolated swaying tips
// into the flickering white sparkle. Ground/rock keep the full boost.
const tuftDappleConfig = { ...dappleConfig, clampMax: 1 };
const hedgeWind = {
  windDirection: new THREE.Vector2(0.58, 0.82).normalize(),
  windScale: 3.2,
  windSpeed: 1.0,
  windTurbulence: 0.32,
};

// Set once the near-letter fill blanket is built inside the async font load.
let fillTuftCount = 0;
// Exposed so the spawn handler / animate loop can push these tufts as flowers grow.
let fillTop = null;
// Set once the glyph masks exist; lets the flower spawner skip the rock letters.
let isUnderRockTest = null;
// Nearest glyph boundary and outward direction, used by the text-edge flowers.
let nearestRockEdgeTest = null;

let startupPhaseStartedAt = performance.now();
const mossTop = createTuftBlanket({
  width: MOSS_WIDTH,
  depth: MOSS_DEPTH,
  centerX: MOSS_CENTER_X,
  centerZ: MOSS_CENTER_Z,
  visibilityTest: isInInitialMoss,
  spacing: 0.18,
  seed: 184,
  heightRange: [0.26, 0.74],
  widthRange: [0.64, 1.08],
  windRange: [0.12, 0.26],
  animated: true,
  ...hedgeWind,
  yOffset: GROUND_Y,
  hueRange: [0.22, 0.33],
  saturationRange: [0.62, 0.86],
  lightnessRange: [0.24, 0.56],
  brightnessRange: [0.9, 1.18],
  shadeRange: [0.72, 1.1],
  // Fully matte: sub-pixel double-sided blades with any specular lobe alias into
  // flickering hot pixels ("sparkles") under the directional sun. Moss is matte
  // anyway, so kill the specular response entirely.
  roughness: 1,
  dapple: tuftDappleConfig,
});
recordStartupTiming('main moss construction', startupPhaseStartedAt);

startupPhaseStartedAt = performance.now();
const growthShoots = createGrowthShootField({
  capacity: 2200,
  seed: 947,
  yOffset: GROUND_Y,
  lifespan: [11, 19],
  ...hedgeWind,
  dapple: tuftDappleConfig,
});
recordStartupTiming('growth shoot construction', startupPhaseStartedAt);

scene.add(hedgeBase);
if (!DEBUG_HIDE_FOLIAGE) scene.add(mossTop.mesh, growthShoots.mesh);

let flowerPatch = null;

async function createFlowers() {
  let flowerPhaseStartedAt = performance.now();
  const { createFlowerPatch } = await import('./flowers.js');
  recordStartupTiming('flower module import', flowerPhaseStartedAt);

  flowerPhaseStartedAt = performance.now();
  flowerPatch = createFlowerPatch({
    // Longer-lived generations overlap more heavily, so reserve enough slots per
    // species that an established colony does not prevent fresh blooms spawning.
    maxFlowers: 1800,
    lifespan: [11, 19],
    yOffset: GROUND_Y,
    canGrow: (x, z, crownRadius = 0) => {
      if (!isInInitialMoss(x, z)) return false;
      const signClearance = THREE.MathUtils.clamp(crownRadius * 0.45 + 0.08, 0.1, 0.34);
      if (isInsideSceneNavFlowerKeepOut(x, z, signClearance)) return false;
      if (isUnderRockTest && isUnderRockTest(x, z)) return false;
      if (!nearestRockEdgeTest) return true;

      // The glyph mask above tests only the stem root. Reserve part of the
      // rendered crown radius too, otherwise large/later-stage blooms rooted
      // just outside a stroke can spread their petals across the rock surface.
      // Cap the margin so small letter counters still remain plantable.
      const crownClearance = THREE.MathUtils.clamp(crownRadius * 0.32 + 0.035, 0.06, 0.22);
      return nearestRockEdgeTest(x, z).distance >= crownClearance;
    },
    // Near the rock, force stems to lean away from the nearest glyph edge and
    // suppress most wind bend. Farther out they regain random lean and full wind.
    tiltScale: (x, z) => {
      const signAvoidanceSample = getSceneNavFlowerAvoidance(x, z);
      const signAvoidance = signAvoidanceSample
        ? {
            scale: THREE.MathUtils.lerp(1, 0.38, signAvoidanceSample.influence),
            direction: signAvoidanceSample.direction,
            directionInfluence: signAvoidanceSample.influence,
            windScale: THREE.MathUtils.lerp(1, 0.06, signAvoidanceSample.influence),
          }
        : null;

      if (!nearestRockEdgeTest) return signAvoidance ?? 1;
      const edge = nearestRockEdgeTest(x, z);
      const edgeInfluence = 1 - THREE.MathUtils.smoothstep(edge.distance, 0.18, 0.62);
      if (signAvoidance && signAvoidanceSample.influence >= edgeInfluence) return signAvoidance;

      return {
        scale: THREE.MathUtils.lerp(1, 0.48, edgeInfluence),
        direction: Math.atan2(-edge.x, edge.z),
        directionInfluence: edgeInfluence,
        windScale: THREE.MathUtils.lerp(1, 0.12, edgeInfluence),
      };
    },
    // Same drifting leaf-shadow as the moss, but capped at 1.0 so it only shades
    // the blooms into the pools — never lifts the saturated petals back toward the
    // neon blowout we just dialled out. Sampled by world XZ (flowers sit low).
    dapple: { ...dappleConfig, clampMax: 1, project: false },
    wind: hedgeWind,
  });
  recordStartupTiming('flower construction', flowerPhaseStartedAt);
  if (!DEBUG_HIDE_FOLIAGE) scene.add(flowerPatch.object);
}

const sun = new THREE.DirectionalLight(0xfff2c4, 4.0);
sun.position.copy(SUN_POSITION);
sun.target.position.copy(SUN_TARGET);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
// Keep the orthographic volume tight so the 2048² map retains enough texel
// density for crisp foliage and letter shadows. The broader computed footprint
// spread the map across off-screen hedge and produced blocky, unstable edges.
sun.shadow.camera.left = -11;
sun.shadow.camera.right = 11;
sun.shadow.camera.top = 7;
sun.shadow.camera.bottom = -7;
sun.shadow.camera.near = 7;
sun.shadow.camera.far = 28;
sun.shadow.camera.updateProjectionMatrix();

sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.035;
scene.add(sun);
scene.add(sun.target);

// Hemisphere fill is what lights the shadowed grass and foreground — the parts
// that read as "too dark". Lift its intensity and warm/brighten the ground-bounce
// term so the moss in shade comes up, without touching the sun (which keeps the
// lit flowers and highlight contrast exactly where they are).
const skyLight = new THREE.HemisphereLight(0xd7fff1, 0x24301a, 4.1);
scene.add(skyLight);

const rim = new THREE.DirectionalLight(0xa8d8ff, 0.42);
rim.position.set(18, 12, -20);
scene.add(rim);

// Big chunky whitish rock text "CRAFTY HEDGE" as 3D geometry
// Flat on the ground plane (letters parallel to terrain XZ).
// Reasonable thin extrusion (small "height") for a slab/rock inlay look,
// not a tall standing extrusion. Camera looks down so this is naturally readable.

// FUNDAMENTAL: on Vite HMR / module re-eval, previous textGroup (with old geometry/extrusion)
// stays in scene because top-level code re-runs creating NEW group + async load adds to it.
// Old objects persist -> no visible change to extrusion/thickness even if params updated.
// Cleanup old tagged textGroup before creating new one.
scene.children = scene.children.filter(child => !(child.userData && child.userData.isCraftyHedgeText));

const textGroup = new THREE.Group();
textGroup.userData.isCraftyHedgeText = true;
scene.add(textGroup);
const sceneNavGroup = new THREE.Group();
sceneNavGroup.userData.isSceneNav = true;
scene.add(sceneNavGroup);
const sceneNavRaycaster = new THREE.Raycaster();
const sceneNavPointer = new THREE.Vector2();
const sceneNavHitTargets = [];
let hoveredSceneNav = null;
let sceneNavHoverPinned = false;
const SCENE_NAV_BASE_SCALE = 1.296;

function updateSceneNavPlacement() {
  if (sceneNavGroup.children.length === 0) return;

  const anchor = getGroundCorner(0, 0.56);
  sceneNavGroup.position.set(anchor.x, GROUND_Y, anchor.z);
  sceneNavGroup.rotation.set(-0.42, 0.16, -0.1);
  sceneNavGroup.scale.setScalar(SCENE_NAV_BASE_SCALE);
}

function getSceneNavHit(event) {
  if (sceneNavHitTargets.length === 0) return null;

  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;

  sceneNavPointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -(((event.clientY - rect.top) / rect.height) * 2 - 1),
  );
  sceneNavRaycaster.setFromCamera(sceneNavPointer, camera);

  return sceneNavRaycaster.intersectObjects(sceneNavHitTargets, false)[0] ?? null;
}

function setSceneNavHover(next, hit = null) {
  if (hoveredSceneNav === next) return;

  const root = next ?? hoveredSceneNav;
  hoveredSceneNav = next;
  canvas.style.cursor = next ? 'pointer' : '';

  const state = root?.userData.hoverState;
  if (!state) return;
  sceneNavGroup.userData.hoverState = state;
  if (next && hit?.point && state.amount <= 0.02) setSceneNavHoverOrigin(root, hit.point);
  state.direction = next ? 1 : -1;

  gsap.killTweensOf(state);
  gsap.to(state, {
    amount: next ? 1 : 0,
    duration: next ? 1.35 : 1.05,
    ease: next ? 'power2.out' : 'sine.inOut',
    onUpdate: () => {
      updateSceneNavHoverFlowers(root);
    },
    onComplete: () => updateSceneNavHoverFlowers(root),
  });
}

function setSceneNavHoverOrigin(root, worldPoint) {
  const hoverFlowers = root?.userData.hoverFlowers;
  if (!hoverFlowers) return;

  sceneNavHoverOrigin.copy(worldPoint);
  root.worldToLocal(sceneNavHoverOrigin);

  let maxDistance = 0.001;
  for (const flower of hoverFlowers) {
    const dx = flower.position.x - sceneNavHoverOrigin.x;
    const dy = flower.position.y - sceneNavHoverOrigin.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    flower.userData.entryDistance = distance;
    maxDistance = Math.max(maxDistance, distance);
  }

  for (const flower of hoverFlowers) {
    const distanceT = flower.userData.entryDistance / maxDistance;
    const tinyVariation = (Math.sin(flower.position.x * 19.7 + flower.position.y * 31.3) + 1) * 0.025;
    flower.userData.activeInDelay = THREE.MathUtils.clamp(
      distanceT * 0.88 + tinyVariation,
      0,
      0.94,
    );
    flower.userData.activeOutDelay = THREE.MathUtils.clamp(
      0.82 - distanceT * 0.56 + tinyVariation,
      0.12,
      0.86,
    );
  }
}

function updateSceneNavHoverFlowers(root) {
  const state = root?.userData.hoverState;
  const hoverFlowers = root?.userData.hoverFlowers;
  if (!state || !hoverFlowers) return;

  for (const flower of hoverFlowers) {
    const delay = flower.userData.activeInDelay ?? flower.userData.inDelay;
    const stemEnd = Math.min(1, delay + 0.28);
    const bloomStart = Math.min(0.96, delay + 0.18);
    const stemAmount = THREE.MathUtils.smoothstep(state.amount, delay, stemEnd);
    const bloomAmount = THREE.MathUtils.smoothstep(state.amount, bloomStart, 1);
    flower.visible = stemAmount > 0.001 || bloomAmount > 0.001;
    flower.userData.stemGroup.scale.set(1, Math.max(0.001, stemAmount), 1);
    flower.userData.bloomGroup.scale.setScalar(Math.max(0.001, bloomAmount));
  }
}

const sceneNavLocalPoint = new THREE.Vector3();
const sceneNavAvoidLocal = new THREE.Vector3();
const sceneNavAvoidWorldDirection = new THREE.Vector3();
const sceneNavAvoidQuaternion = new THREE.Quaternion();
const sceneNavPointWindSource = new THREE.Vector3();
const sceneNavHoverOrigin = new THREE.Vector3();
function getSceneNavLocalPoint(x, z) {
  if (sceneNavGroup.children.length === 0) return false;

  sceneNavLocalPoint.set(x, GROUND_Y, z);
  sceneNavGroup.worldToLocal(sceneNavLocalPoint);

  return sceneNavLocalPoint;
}

function isInsideSceneNavFlowerKeepOut(x, z, margin = 0) {
  const local = getSceneNavLocalPoint(x, z);
  if (!local) return false;

  return Math.abs(local.x) <= SIGN_FLOWER_KEEP_OUT_X + margin
    && local.z >= -SIGN_FLOWER_KEEP_OUT_NEAR_Z - margin
    && local.z <= SIGN_FLOWER_KEEP_OUT_FAR_Z + margin;
}

function getSceneNavFlowerAvoidance(x, z) {
  if (sceneNavGroup.children.length === 0) return null;

  sceneNavAvoidLocal.set(x, GROUND_Y, z);
  sceneNavGroup.worldToLocal(sceneNavAvoidLocal);

  const clampedX = THREE.MathUtils.clamp(
    sceneNavAvoidLocal.x,
    -SIGN_FLOWER_KEEP_OUT_X,
    SIGN_FLOWER_KEEP_OUT_X,
  );
  const clampedZ = THREE.MathUtils.clamp(
    sceneNavAvoidLocal.z,
    -SIGN_FLOWER_KEEP_OUT_NEAR_Z,
    SIGN_FLOWER_KEEP_OUT_FAR_Z,
  );
  let awayX = sceneNavAvoidLocal.x - clampedX;
  let awayZ = sceneNavAvoidLocal.z - clampedZ;
  let distance = Math.hypot(awayX, awayZ);

  if (distance < 0.0001) {
    awayX = sceneNavAvoidLocal.x;
    awayZ = sceneNavAvoidLocal.z - 0.18;
    distance = Math.hypot(awayX, awayZ);
  }
  const hoverAmount = sceneNavGroup.userData.hoverState?.amount ?? 0;
  const avoidRadius = SIGN_FLOWER_AVOID_RADIUS + hoverAmount * 0.28;
  if (distance >= avoidRadius || distance < 0.0001) return null;

  sceneNavAvoidWorldDirection
    .set(awayX / distance, 0, awayZ / distance)
    .applyQuaternion(sceneNavGroup.getWorldQuaternion(sceneNavAvoidQuaternion));
  const worldLength = Math.hypot(sceneNavAvoidWorldDirection.x, sceneNavAvoidWorldDirection.z);
  if (worldLength < 0.0001) return null;

  const influence = 1 - THREE.MathUtils.smoothstep(distance, 0, avoidRadius);
  return {
    direction: Math.atan2(
      sceneNavAvoidWorldDirection.z / worldLength,
      sceneNavAvoidWorldDirection.x / worldLength,
    ),
    influence,
  };
}

function updateSceneNavPointWind() {
  if (!flowerPatch?.setPointWind || sceneNavGroup.children.length === 0) return;

  const amount = sceneNavGroup.userData.hoverState?.amount ?? 0;
  sceneNavPointWindSource.set(0, 0, 0);
  sceneNavGroup.localToWorld(sceneNavPointWindSource);
  flowerPatch.setPointWind({
    x: sceneNavPointWindSource.x,
    z: sceneNavPointWindSource.z,
    radius: SIGN_FLOWER_RADIAL_WIND_RADIUS,
    strength: amount * SIGN_FLOWER_RADIAL_WIND_STRENGTH,
  });
}

const rockMaterial = new THREE.MeshStandardNodeMaterial({
  // Not fully matte: a little roughness headroom gives the broad letter faces a
  // soft sun sheen and a real lit→shadow falloff, so the text reads as sculpted
  // stone in sunlight instead of one flat even-toned slab (that was the dullness).
  roughness: 0.62,
  metalness: 0,
  flatShading: false,
  side: THREE.FrontSide,
});
// Near-white stone with the faintest warm tint — kept just shy of pure white so
// the lowered roughness still produces a visible lit→shadow gradient across the
// faces instead of clipping to a flat white slab.
const rockBaseColor = color(0xe8e4d8);
const mossBounceColor = color(0x698447);
const lowSurface = oneMinus(smoothstep(
  GROUND_Y + TEXT_SIZE * 0.015,
  GROUND_Y + TEXT_SIZE * 0.2,
  positionWorld.y,
));
const wallSurface = oneMinus(smoothstep(0.28, 0.88, abs(normalWorld.y)));
const topSurface = smoothstep(0.72, 0.98, normalWorld.y);
const bounceStrength = lowSurface.mul(wallSurface.mul(0.72).add(0.28)).mul(0.58);
const contactShadow = oneMinus(smoothstep(
  GROUND_Y + TEXT_SIZE * 0.006,
  GROUND_Y + TEXT_SIZE * 0.055,
  positionWorld.y,
)).mul(0.2);

// Same projected canopy on the rock as on the moss, so the shadow shapes are
// continuous from ground onto the letters. Projection keeps each cast-shadow
// region coherent across cap + walls instead of giving every flat face one solid
// tone. Slightly gentler so the text stays legible.
const rockDapple = createDappleNode({
  ...dappleConfig,
  shadeMin: 0.74,
  sunBoost: 0.16,
  // No height-projection or height-fade on the letters: both read positionWorld.y,
  // which is interpolated across the coarse bevel facets and snaps the dapple into
  // straight tonal creases along facet edges (the artifact). Sampling by plain
  // world XZ keeps the dapple coherent with the ground and crease-free on the text.
  project: false,
  fadeHeight: 0,
});
// Continuous world-space fractal noise — NOT a tiled texture, so it never repeats
// or seams across the letters. Sampled by world XZ at a low frequency, it gives
// each part of the stone its own broad weathering blotch. Output ~[-1,1] → remap
// to a ±brightness wobble around 1.0.
const rockMottle = mx_fractal_noise_float(positionWorld.xyz.mul(0.55), 4, 2, 0.5).mul(0.16).add(1);
rockMaterial.colorNode = mix(rockBaseColor, mossBounceColor, bounceStrength)
  .mul(rockMottle)
  .mul(oneMinus(contactShadow))
  .mul(rockDapple);
// Only the subtle green moss-bounce on the lower walls is emissive. The white
// top-face self-illumination (rockBaseColor × topSurface) was driving the letter
// tops past 1.0 and making them glow — dropped, the sun lights them plenty.
rockMaterial.emissiveNode = mossBounceColor
  .mul(lowSurface.mul(wallSurface).mul(0.11));

function pointInPolygon(x, y, polygon) {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses = (a.y > y) !== (b.y > y)
      && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }

  return inside;
}

function createGlyphMask(font, word, centerX, centerZ, wordZ) {
  const scalePolygonX = (polygon) => polygon.map((point) => ({
    x: centerX + (point.x - centerX) * TEXT_WIDTH_SCALE,
    y: point.y,
  }));
  const contours = font.generateShapes(word, TEXT_SIZE).map((shape) => {
    const { shape: outline, holes } = shape.extractPoints(8);
    return {
      shape: scalePolygonX(outline),
      holes: holes.map(scalePolygonX),
    };
  });

  function toFontPoint(worldX, worldZ) {
    return {
      x: worldX + centerX,
      y: -(worldZ - wordZ + centerZ),
    };
  }

  function contains(worldX, worldZ) {
    const point = toFontPoint(worldX, worldZ);

    return contours.some(({ shape, holes }) => (
      pointInPolygon(point.x, point.y, shape)
      && !holes.some((hole) => pointInPolygon(point.x, point.y, hole))
    ));
  }

  function nearestEdge(worldX, worldZ) {
    const point = toFontPoint(worldX, worldZ);
    let nearestX = 0;
    let nearestY = 0;
    let nearestDistanceSquared = Infinity;

    for (const { shape, holes } of contours) {
      for (const polygon of [shape, ...holes]) {
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
          const a = polygon[j];
          const b = polygon[i];
          const edgeX = b.x - a.x;
          const edgeY = b.y - a.y;
          const edgeLengthSquared = edgeX * edgeX + edgeY * edgeY;
          const projection = edgeLengthSquared > 0
            ? THREE.MathUtils.clamp(((point.x - a.x) * edgeX + (point.y - a.y) * edgeY) / edgeLengthSquared, 0, 1)
            : 0;
          const edgePointX = a.x + edgeX * projection;
          const edgePointY = a.y + edgeY * projection;
          const deltaX = point.x - edgePointX;
          const deltaY = point.y - edgePointY;
          const distanceSquared = deltaX * deltaX + deltaY * deltaY;

          if (distanceSquared < nearestDistanceSquared) {
            nearestDistanceSquared = distanceSquared;
            nearestX = deltaX;
            nearestY = deltaY;
          }
        }
      }
    }

    const distance = Math.sqrt(nearestDistanceSquared);
    const inverseDistance = distance > 0.0001 ? 1 / distance : 0;

    return {
      x: nearestX * inverseDistance,
      z: -nearestY * inverseDistance,
      distance,
    };
  }

  return { contains, nearestEdge };
}

function createSceneNavSign(labelFontFamily) {
  const group = new THREE.Group();
  group.userData.overlayId = 'about';
  group.userData.hoverState = { amount: 0 };

  const head = new THREE.Group();
  group.userData.head = head;

  const createLabelTexture = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 132px ${labelFontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ABOUT', canvas.width / 2, canvas.height / 2 + 4);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  };

  const outlineMaterial = new THREE.MeshBasicMaterial({ color: 0x10130b });
  const woodEdgeMaterial = new THREE.MeshLambertMaterial({ color: 0x241409 });
  const boardMaterial = new THREE.MeshLambertMaterial({ color: 0x5a351c });
  const boardDarkMaterial = new THREE.MeshLambertMaterial({ color: 0x432512 });
  const grainMaterial = new THREE.MeshBasicMaterial({ color: 0x22130a });
  const mossMaterial = new THREE.MeshLambertMaterial({ color: 0x3f7f2a });
  const leafMaterial = new THREE.MeshLambertMaterial({ color: 0x628e3a });
  const leafDarkMaterial = new THREE.MeshLambertMaterial({ color: 0x2f6428 });
  const leafVeinMaterial = new THREE.MeshBasicMaterial({
    color: 0xb4d982,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
  });
  const signFlowerPetalMaterial = new THREE.MeshLambertMaterial({
    color: 0xdff2ff,
    emissive: 0x7fc8ff,
    emissiveIntensity: 0.2,
  });
  const signFlowerPetalShadeMaterial = new THREE.MeshLambertMaterial({
    color: 0xbfd9f2,
    emissive: 0x66b7f0,
    emissiveIntensity: 0.12,
  });
  const signFlowerSmallPetalMaterial = new THREE.MeshLambertMaterial({
    color: 0x8fb8ef,
    emissive: 0x3f91db,
    emissiveIntensity: 0.14,
  });
  const signFlowerSmallPetalShadeMaterial = new THREE.MeshLambertMaterial({
    color: 0x5f8fd0,
    emissive: 0x2d78bd,
    emissiveIntensity: 0.08,
  });
  const signFlowerLargePetalMaterial = new THREE.MeshLambertMaterial({
    color: 0xf0fbff,
    emissive: 0xa6dcff,
    emissiveIntensity: 0.22,
  });
  const signFlowerLargePetalShadeMaterial = new THREE.MeshLambertMaterial({
    color: 0xd5ecff,
    emissive: 0x83c8f5,
    emissiveIntensity: 0.14,
  });
  const signFlowerCenterMaterial = new THREE.MeshLambertMaterial({
    color: 0xffd96a,
    emissive: 0xffd760,
    emissiveIntensity: 0.18,
  });
  const signFlowerSmallCenterMaterial = new THREE.MeshLambertMaterial({
    color: 0xf6c85a,
    emissive: 0xf4c04c,
    emissiveIntensity: 0.14,
  });
  const signFlowerLargeCenterMaterial = new THREE.MeshLambertMaterial({
    color: 0xffe58a,
    emissive: 0xffdf72,
    emissiveIntensity: 0.2,
  });
  const signFlowerPetalEdgeMaterial = new THREE.MeshBasicMaterial({ color: 0x386c96 });
  const signFlowerVeinMaterial = new THREE.MeshBasicMaterial({
    color: 0x4a88b6,
    transparent: true,
    opacity: 0.68,
    depthWrite: false,
  });
  const signFlowerGlowMaterial = new THREE.MeshBasicMaterial({ color: 0x8fd7ff });
  const signFlowerContactMaterial = new THREE.MeshBasicMaterial({
    color: 0x3e3215,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  });
  const postFrontMaterial = new THREE.MeshLambertMaterial({ color: 0x4d2d18 });
  const postSideMaterial = new THREE.MeshLambertMaterial({ color: 0x321b0e });
  const postTopMaterial = new THREE.MeshLambertMaterial({ color: 0x684020 });
  const postBottomMaterial = new THREE.MeshLambertMaterial({ color: 0x1e1008 });
  const labelTexture = createLabelTexture();
  const textMaterial = new THREE.MeshBasicMaterial({
    color: 0xfff6df,
    map: labelTexture,
    transparent: true,
    alphaTest: 0.04,
  });
  const labelShadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x10130b,
    map: labelTexture,
    transparent: true,
    alphaTest: 0.04,
  });

  const hitMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.44, 0.035), hitMaterial);
  board.position.y = 0.92;
  board.castShadow = true;
  board.receiveShadow = true;
  board.userData.sceneNavRoot = group;

  const plankSpecs = [
    { y: 1.05, h: 0.16, x: -0.012, rot: 0.014, mat: boardMaterial },
    { y: 0.91, h: 0.15, x: 0.016, rot: -0.01, mat: boardDarkMaterial },
    { y: 0.77, h: 0.15, x: -0.018, rot: 0.012, mat: boardMaterial },
  ];
  const plankEdges = plankSpecs.map(({ y, h, x, rot }) => {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(1.39, h + 0.045, 0.075), woodEdgeMaterial);
    edge.position.set(x, y - 0.006, -0.004);
    edge.rotation.z = rot;
    edge.castShadow = true;
    edge.receiveShadow = true;
    return edge;
  });
  const planks = plankSpecs.map(({ y, h, x, rot, mat }) => {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.34, h, 0.085), mat);
    plank.position.set(x, y, 0.01);
    plank.rotation.z = rot;
    plank.castShadow = true;
    plank.receiveShadow = true;
    return plank;
  });

  const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.7, 0.12), [
    postSideMaterial,
    postSideMaterial,
    postTopMaterial,
    postBottomMaterial,
    postFrontMaterial,
    postSideMaterial,
  ]);
  post.position.y = 0.35;
  post.castShadow = true;
  post.receiveShadow = true;

  const postShadow = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.62, 0.01), postBottomMaterial);
  postShadow.position.set(0.042, 0.34, 0.066);
  postShadow.rotation.z = -0.035;

  const postHighlight = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.54, 0.01), postTopMaterial);
  postHighlight.position.set(-0.035, 0.39, 0.067);
  postHighlight.rotation.z = 0.025;

  const grain = [
    [ -0.46, 1.08, 0.066, 0.34, 0.012, 0.012 ],
    [ 0.08, 1.02, 0.066, 0.42, 0.01, -0.006 ],
    [ -0.35, 0.92, 0.066, 0.28, 0.01, -0.008 ],
    [ 0.3, 0.88, 0.066, 0.36, 0.012, 0.01 ],
    [ -0.08, 0.78, 0.066, 0.52, 0.01, 0.006 ],
  ].map(([ x, y, z, sx, sy, rot ]) => {
    const mark = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), grainMaterial);
    mark.position.set(x, y, z);
    mark.scale.set(sx, sy, 0.008);
    mark.rotation.z = rot;
    return mark;
  });

  const chips = [
    [ -0.71, 1.02, 0.068, 0.08, 0.045, 0.2 ],
    [ 0.68, 0.78, 0.068, 0.07, 0.04, -0.15 ],
    [ 0.55, 1.13, 0.068, 0.06, 0.035, 0.4 ],
  ].map(([ x, y, z, sx, sy, rot ]) => {
    const chip = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), outlineMaterial);
    chip.position.set(x, y, z);
    chip.scale.set(sx, sy, 0.012);
    chip.rotation.z = rot;
    return chip;
  });

  const makeIvyStem = (points) => {
    const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z = 0.082]) => new THREE.Vector3(x, y, z)));
    const stem = new THREE.Mesh(new THREE.TubeGeometry(curve, 18, 0.012, 5, false), leafDarkMaterial);
    stem.castShadow = true;
    stem.receiveShadow = true;
    return stem;
  };

  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0.12);
  leafShape.bezierCurveTo(-0.035, 0.105, -0.05, 0.08, -0.052, 0.052);
  leafShape.bezierCurveTo(-0.096, 0.054, -0.118, 0.018, -0.104, -0.018);
  leafShape.bezierCurveTo(-0.086, -0.06, -0.042, -0.064, -0.014, -0.038);
  leafShape.bezierCurveTo(-0.02, -0.075, -0.008, -0.104, 0, -0.122);
  leafShape.bezierCurveTo(0.008, -0.104, 0.02, -0.075, 0.014, -0.038);
  leafShape.bezierCurveTo(0.042, -0.064, 0.086, -0.06, 0.104, -0.018);
  leafShape.bezierCurveTo(0.118, 0.018, 0.096, 0.054, 0.052, 0.052);
  leafShape.bezierCurveTo(0.05, 0.08, 0.035, 0.105, 0, 0.12);
  const leafGeometry = new THREE.ExtrudeGeometry(leafShape, {
    depth: 0.012,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.003,
    bevelSegments: 1,
  });
  const leafOutlineGeometry = leafGeometry.clone();
  const leafVeinGeometry = new THREE.BoxGeometry(0.008, 0.19, 0.004);
  const leafSideVeinGeometry = new THREE.BoxGeometry(0.006, 0.088, 0.004);

  const makeLeaf = (x, y, scale, rot, mat = leafMaterial, tiltX = 0.18, tiltY = 0) => {
    const leafGroup = new THREE.Group();
    const outline = new THREE.Mesh(leafOutlineGeometry, outlineMaterial);
    outline.position.z = 0.078;
    outline.scale.set(scale * 1.16, scale * 1.16, 1);
    const leaf = new THREE.Mesh(leafGeometry, mat);
    leaf.position.z = 0.09;
    leaf.scale.set(scale, scale, 1);
    leaf.castShadow = true;
    leaf.receiveShadow = true;
    const centerVein = new THREE.Mesh(leafVeinGeometry, leafVeinMaterial);
    centerVein.position.z = 0.102;
    centerVein.scale.set(scale * 0.75, scale * 0.95, 1);
    const leftVein = new THREE.Mesh(leafSideVeinGeometry, leafVeinMaterial);
    leftVein.position.set(-0.022 * scale, 0.012 * scale, 0.104);
    leftVein.rotation.z = 0.78;
    leftVein.scale.set(scale, scale, 1);
    const rightVein = new THREE.Mesh(leafSideVeinGeometry, leafVeinMaterial);
    rightVein.position.set(0.022 * scale, 0.012 * scale, 0.104);
    rightVein.rotation.z = -0.78;
    rightVein.scale.set(scale, scale, 1);
    leafGroup.position.set(x, y, 0);
    leafGroup.rotation.set(tiltX, tiltY, rot);
    leafGroup.add(outline, leaf, centerVein, leftVein, rightVein);
    return leafGroup;
  };

  const signFlowerPetalShape = new THREE.Shape();
  signFlowerPetalShape.moveTo(0, 0.012);
  signFlowerPetalShape.bezierCurveTo(0.055, 0.036, 0.076, 0.1, 0, 0.13);
  signFlowerPetalShape.bezierCurveTo(-0.076, 0.1, -0.055, 0.036, 0, 0.012);
  const signFlowerPetalGeometry = new THREE.ExtrudeGeometry(signFlowerPetalShape, {
    depth: 0.008,
    bevelEnabled: true,
    bevelThickness: 0.002,
    bevelSize: 0.002,
    bevelSegments: 1,
  });
  const signFlowerCenterGeometry = new THREE.SphereGeometry(0.035, 10, 6);
  const signFlowerGlowGeometry = new THREE.SphereGeometry(0.04, 8, 4);
  const signFlowerContactGeometry = new THREE.CircleGeometry(0.13, 18);
  const signFlowerVeinGeometry = new THREE.BoxGeometry(0.008, 0.075, 0.004);

  const makeSignFlower = (x, y, scale, rot = 0, inDelay = 0, {
    z = 0.112,
    tiltX = 0,
    tiltY = 0,
    stemLength = null,
  } = {}) => {
    const flower = new THREE.Group();
    flower.userData.baseScale = scale;
    flower.userData.inDelay = inDelay;
    flower.position.set(x, y, z);
    flower.rotation.set(tiltX, tiltY, rot);
    flower.visible = false;
    flower.scale.setScalar(scale);

    const localStemLength = stemLength ?? THREE.MathUtils.clamp(
      0.62 + (Math.sin(x * 23.1 + y * 17.3) + 1) * 0.28,
      0.58,
      1.16,
    );
    const bloomLift = (localStemLength - 0.8) * 0.035;
    const stemGroup = new THREE.Group();
    const bloomGroup = new THREE.Group();
    stemGroup.scale.y = 0.001;
    bloomGroup.position.y = bloomLift;
    bloomGroup.scale.setScalar(0.001);
    flower.userData.stemGroup = stemGroup;
    flower.userData.bloomGroup = bloomGroup;

    const contact = new THREE.Mesh(signFlowerContactGeometry, signFlowerContactMaterial);
    contact.position.set(0.012, -0.012, -0.012);
    contact.scale.set(1, 0.58, 1);
    stemGroup.add(contact);

    const stemCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.08 * localStemLength, -0.08 * localStemLength, -0.014),
      new THREE.Vector3(-0.02 * localStemLength, -0.02 * localStemLength, -0.006),
      new THREE.Vector3(0, 0.02 + bloomLift, 0),
    ]);
    const stem = new THREE.Mesh(new THREE.TubeGeometry(stemCurve, 7, 0.009, 5, false), leafDarkMaterial);
    stem.castShadow = true;
    stem.receiveShadow = true;
    stemGroup.add(stem);

    const flowerTone = scale < 0.25 ? 'small' : scale > 0.4 ? 'large' : 'mid';
    const petalLightMaterial = flowerTone === 'small'
      ? signFlowerSmallPetalMaterial
      : flowerTone === 'large'
        ? signFlowerLargePetalMaterial
        : signFlowerPetalMaterial;
    const petalDarkMaterial = flowerTone === 'small'
      ? signFlowerSmallPetalShadeMaterial
      : flowerTone === 'large'
        ? signFlowerLargePetalShadeMaterial
        : signFlowerPetalShadeMaterial;
    const centerMaterial = flowerTone === 'small'
      ? signFlowerSmallCenterMaterial
      : flowerTone === 'large'
        ? signFlowerLargeCenterMaterial
        : signFlowerCenterMaterial;

    for (let i = 0; i < 6; i += 1) {
      const petalGroup = new THREE.Group();
      petalGroup.rotation.z = (i / 6) * Math.PI * 2 + 0.08;
      petalGroup.rotation.x = 0.18;
      petalGroup.position.z = 0.004;

      const petalEdge = new THREE.Mesh(signFlowerPetalGeometry, signFlowerPetalEdgeMaterial);
      petalEdge.scale.set(1.16, 1.16, 0.8);
      petalEdge.position.z = -0.004;
      petalGroup.add(petalEdge);

      const petal = new THREE.Mesh(
        signFlowerPetalGeometry,
        i % 2 === 0 ? petalLightMaterial : petalDarkMaterial,
      );
      petal.castShadow = true;
      petal.receiveShadow = true;
      petalGroup.add(petal);

      const vein = new THREE.Mesh(signFlowerVeinGeometry, signFlowerVeinMaterial);
      vein.position.set(0, 0.072, 0.012);
      vein.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.08;
      petalGroup.add(vein);
      bloomGroup.add(petalGroup);
    }

    const center = new THREE.Mesh(signFlowerCenterGeometry, centerMaterial);
    center.position.z = 0.018;
    center.scale.set(1, 1, 0.55);
    center.castShadow = true;
    center.receiveShadow = true;
    bloomGroup.add(center);

    const glow = new THREE.Mesh(signFlowerGlowGeometry, signFlowerGlowMaterial);
    glow.position.z = 0.016;
    glow.scale.set(0.45, 0.45, 0.18);
    bloomGroup.add(glow);

    flower.add(stemGroup, bloomGroup);

    return flower;
  };

  const hoverFlowers = [
    // Dense top-left clump with a few flowers cresting over the edge.
    makeSignFlower(-0.66, 1.12, 0.62, -0.35, 0),
    makeSignFlower(-0.58, 1.17, 0.44, 0.34, 0.1, { z: 0.086, tiltX: -0.72 }),
    makeSignFlower(-0.72, 1.03, 0.36, 0.18, 0.12),
    makeSignFlower(-0.5, 1.2, 0.34, -0.78, 0.22, { z: 0.078, tiltX: -0.78 }),
    makeSignFlower(-0.69, 1.18, 0.28, 0.9, 0.18, { z: 0.078, tiltX: -0.74 }),
    makeSignFlower(-0.52, 1.06, 0.26, -0.18, 0.3),
    makeSignFlower(-0.62, 0.96, 0.3, -0.48, 0.28),
    makeSignFlower(-0.43, 1.13, 0.28, 0.82, 0.36, { z: 0.08, tiltX: -0.72 }),
    makeSignFlower(-0.73, 0.88, 0.24, 0.42, 0.46),
    makeSignFlower(-0.4, 0.98, 0.22, -1.0, 0.58),
    makeSignFlower(-0.56, 0.83, 0.34, -0.15, 0.42),
    makeSignFlower(-0.48, 0.78, 0.24, -0.62, 0.54),

    // Smaller top-right clump, separated from the left cluster by a gap.
    makeSignFlower(0.54, 1.12, 0.48, 0.28, 0.16),
    makeSignFlower(0.64, 1.05, 0.34, -0.36, 0.24),
    makeSignFlower(0.45, 1.08, 0.26, -0.82, 0.3),
    makeSignFlower(0.58, 1.2, 0.34, 0.38, 0.34, { z: 0.084, tiltX: -0.72 }),
    makeSignFlower(0.43, 1.23, 0.26, 0.95, 0.48, { z: 0.074, tiltX: -0.76 }),
    makeSignFlower(0.69, 1.17, 0.24, 0.08, 0.56, { z: 0.078, tiltX: -0.7 }),
    makeSignFlower(0.68, 0.94, 0.28, 0.58, 0.54),
    makeSignFlower(0.55, 0.88, 0.22, -0.28, 0.66),

    // Side clumps: wrapped onto the board thickness, not evenly strung along.
    makeSignFlower(-0.79, 1.02, 0.44, -0.85, 0.18, { z: 0.034, tiltY: 1.08 }),
    makeSignFlower(-0.83, 1.09, 0.28, 0.32, 0.32, { z: 0.024, tiltY: 1.18 }),
    makeSignFlower(-0.84, 0.99, 0.24, -0.18, 0.38, { z: 0.018, tiltY: 1.26 }),
    makeSignFlower(-0.8, 0.91, 0.28, 0.68, 0.5, { z: 0.02, tiltY: 1.22 }),
    makeSignFlower(-0.76, 0.79, 0.24, -0.92, 0.7, { z: 0.022, tiltY: 1.2 }),
    makeSignFlower(-0.82, 0.83, 0.2, 1.02, 0.78, { z: 0.018, tiltY: 1.26 }),
    makeSignFlower(0.78, 0.98, 0.42, 0.58, 0.28, { z: 0.034, tiltY: -1.08 }),
    makeSignFlower(0.82, 1.08, 0.28, -0.58, 0.42, { z: 0.024, tiltY: -1.18 }),
    makeSignFlower(0.84, 1.0, 0.24, 0.18, 0.5, { z: 0.018, tiltY: -1.26 }),
    makeSignFlower(0.76, 0.87, 0.3, -0.12, 0.62, { z: 0.026, tiltY: -1.14 }),
    makeSignFlower(0.83, 0.82, 0.2, -0.94, 0.78, { z: 0.018, tiltY: -1.26 }),

    // Sparse strays and post clumps, deliberately uneven.
    makeSignFlower(-0.16, 1.22, 0.24, -1.08, 0.46, { z: 0.072, tiltX: -0.8 }),
    makeSignFlower(0.18, 0.77, 0.22, 0.24, 0.74),
    makeSignFlower(0.04, 1.18, 0.2, -0.44, 0.7, { z: 0.074, tiltX: -0.76 }),
    makeSignFlower(-0.22, 0.79, 0.18, 0.92, 0.82),
    makeSignFlower(-0.06, 0.68, 0.3, -0.6, 0.5, { z: 0.088, tiltY: 0.26 }),
    makeSignFlower(0.04, 0.62, 0.26, 0.44, 0.58, { z: 0.09, tiltY: -0.28 }),
    makeSignFlower(-0.005, 0.59, 0.22, -0.08, 0.62, { z: 0.094 }),
    makeSignFlower(-0.075, 0.56, 0.22, 0.2, 0.66, { z: 0.086, tiltY: 0.42 }),
    makeSignFlower(0.055, 0.46, 0.22, -0.78, 0.76, { z: 0.084, tiltY: -0.5 }),
    makeSignFlower(-0.025, 0.42, 0.2, 0.54, 0.8, { z: 0.088, tiltY: 0.16 }),
    makeSignFlower(-0.055, 0.34, 0.2, 0.86, 0.84, { z: 0.082, tiltY: 0.58 }),
    makeSignFlower(0.04, 0.28, 0.18, -0.18, 0.9, { z: 0.08, tiltY: -0.62 }),
    makeSignFlower(-0.01, 0.22, 0.16, -0.72, 0.94, { z: 0.078 }),
  ];
  group.userData.hoverFlowers = hoverFlowers;

  const ivyStems = [
    makeIvyStem([[-0.075, 0.2, 0.08], [-0.075, 0.3, 0.08]]),
    makeIvyStem([[0.075, 0.32, -0.075], [0.075, 0.44, -0.075]]),
    makeIvyStem([[-0.075, 0.46, 0.08], [-0.075, 0.58, 0.08]]),
    makeIvyStem([[0.075, 0.6, -0.075], [0.075, 0.7, -0.075]]),
    makeIvyStem([[-0.075, 0.7, 0.08], [-0.35, 0.73, 0.08], [-0.62, 0.76, 0.08], [-0.75, 0.9, 0.08], [-0.72, 1.08, 0.08]]),
    makeIvyStem([[-0.72, 1.08, 0.08], [-0.62, 1.19, 0.08], [-0.46, 1.23, 0.08], [-0.24, 1.2, 0.08]]),
  ];

  const ivyLeaves = [
    [-0.12, 0.28, 0.22, -0.8, leafDarkMaterial, 0.75, -0.45],
    [0.13, 0.43, 0.23, 0.65, leafMaterial, 0.25, 0.5],
    [-0.12, 0.56, 0.24, -0.35, leafDarkMaterial, 0.7, -0.42],
    [0.12, 0.68, 0.2, 0.42, leafMaterial, 0.2, 0.45],
    [-0.36, 0.74, 0.28, 0.75, leafMaterial, 0.28, 0.2],
    [-0.62, 0.78, 0.32, -0.5, leafDarkMaterial, 0.52, -0.1],
    [-0.76, 0.95, 0.34, 0.28, leafMaterial, 0.34, 0.18],
    [-0.77, 1.04, 0.24, -0.38, leafDarkMaterial, 0.46, -0.08],
    [-0.69, 1.12, 0.34, -0.9, leafDarkMaterial, 0.48, -0.18],
    [-0.61, 1.17, 0.22, 0.42, leafMaterial, 0.3, 0.18],
    [-0.52, 1.22, 0.3, 0.18, leafMaterial, 0.26, 0.14],
    [-0.42, 1.22, 0.2, -0.72, leafDarkMaterial, 0.42, -0.16],
    [-0.3, 1.2, 0.26, -0.35, leafDarkMaterial, 0.42, -0.12],
  ].map(([x, y, scale, rot, mat, tiltX, tiltY]) => makeLeaf(x, y, scale, rot, mat, tiltX, tiltY));

  const mossClumps = [
    [ -0.62, 1.2, 0.074, 0.16, 0.032, 0.026 ],
    [ -0.46, 1.22, 0.076, 0.1, 0.024, 0.02 ],
    [ 0.05, 0.58, 0.075, 0.08, 0.022, 0.02 ],
  ].map(([ x, y, z, sx, sy, sz ]) => {
    const moss = new THREE.Mesh(new THREE.SphereGeometry(1, 7, 4), mossMaterial);
    moss.position.set(x, y, z);
    moss.scale.set(sx, sy, sz);
    moss.castShadow = true;
    moss.receiveShadow = true;
    return moss;
  });

  const nailGeometry = new THREE.SphereGeometry(0.026, 8, 4);
  const nails = [
    [ -0.57, 1.05 ],
    [ 0.56, 1.04 ],
    [ -0.58, 0.78 ],
    [ 0.55, 0.78 ],
  ].map(([ x, y ]) => {
    const nail = new THREE.Mesh(nailGeometry, outlineMaterial);
    nail.position.set(x, y, 0.066);
    nail.scale.z = 0.35;
    nail.castShadow = true;
    return nail;
  });

  const labelGeometry = new THREE.PlaneGeometry(1.122, 0.35);
  const label = new THREE.Mesh(labelGeometry, textMaterial);
  label.position.set(0, 0.89, 0.074);

  const labelShadow = new THREE.Mesh(labelGeometry.clone(), labelShadowMaterial);
  labelShadow.position.set(0.012, 0.878, 0.07);

  group.add(
    post,
    postShadow,
    postHighlight,
    head,
  );

  head.add(
    ...plankEdges,
    ...planks,
    board,
    ...grain,
    ...chips,
    ...ivyStems,
    ...mossClumps,
    ...ivyLeaves,
    ...hoverFlowers,
    ...nails,
    labelShadow,
    label,
  );

  sceneNavHitTargets.push(board);
  return group;
}

function createGlyphDistanceField(masks, bounds, spacing = 0.04) {
  const width = Math.ceil((bounds.maxX - bounds.minX) / spacing) + 1;
  const depth = Math.ceil((bounds.maxZ - bounds.minZ) / spacing) + 1;
  const distance = new Float32Array(width * depth);
  const directionX = new Float32Array(width * depth);
  const directionZ = new Float32Array(width * depth);

  const exactSample = (x, z) => {
    let nearest = null;
    let inside = false;

    for (const mask of masks) {
      if (mask.contains(x, z)) inside = true;
      const edge = mask.nearestEdge(x, z);
      if (!nearest || edge.distance < nearest.distance) nearest = edge;
    }

    return {
      ...nearest,
      signedDistance: inside ? -nearest.distance : nearest.distance,
    };
  };

  for (let zIndex = 0; zIndex < depth; zIndex += 1) {
    const z = bounds.minZ + zIndex * spacing;
    for (let xIndex = 0; xIndex < width; xIndex += 1) {
      const x = bounds.minX + xIndex * spacing;
      const sample = exactSample(x, z);
      const index = zIndex * width + xIndex;
      distance[index] = sample.signedDistance;
      directionX[index] = sample.x;
      directionZ[index] = sample.z;
    }
  }

  const interpolate = (array, x0, z0, x1, z1, tx, tz) => {
    const a = THREE.MathUtils.lerp(array[z0 * width + x0], array[z0 * width + x1], tx);
    const b = THREE.MathUtils.lerp(array[z1 * width + x0], array[z1 * width + x1], tx);
    return THREE.MathUtils.lerp(a, b, tz);
  };

  function sample(x, z) {
    const gridX = (x - bounds.minX) / spacing;
    const gridZ = (z - bounds.minZ) / spacing;

    if (gridX < 0 || gridZ < 0 || gridX > width - 1 || gridZ > depth - 1) {
      const nearestX = THREE.MathUtils.clamp(x, bounds.minX, bounds.maxX);
      const nearestZ = THREE.MathUtils.clamp(z, bounds.minZ, bounds.maxZ);
      const deltaX = x - nearestX;
      const deltaZ = z - nearestZ;
      const outsideDistance = Math.hypot(deltaX, deltaZ);
      const inverseDistance = outsideDistance > 0.0001 ? 1 / outsideDistance : 0;
      return {
        x: deltaX * inverseDistance,
        z: deltaZ * inverseDistance,
        distance: (bounds.fallbackDistance || spacing) + outsideDistance,
        inside: false,
      };
    }

    const x0 = Math.min(width - 1, Math.floor(gridX));
    const z0 = Math.min(depth - 1, Math.floor(gridZ));
    const x1 = Math.min(width - 1, x0 + 1);
    const z1 = Math.min(depth - 1, z0 + 1);
    const tx = gridX - x0;
    const tz = gridZ - z0;
    const signedDistance = interpolate(distance, x0, z0, x1, z1, tx, tz);
    let xDirection = interpolate(directionX, x0, z0, x1, z1, tx, tz);
    let zDirection = interpolate(directionZ, x0, z0, x1, z1, tx, tz);
    const directionLength = Math.hypot(xDirection, zDirection);
    if (directionLength > 0.0001) {
      xDirection /= directionLength;
      zDirection /= directionLength;
    }

    return {
      x: xDirection,
      z: zDirection,
      distance: Math.abs(signedDistance),
      inside: signedDistance < 0,
    };
  }

  return { sample };
}

const fontLoader = new FontLoader();
const fontRequestStartedAt = performance.now();
let resolveFontReady;
let rejectFontReady;
const fontReady = new Promise((resolve, reject) => {
  resolveFontReady = resolve;
  rejectFontReady = reject;
});
async function loadFrauncesSignFont() {
  const fontFamily = "'Fraunces', Georgia, serif";
  if (document.fonts?.load) {
    await document.fonts.load(`800 132px ${fontFamily}`);
  }
  return fontFamily;
}

async function buildFontScene(font, signFontFamily) {
    recordStartupTiming('font fetch and parse', fontRequestStartedAt);
    const fontSceneStartedAt = performance.now();

    // The two text lines are generated fresh on load, so they can be overridden
    // via ?text= (one word per line, separated by a comma). Uppercased to match
    // the font's glyph coverage; falls back to the CRAFTY/HEDGE default.
    // Both the rendered geometry and the glyph masks (which drive flower/foliage
    // placement) derive from these strings, so custom text reshapes the scene too.
    const textParam = new URLSearchParams(location.search).get('text');
    // No param at all -> default phrase. Otherwise take exactly what's given:
    // split on comma, so "HELLO" is a single line (empty bottom), not "HELLO,HEDGE".
    const parts =
      textParam === null
        ? ['CRAFTY', 'HEDGE']
        : textParam.toUpperCase().split(',').map((s) => s.trim());
    const topLine = parts[0] ?? '';
    const bottomLine = parts[1] ?? '';
    const extrusionDepth = TEXT_SIZE * 0.14;
    const bevelThickness = TEXT_SIZE * 0.036;

    function createRockLetter(str) {
      let geometry = new TextGeometry(str, {
        font,
        size: TEXT_SIZE,
        depth: extrusionDepth,
        curveSegments: 16,
        steps: 2,
        bevelEnabled: true,
        bevelThickness,
        bevelSize: TEXT_SIZE * 0.03,
        bevelOffset: -TEXT_SIZE * 0.004,
        bevelSegments: 5,
      });

      // Make perfectly flat on ground (letters on XZ plane, thickness in +Y)
      geometry.rotateX(-Math.PI / 2);

      // Center the footprint while preserving TextGeometry's watertight topology.
      geometry.computeBoundingBox();
      const centerX = (geometry.boundingBox.min.x + geometry.boundingBox.max.x) / 2;
      const centerZ = (geometry.boundingBox.min.z + geometry.boundingBox.max.z) / 2;
      geometry.center();
      geometry.scale(TEXT_WIDTH_SCALE, 1, 1);
      geometry.computeBoundingBox();
      geometry.translate(0, -geometry.boundingBox.min.y, 0);
      geometry = toCreasedNormals(geometry, THREE.MathUtils.degToRad(100));
      geometry.computeBoundingBox();

      const mesh = new THREE.Mesh(geometry, rockMaterial);
      mesh.userData.footprintCenter = { x: centerX, z: centerZ };
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    }

    // signGroup treats the two words as one flat piece.
    const signGroup = new THREE.Group();

    let fontPhaseStartedAt = performance.now();
    const craftyMesh = createRockLetter(topLine);
    const hedgeMesh = createRockLetter(bottomLine);
    recordStartupTiming('letter geometry construction', fontPhaseStartedAt);

    // Space the lines along Z (the direction the letter "up" maps to after the geo rotateX).
    // Negative Z is more distant (smaller z = further from camera at +8.1).
    // Put CRAFTY (first line) more distant so it appears "above" HEDGE in the view.
    craftyMesh.position.z = -TEXT_LINE_SPACING / 2;
    hedgeMesh.position.z = TEXT_LINE_SPACING / 2;
    // y stays 0 for both (bottom of slab will be exactly at the group's y)
    craftyMesh.position.y = 0;
    hedgeMesh.position.y = 0;

    signGroup.add(craftyMesh, hedgeMesh);

    // Position the *center* of the full "CRAFTY HEDGE" block near where the *fixed* camera is actually looking.
    // Camera is locked every frame: pos (0,8.8,8.1), lookAt (0,0.35,-1.05).
    // The central ray hits the ground area around z ≈ -1.5 to -2.0 (slant dist ~12 units from camera).
    // Placing the text here (instead of foreground z>3) ensures the *entire* large phrase is visible
    // and centered in the view without being a close-up of only the near edge/letters.
    // Size 3.2 makes the ~12-14 unit wide phrase subtend a large angle (~50-60° of the ~70° horiz FOV).
    signGroup.position.set(0, GROUND_Y, TEXT_CENTER_Z);

    textGroup.add(signGroup);
    sceneNavGroup.clear();
    sceneNavHitTargets.length = 0;
    const sceneNavSign = createSceneNavSign(signFontFamily);
    sceneNavGroup.userData.hoverState = sceneNavSign.userData.hoverState;
    sceneNavGroup.add(sceneNavSign);
    updateSceneNavPlacement();

    fontPhaseStartedAt = performance.now();
    const craftyMask = createGlyphMask(
      font,
      topLine,
      craftyMesh.userData.footprintCenter.x,
      craftyMesh.userData.footprintCenter.z,
      TEXT_CENTER_Z - TEXT_LINE_SPACING / 2,
    );
    const hedgeMask = createGlyphMask(
      font,
      bottomLine,
      hedgeMesh.userData.footprintCenter.x,
      hedgeMesh.userData.footprintCenter.z,
      TEXT_CENTER_Z + TEXT_LINE_SPACING / 2,
    );
    recordStartupTiming('letter mask construction', fontPhaseStartedAt);
    const TUFT_CULL_MARGIN = 0.3;
    const FLOWER_CULL_MARGIN = 0.06;
    const FILL_CULL_MARGIN = 0.08;
    const FILL_BAND = 0.9;

    const textBounds = new THREE.Box3();
    for (const mesh of [craftyMesh, hedgeMesh]) {
      const box = mesh.geometry.boundingBox.clone();
      box.translate(signGroup.position).translate(mesh.position);
      textBounds.union(box);
    }
    const fieldPadding = FILL_BAND + 0.12;
    fontPhaseStartedAt = performance.now();
    const rockField = createGlyphDistanceField([craftyMask, hedgeMask], {
      minX: textBounds.min.x - fieldPadding,
      maxX: textBounds.max.x + fieldPadding,
      minZ: textBounds.min.z - fieldPadding,
      maxZ: textBounds.max.z + fieldPadding,
      fallbackDistance: fieldPadding,
    });
    recordStartupTiming('letter distance field', fontPhaseStartedAt);

    // Cull tufts under the letters AND any rooted within a blade-reach of the
    // glyph edge: a tuft is ~0.5 units wide and leans in the wind, so one rooted
    // just outside (or just inside near a wall) still fans its blades up over the
    // now-taller letter sides. Removing inside-or-near-edge clears those.
    const isUnderRock = (x, z) => {
      const edge = rockField.sample(x, z);
      return edge.inside || edge.distance < TUFT_CULL_MARGIN;
    };

    // Flowers are short, so they don't need the tuft's wide keep-out — only the
    // rock itself plus a hair of clearance. Using the full TUFT_CULL_MARGIN here
    // sealed the inner letter gaps (the A/R/O counters, slots between strokes):
    // 0.3 from each facing wall closed any gap under ~0.6 wide. A tiny margin
    // lets blooms fill those holes reliably while still keeping them off the rock.
    const isUnderRockForFlowers = (x, z) => {
      const edge = rockField.sample(x, z);
      return edge.inside || edge.distance < FLOWER_CULL_MARGIN;
    };

    isUnderRockTest = isUnderRockForFlowers;
    fontPhaseStartedAt = performance.now();
    mossTop.removeWhere(isUnderRock);
    recordStartupTiming('moss letter cutout', fontPhaseStartedAt);

    // Fine fill tufts that hug the letters: half-size, denser-spaced moss that
    // grows into the bare halo the big-tuft cull leaves around the text. Short
    // blades, so they can crowd much closer (FILL_CULL_MARGIN) than the big tufts
    // without poking over the letter walls. Restricted to a band near the edges
    // (FILL_BAND) so this stays a cheap near-text layer, not a whole-field pass.
    // World-space XZ bounds of the whole sign, expanded by FILL_BAND. The fill
    // band only ever wants cells within FILL_BAND of a glyph edge, so any cell
    // outside this box is guaranteed too far — and can be rejected with four
    // comparisons instead of two full glyph-edge polygon scans. Without this gate
    // the fill build paid a ~per-cell scan across the entire hedge footprint (the
    // dense 0.1 grid is hundreds of thousands of cells), which dominated startup.
    const FILL_BOUND_MIN_X = textBounds.min.x - FILL_BAND;
    const FILL_BOUND_MAX_X = textBounds.max.x + FILL_BAND;
    const FILL_BOUND_MIN_Z = textBounds.min.z - FILL_BAND;
    const FILL_BOUND_MAX_Z = textBounds.max.z + FILL_BAND;
    const isNearText = (x, z) => (
      x >= FILL_BOUND_MIN_X && x <= FILL_BOUND_MAX_X
      && z >= FILL_BOUND_MIN_Z && z <= FILL_BOUND_MAX_Z
    );
    nearestRockEdgeTest = (x, z) => rockField.sample(x, z);
    fontPhaseStartedAt = performance.now();
    fillTop = createTuftBlanket({
      width: HEDGE_WIDTH,
      depth: HEDGE_DEPTH,
      centerX: HEDGE_CENTER_X,
      centerZ: HEDGE_CENTER_Z,
      visibilityTest: (x, z) => {
        // Cheap rejects first: the vast majority of cells are far from any letter,
        // so the box test culls them before the expensive glyph-edge scan runs.
        if (!isNearText(x, z)) return false;
        if (!isInVisibleHedge(x, z)) return false;
        const edge = rockField.sample(x, z);
        return !edge.inside && edge.distance >= FILL_CULL_MARGIN && edge.distance <= FILL_BAND;
      },
      spacing: 0.1,
      seed: 521,
      heightRange: [0.12, 0.34],
      widthRange: [0.32, 0.56],
      windRange: [0.1, 0.22],
      animated: true,
      ...hedgeWind,
      yOffset: GROUND_Y,
      hueRange: [0.22, 0.33],
      saturationRange: [0.62, 0.86],
      lightnessRange: [0.24, 0.56],
      brightnessRange: [0.9, 1.18],
      shadeRange: [0.72, 1.1],
      roughness: 1,
      dapple: tuftDappleConfig,
    });
    recordStartupTiming('letter fill moss construction', fontPhaseStartedAt);
    if (!DEBUG_HIDE_FOLIAGE) scene.add(fillTop.mesh);
    fillTuftCount = fillTop.mesh.count;

    const applyWindAvoidance = (blanket) => blanket.setWindAvoidance((x, z) => {
      const edge = rockField.sample(x, z);

      return {
        x: edge.x,
        z: edge.z,
        influence: 1 - THREE.MathUtils.smoothstep(edge.distance, 0.08, 0.75),
      };
    });
    fontPhaseStartedAt = performance.now();
    applyWindAvoidance(mossTop);
    applyWindAvoidance(fillTop);
    recordStartupTiming('wind avoidance assignment', fontPhaseStartedAt);
    updateStats();
    recordStartupTiming('font-dependent scene work', fontSceneStartedAt, 'gate');
    resolveFontReady();
}

fontLoader.load(
  fontUrl,
  (font) => {
    loadFrauncesSignFont()
      .then((signFont) => buildFontScene(font, signFont))
      .catch(rejectFontReady);
  },
  undefined,
  (error) => rejectFontReady(error),
);

function resize() {
  const width = sceneStage.clientWidth;
  const height = sceneStage.clientHeight;
  const mobileCameraScale = mobileCameraScaleForWidth(width);

  fitCameraToText(width / height, mobileCameraScale);
  updateSceneNavPlacement();
  if (overlayFocusDistance && requestedOverlayDofAmount > 0) {
    overlayFocusDistance.value = getOverlayFocusDistance();
  }
  // Recompute the pixel-budget cap for the new stage size, then re-apply the
  // runtime adaptive scale on top of it so a resize never undoes a back-off.
  basePixelRatio = pixelRatioForStage();
  applyPixelRatio();
  renderer.setSize(width, height, false);
}

// --- Adaptive quality controller --------------------------------------------
// `basePixelRatio` is the resolution-independent ceiling from the pixel budget;
// `adaptiveScale` (0..1) is the runtime back-off multiplied on top of it. When
// resolution alone can't hold the target frame rate we drop to a smaller shadow
// map as a second lever. Bloom is left untouched so the look is preserved.
let basePixelRatio = pixelRatioForStage();
let adaptiveScale = 1;
const ADAPTIVE_SCALE_MIN = MIN_PIXEL_RATIO / MAX_PIXEL_RATIO;
const ADAPTIVE_SCALE_STEP = 0.12;
const TARGET_FPS = 50;
const RECOVER_FPS = 58;
const SHADOW_MAP_HIGH = 2048;
const SHADOW_MAP_LOW = 1024;
let shadowMapReduced = false;

function applyPixelRatio() {
  const ratio = THREE.MathUtils.clamp(
    basePixelRatio * adaptiveScale,
    MIN_PIXEL_RATIO,
    MAX_PIXEL_RATIO,
  );
  if (Math.abs(renderer.getPixelRatio() - ratio) < 0.001) return;
  renderer.setPixelRatio(ratio);
  renderer.setSize(sceneStage.clientWidth, sceneStage.clientHeight, false);
}

function setShadowMapSize(size) {
  if (sun.shadow.mapSize.width === size) return;
  sun.shadow.mapSize.set(size, size);
  // Force the shadow map texture to be recreated at the new resolution.
  sun.shadow.map?.dispose();
  sun.shadow.map = null;
  shadowMapReduced = size === SHADOW_MAP_LOW;
}

// Rolling FPS measurement with hysteresis. We only act on a sustained trend
// (a full sampling window below/above threshold) so a single janky frame —
// e.g. the GC pause when a flower generation dies — never triggers a step.
const FPS_WINDOW_MS = 1000;
let fpsFrames = 0;
let fpsWindowStart = 0;
let consecutiveSlow = 0;
let consecutiveFast = 0;

function monitorPerformance(nowMs) {
  if (fpsWindowStart === 0) {
    fpsWindowStart = nowMs;
    return;
  }
  fpsFrames += 1;
  const elapsed = nowMs - fpsWindowStart;
  if (elapsed < FPS_WINDOW_MS) return;

  const fps = (fpsFrames * 1000) / elapsed;
  fpsFrames = 0;
  fpsWindowStart = nowMs;

  if (fps < TARGET_FPS) {
    consecutiveSlow += 1;
    consecutiveFast = 0;
    // Lever 1: shed resolution first (cheapest visual cost on a soft scene).
    if (adaptiveScale > ADAPTIVE_SCALE_MIN + 0.001) {
      adaptiveScale = Math.max(ADAPTIVE_SCALE_MIN, adaptiveScale - ADAPTIVE_SCALE_STEP);
      applyPixelRatio();
    } else if (!shadowMapReduced && consecutiveSlow >= 2) {
      // Lever 2: at the resolution floor and still slow — shrink the shadow map.
      setShadowMapSize(SHADOW_MAP_LOW);
    }
  } else if (fps > RECOVER_FPS) {
    consecutiveFast += 1;
    consecutiveSlow = 0;
    // Recover conservatively, and only after a few good windows, so we don't
    // bounce between quality levels right at the threshold.
    if (consecutiveFast >= 3) {
      if (shadowMapReduced) {
        setShadowMapSize(SHADOW_MAP_HIGH);
        consecutiveFast = 0;
      } else if (adaptiveScale < 1 - 0.001) {
        adaptiveScale = Math.min(1, adaptiveScale + ADAPTIVE_SCALE_STEP);
        applyPixelRatio();
        consecutiveFast = 0;
      }
    }
  } else {
    consecutiveSlow = 0;
    consecutiveFast = 0;
  }
}

function updateCamera() {
  camera.updateMatrixWorld();
}

// Hover-to-bloom: project the pointer onto the ground plane and spawn flowers
// where it passes over visible moss (but never on the bare rock letters).
const clock = new THREE.Clock();
const FLOWER_VISIT_CELL_SIZE = 1.15;
const FLOWER_REENTRY_DELAY = 750;
const FLOWER_LEVEL_DECAY = 10000;
const FLOWER_LEVELS = 5;
// Early changes arrive quickly; the architectural upper levels need repeated
// returns so they feel cultivated rather than unlocked by a quick pointer waggle.
const FLOWER_LEVEL_REVISITS = [0, 1, 1, 2, 3];
const FLOWER_SPAWN_STEP = 0.18;
const TEXT_FLOWER_BAND = 0.5;
const TEXT_FLOWER_EDGE_OFFSET = 0.2;
const SIGN_FLOWER_KEEP_OUT_X = 0.92;
const SIGN_FLOWER_KEEP_OUT_NEAR_Z = 0.35;
const SIGN_FLOWER_KEEP_OUT_FAR_Z = 0.95;
const SIGN_FLOWER_AVOID_RADIUS = 1.65;
const SIGN_FLOWER_SMALL_RADIUS = 0.95;
const SIGN_FLOWER_FULL_RADIUS = 2.1;
const SIGN_FLOWER_RADIAL_WIND_RADIUS = 3.45;
const SIGN_FLOWER_RADIAL_WIND_STRENGTH = 0.16;
const flowerVisitGrid = new Map();
let activeFlowerCell = null;
let lastFlowerSpawn = null;
let activePlantPointerId = null;

function decayFlowerVisit(visit, now) {
  const elapsed = now - visit.levelChangedAt;
  const levelsLost = Math.min(visit.count - 1, Math.floor(elapsed / FLOWER_LEVEL_DECAY));
  if (levelsLost <= 0) return false;

  visit.count -= levelsLost;
  visit.progress = 0;
  visit.levelChangedAt += levelsLost * FLOWER_LEVEL_DECAY;
  return true;
}

function getFlowerVisit(x, z, now) {
  const gx = Math.floor(x / FLOWER_VISIT_CELL_SIZE);
  const gz = Math.floor(z / FLOWER_VISIT_CELL_SIZE);
  const key = `${gx}:${gz}`;

  if (key === activeFlowerCell) {
    const visit = flowerVisitGrid.get(key);
    decayFlowerVisit(visit, now);
    return visit;
  }

  if (activeFlowerCell) {
    flowerVisitGrid.get(activeFlowerCell).leftAt = now;
  }

  let visit = flowerVisitGrid.get(key);
  if (!visit) {
    visit = {
      count: 1,
      peakCount: 1,
      progress: 0,
      leftAt: -Infinity,
      levelChangedAt: now,
    };
    flowerVisitGrid.set(key, visit);
  } else if (!decayFlowerVisit(visit, now) && now - visit.leftAt >= FLOWER_REENTRY_DELAY) {
    if (visit.count < FLOWER_LEVELS) {
      visit.progress += 1;
      if (visit.progress >= FLOWER_LEVEL_REVISITS[visit.count]) {
        visit.count += 1;
        visit.peakCount = Math.max(visit.peakCount, visit.count);
        visit.progress = 0;
        visit.levelChangedAt = now;
      }
    }
  }

  activeFlowerCell = key;
  return visit;
}

function leaveFlowerArea() {
  if (activeFlowerCell) {
    flowerVisitGrid.get(activeFlowerCell).leftAt = performance.now();
    activeFlowerCell = null;
  }
  lastFlowerSpawn = null;
}

function spawnFlowerAtPointer(event) {
  const sceneNavHit = getSceneNavHit(event);
  if (!sceneNavHit && sceneNavHoverPinned) sceneNavHoverPinned = false;
  setSceneNavHover(sceneNavHit?.object.userData.sceneNavRoot ?? null, sceneNavHit);
  if (sceneNavHit) {
    leaveFlowerArea();
    return;
  }
  if (!flowerPatch) return;

  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);

  const ground = getGroundCorner(ndcX, ndcY);
  const { x, z } = ground;

  if (!isInInitialMoss(x, z)) {
    leaveFlowerArea();
    return;
  }
  if (isInsideSceneNavFlowerKeepOut(x, z)) {
    leaveFlowerArea();
    return;
  }

  const underRock = isUnderRockTest && isUnderRockTest(x, z);
  const rockEdge = nearestRockEdgeTest ? nearestRockEdgeTest(x, z) : null;
  const growsOnTextBoundary = !underRock && rockEdge && rockEdge.distance <= TEXT_FLOWER_BAND;
  if (underRock) {
    leaveFlowerArea();
    return;
  }

  const visit = getFlowerVisit(x, z, performance.now());
  if (lastFlowerSpawn) {
    const dx = x - lastFlowerSpawn.x;
    const dz = z - lastFlowerSpawn.z;
    if (dx * dx + dz * dz < FLOWER_SPAWN_STEP * FLOWER_SPAWN_STEP) return;
  }
  // Each flower that breaks ground nudges the surrounding hedge tufts aside,
  // so the moss reads as parting for the new growth rather than ignoring it.
  const levelsBelowPeak = visit.peakCount - visit.count;
  const legacyChance = levelsBelowPeak > 0
    ? Math.min(0.65, 0.25 + levelsBelowPeak * 0.12)
    : 0;
  const legacyStage = visit.peakCount - 1;
  const signDx = x - sceneNavGroup.position.x;
  const signDz = z - sceneNavGroup.position.z;
  const signDistance = Math.sqrt(signDx * signDx + signDz * signDz);
  const signStageT = THREE.MathUtils.smoothstep(signDistance, SIGN_FLOWER_SMALL_RADIUS, SIGN_FLOWER_FULL_RADIUS);
  const signStageCap = Math.floor(THREE.MathUtils.lerp(0, FLOWER_LEVELS - 1, signStageT));
  const growthStage = Math.min(visit.count - 1, signStageCap);
  const rememberedStage = Math.min(legacyStage, signStageCap);
  let planted;
  if (growsOnTextBoundary) {
    const edgeX = x - rockEdge.x * rockEdge.distance;
    const edgeZ = z - rockEdge.z * rockEdge.distance;
    planted = flowerPatch.scatterBoundary(
      edgeX + rockEdge.x * TEXT_FLOWER_EDGE_OFFSET,
      edgeZ + rockEdge.z * TEXT_FLOWER_EDGE_OFFSET,
      growthStage,
      legacyChance,
      rememberedStage,
    );
  } else {
    planted = flowerPatch.scatter(x, z, growthStage, legacyChance, rememberedStage);
  }
  if (planted.length === 0) return;

  // Only consume the movement step after a flower actually found room. Failed
  // collision attempts can retry immediately instead of creating a dead patch.
  lastFlowerSpawn = { x, z };
  for (const p of planted) {
    const basalScaleAt = (basalX, basalZ) => {
      if (!nearestRockEdgeTest) return 1;
      const distance = nearestRockEdgeTest(basalX, basalZ).distance;
      // The unscaled grass reaches roughly 0.3 units from its root. Reserve a
      // hard margin for its wind movement, then fit the whole blade footprint
      // into the remaining gap instead of testing the root point alone.
      const availableRadius = distance - 0.09;
      if (availableRadius <= 0.035) return 0;
      return THREE.MathUtils.clamp(availableRadius / 0.3, 0, 1);
    };
    const centerScale = basalScaleAt(p.rootX, p.rootZ);
    if (centerScale >= 0.18) growthShoots.add(p.rootX, p.rootZ, centerScale);
    const rootAngle = Math.atan2(p.z - p.rootZ, p.x - p.rootX);
    if (centerScale > 0.5) {
      const leftX = p.rootX + Math.cos(rootAngle + 2.15) * 0.12;
      const leftZ = p.rootZ + Math.sin(rootAngle + 2.15) * 0.12;
      const rightX = p.rootX + Math.cos(rootAngle - 2.15) * 0.12;
      const rightZ = p.rootZ + Math.sin(rootAngle - 2.15) * 0.12;
      const leftScale = basalScaleAt(leftX, leftZ);
      const rightScale = basalScaleAt(rightX, rightZ);
      if (leftScale >= 0.35) growthShoots.add(leftX, leftZ, leftScale);
      if (rightScale >= 0.35) growthShoots.add(rightX, rightZ, rightScale);
    }
    mossTop.pushFrom(p.x, p.z);
    if (fillTop) fillTop.pushFrom(p.x, p.z);
  }
}

function isDragPlantPointer(event) {
  return event.pointerType === 'touch' || event.pointerType === 'pen';
}

function shouldIgnorePlantPointer(event) {
  return isDragPlantPointer(event)
    && activePlantPointerId !== null
    && event.pointerId !== activePlantPointerId;
}

function handlePlantPointerDown(event) {
  if (!event.isPrimary || shouldIgnorePlantPointer(event)) return;

  if (isDragPlantPointer(event)) {
    activePlantPointerId = event.pointerId;
    canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  spawnFlowerAtPointer(event);
}

function handlePlantPointerMove(event) {
  if (shouldIgnorePlantPointer(event)) return;

  if (isDragPlantPointer(event)) event.preventDefault();
  spawnFlowerAtPointer(event);
}

function releasePlantPointer(event) {
  if (!isDragPlantPointer(event) || event.pointerId !== activePlantPointerId) return;

  if (canvas.hasPointerCapture?.(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  activePlantPointerId = null;
  leaveFlowerArea();
}

canvas.addEventListener('pointerdown', handlePlantPointerDown);
canvas.addEventListener('pointermove', handlePlantPointerMove);
canvas.addEventListener('pointerenter', spawnFlowerAtPointer);
canvas.addEventListener('pointerleave', (event) => {
  if (isDragPlantPointer(event) && event.pointerId === activePlantPointerId) return;
  if (!sceneNavHoverPinned) setSceneNavHover(null);
  leaveFlowerArea();
});
canvas.addEventListener('pointerup', releasePlantPointer);
canvas.addEventListener('pointercancel', (event) => {
  releasePlantPointer(event);
  sceneNavHoverPinned = false;
  setSceneNavHover(null);
  leaveFlowerArea();
});
canvas.addEventListener('click', (event) => {
  const sceneNavHit = getSceneNavHit(event);
  const sceneNavRoot = sceneNavHit?.object.userData.sceneNavRoot;
  if (!sceneNavRoot) return;

  event.preventDefault();
  sceneNavHoverPinned = true;
  setSceneNavHover(sceneNavRoot, sceneNavHit);
  triggerOverlayById(sceneNavRoot.userData.overlayId);
});

// Bloom post-processing: scene → threshold bloom added back over the original.
// Only the bright emissive flower blooms clear the threshold, so they throw a
// neon halo while the moss/rock stay clean. strength/radius/threshold are the dials.
startupPhaseStartedAt = performance.now();
const postProcessing = new THREE.PostProcessing(renderer);
const scenePass = pass(scene, camera);
const sceneColor = scenePass.getTextureNode('output');
// Gentle, scene-wide bloom: a soft glow on genuine highlights now that the
// lighting is balanced (nothing is over-driven past ~1.0 any more). Tasteful,
// not a halo machine — strength, radius, threshold.
const bloomPass = bloom(sceneColor, 0.1, 0.4, 0.8);
overlayDofAperture = uniform(OVERLAY_DOF_APERTURE * requestedOverlayDofAmount);
overlayDofMaxBlur = uniform(OVERLAY_DOF_MAX_BLUR * requestedOverlayDofAmount);
overlayBloomAmount = uniform(1);
overlaySceneDim = uniform(0);
requestedOverlayFocusDistance = getOverlayFocusDistance();
overlayFocusDistance = uniform(requestedOverlayFocusDistance);
// Composite bloom into the scene BEFORE the DOF blur, not after. The bloom is
// thresholded so only the bright emissive petals clear it — adding that sharp
// bloom on top of an already-blurred scene laid a crisp rim over soft petals,
// reading as a halo around every petal in the nav overlays. Feeding scene+bloom
// into DOF blurs the petal bloom together with the petals, so it softens with
// them. Closed (DOF at zero blur) this is a passthrough of scene+bloom — the
// look outside overlays is unchanged.
const bloomComposite = sceneColor.add(bloomPass.mul(overlayBloomAmount));
// Time fade: how open the overlay is (0 closed → 1 open). Zero when closed, so
// the normal view is untouched; ramps in with the open tween. Also used below to
// bypass the DOF render targets while closed, avoiding any one-frame warm-up
// softness from the multi-pass DOF pipeline.
const overlayOpenAmount = clamp(overlayDofMaxBlur.div(OVERLAY_DOF_MAX_BLUR), 0, 1);
// Depth-weighted DOF (local fork, see dofWeighted.js): each tap is weighted by
// its OWN circle of confusion, so a blurry background bleeds across the edge of
// a sharper petal instead of leaving it crisp. Takes the raw depth texture
// (sampleable at tap UVs) plus camera near/far rather than a per-fragment viewZ.
const sceneDepth = scenePass.getTextureNode('depth');
const overlayDofWidePass = dofWeighted(
  bloomComposite,
  sceneDepth,
  overlayFocusDistance,
  overlayDofAperture,
  overlayDofMaxBlur,
  camera.near,
  camera.far,
);
const overlayDofFillPass = dofWeighted(
  bloomComposite,
  sceneDepth,
  overlayFocusDistance,
  overlayDofAperture.mul(0.58),
  overlayDofMaxBlur.mul(0.72),
  camera.near,
  camera.far,
);
const overlayDofPass = mix(overlayDofWidePass, overlayDofFillPass, 0.38);
const overlaySceneSoftened = mix(bloomComposite, overlayDofPass, overlayOpenAmount);

// Depth-driven grade: the further a fragment sits from the focus plane, the
// darker and more contrasty it gets — so the blurred backdrop recedes behind
// the nav overlay instead of just going soft.
//
// Two separate signals drive it, and keeping them separate is the whole point:
//   • SPATIAL falloff — how far this fragment is from focus, in world units.
//     smoothstep over a fixed distance band gives a real near→far gradient.
//     (The earlier version divided by maxBlur, but the DOF node caps blur at
//     maxBlur, so that ratio saturated to 1 across the whole backdrop — the
//     grade had no gradient and slammed on everywhere at once.)
//   • TIME fade — how far the overlay has opened. overlayDofMaxBlur tweens from
//     0 → OVERLAY_DOF_MAX_BLUR, so that ratio IS the 0..1 open amount. We must
//     gate on it explicitly: it does NOT fall out of the spatial term (aperture
//     and maxBlur both scale with the open amount, so they cancel in any ratio
//     of the two — which is why the grade used to appear at full strength the
//     instant the blur began instead of fading in).
const overlayViewZ = scenePass.getViewZNode('depth');
// World-unit distance from the focus plane, faded across this band. Tune the
// band to the scene's depth so the near edge of the backdrop reads lighter than
// the far edge rather than the whole thing grading uniformly.
// Camera sits ~17 units from the focused text and the visible backdrop only
// runs a few units deeper, so the defocus distance |focus+viewZ| across the
// scene is single-digit — NOT the 16+ the band first assumed (which kept the
// spatial term pinned near 0, so the grade never showed). Band tuned to that
// real spread: starts grading almost immediately off the focus plane, full by
// ~6 units back.
const OVERLAY_GRADE_NEAR = 0.5; // below this defocus distance: no grade
const OVERLAY_GRADE_FAR = 6.0; // at/after this: full grade
const overlayDefocusDist = abs(overlayFocusDistance.add(overlayViewZ));
const overlaySpatial = smoothstep(OVERLAY_GRADE_NEAR, OVERLAY_GRADE_FAR, overlayDefocusDist);
const overlayDefocus = overlaySpatial.mul(overlayOpenAmount);
// How hard the grade pushes at full defocus. darken multiplies brightness down;
// contrast pushes colour away from a low pivot. Both lerp from 1.0 (no change)
// toward these floors by overlayDefocus.
const OVERLAY_DEPTH_DARKEN = 1.0; // far backdrop keeps ~75% brightness
const OVERLAY_DEPTH_CONTRAST = 1.0; // far backdrop gains ~8% contrast
const overlayDarken = mix(uniform(1), uniform(OVERLAY_DEPTH_DARKEN), overlayDefocus);
const overlayContrast = mix(uniform(1), uniform(OVERLAY_DEPTH_CONTRAST), overlayDefocus);
// Pivot sits near the dark backdrop's own tone, not mid-grey, so the contrast
// push doesn't crush the already-dark moss/rock toward black.
const overlayPivot = 0.25;
const overlayGradedRgb = overlaySceneSoftened.rgb
  .sub(overlayPivot)
  .mul(overlayContrast)
  .add(overlayPivot)
  .mul(overlayDarken)
  .max(0);
// Separate whole-scene dim, composed AFTER the depth grade. Depth-agnostic and
// driven by its own uniform/tween, so it darkens the entire frame uniformly as
// the overlay opens without touching the grade's math. One scalar multiply —
// the cheapest per-frame lever in the pipeline (single uniform write, no graph
// recompile). lerp 1 → OVERLAY_SCENE_DIM by overlaySceneDim.
const overlayDimFactor = mix(uniform(1), uniform(OVERLAY_SCENE_DIM), overlaySceneDim);
postProcessing.outputNode = vec4(overlayGradedRgb.mul(overlayDimFactor), overlaySceneSoftened.a);
recordStartupTiming('post-processing setup', startupPhaseStartedAt);

function animate(timeMs) {
  updateCamera();
  const dt = clock.getDelta();
  if (flowerPatch) {
    updateSceneNavPointWind();
    flowerPatch.update(dt);
  }
  mossTop.update(dt);
  growthShoots.update(dt);
  if (fillTop) fillTop.update(dt);
  postProcessing.render();
  // Adaptive quality controller temporarily disabled — the runtime resolution /
  // shadow-map back-off is off so the scene renders at a fixed quality. Re-enable
  // by restoring this call:
  //   monitorPerformance(timeMs ?? clock.elapsedTime * 1000);
}

function updateStats() {
  const backend = navigator.gpu ? 'WebGPU' : 'WebGL2 fallback';
  const tuftCount = mossTop.mesh.count + fillTuftCount;
  console.log(`[craftyhedge] ${backend} / ${tuftCount.toLocaleString()} moss instances`);
}

async function start() {
  try {
    setLoaderMessage('Planting…');
    await timeStartupAsync('WebGPU renderer init', () => renderer.init());
  } catch (error) {
    showUnsupported('WebGPU could not start in this browser.');
    console.error(error);
    return;
  }

  resize();

  try {
    setLoaderMessage('Planting…');
    // The rock text + moss culling only exist once the font has loaded; wait for
    // that before building anything downstream of the glyph masks.
    await timeStartupAsync('font scene readiness', () => fontReady, 'gate');

    // Build the flower patch NOW, while the loader is still up, instead of after
    // reveal. The visible stall before flowers appeared wasn't CPU geometry work
    // (the meshes are tiny) — it was the lazy compilation of the flower node
    // materials, which WebGPU defers until each pipeline is first drawn. Creating
    // the patch up front and then compileAsync()-ing the whole scene forces every
    // pipeline (moss, rock, flowers, bloom) to compile during the loading screen,
    // so the first real frame is already warm and flowers spawn instantly on hover.
    setLoaderMessage('Trimming…');
    await createFlowers();
    await timeStartupAsync(
      'WebGPU scene compilation',
      () => renderer.compileAsync(scene, camera),
    );

    setLoaderMessage('Almost ready…');
    await timeStartupAsync('first post-processed frame', () => postProcessing.renderAsync());
    await timeStartupAsync('post-processing warm-up', async () => {
      await postProcessing.renderAsync();
      await postProcessing.renderAsync();
    });
  } catch (error) {
    showLoaderError('The scene failed to load.');
    console.error(error);
    return;
  }

  revealScene();
  reportStartupTimings();
  renderer.setAnimationLoop(animate);
}

window.addEventListener('resize', resize);

recordStartupTiming('module setup before start()', startupStartedAt, 'gate');
start();
