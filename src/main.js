import './styles.css';
import * as THREE from 'three/webgpu';
import { createTuftBlanket } from './foliage.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { abs, color, mix, mx_fractal_noise_float, normalWorld, oneMinus, pass, positionWorld, smoothstep } from 'three/tsl';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { createDappleNode } from './dapple.js';
import { createFlowerPatch } from './flowers.js';

const canvas = document.querySelector('#scene');
const sceneStage = document.querySelector('[data-scene-stage]');
const fallback = document.querySelector('[data-webgpu-fallback]');

const renderer = new THREE.WebGPURenderer({
  antialias: true,
  canvas,
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
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
const TEXT_SIZE = 2.75;
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

function fitCameraToText(aspect) {
  camera.aspect = aspect;
  camera.fov = DESIGN_VERTICAL_FOV;
  camera.updateProjectionMatrix();

  let nearScale = 0.5;
  let farScale = 4;

  for (let i = 0; i < 18; i += 1) {
    const scale = (nearScale + farScale) / 2;
    setCameraScale(scale);
    const projectedCorners = textFrameCorners.map((point) => point.clone().project(camera));
    const maxScreenX = Math.max(...projectedCorners.map((point) => Math.abs(point.x)));
    const halfScreenHeight = (
      Math.max(...projectedCorners.map((point) => point.y))
      - Math.min(...projectedCorners.map((point) => point.y))
    ) / 2;

    if (maxScreenX > TEXT_SCREEN_HALF_WIDTH || halfScreenHeight > TEXT_SCREEN_HALF_HEIGHT) nearScale = scale;
    else farScale = scale;
  }

  setCameraScale(farScale);

  const projectedText = textFrameCorners.map((point) => point.clone().project(camera));
  const textScreenCenterY = (
    Math.min(...projectedText.map((point) => point.y))
    + Math.max(...projectedText.map((point) => point.y))
  ) / 2;
  camera.projectionMatrix.elements[9] += textScreenCenterY - TEXT_SCREEN_CENTER_Y;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

fitCameraToText(INITIAL_STAGE_ASPECT);

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
    color: 0x123b14,
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

// Set once the near-letter fill blanket is built inside the async font load.
let fillTuftCount = 0;
// Exposed so the spawn handler / animate loop can push these tufts as flowers grow.
let fillTop = null;
// Set once the glyph masks exist; lets the flower spawner skip the rock letters.
let isUnderRockTest = null;
// Nearest glyph boundary and outward direction, used by the text-edge flowers.
let nearestRockEdgeTest = null;

const mossTop = createTuftBlanket({
  width: HEDGE_WIDTH,
  depth: HEDGE_DEPTH,
  centerX: HEDGE_CENTER_X,
  centerZ: HEDGE_CENTER_Z,
  visibilityTest: isInVisibleHedge,
  spacing: 0.18,
  seed: 184,
  heightRange: [0.26, 0.74],
  widthRange: [0.64, 1.08],
  windRange: [0.12, 0.26],
  animated: true,
  windScale: 3.2,
  windSpeed: 1.0,
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

scene.add(hedgeBase, mossTop.mesh);

const flowerPatch = createFlowerPatch({
  maxFlowers: 1200,
  yOffset: GROUND_Y,
  canGrow: (x, z) => isInVisibleHedge(x, z) && !(isUnderRockTest && isUnderRockTest(x, z)),
  // Keep stems upright beside the rock. Farther out they smoothly regain their
  // species lean, so no stem can angle through a letter wall.
  tiltScale: (x, z) => {
    if (!nearestRockEdgeTest) return 1;
    return THREE.MathUtils.smoothstep(nearestRockEdgeTest(x, z).distance, 0.24, 0.6);
  },
  // Same drifting leaf-shadow as the moss, but capped at 1.0 so it only shades
  // the blooms into the pools — never lifts the saturated petals back toward the
  // neon blowout we just dialled out. Sampled by world XZ (flowers sit low).
  dapple: { ...dappleConfig, clampMax: 1, project: false },
});
scene.add(flowerPatch.object);

const sun = new THREE.DirectionalLight(0xfff2c4, 4.0);
sun.position.copy(SUN_POSITION);
sun.target.position.copy(SUN_TARGET);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -11;
sun.shadow.camera.right = 11;
sun.shadow.camera.top = 7;
sun.shadow.camera.bottom = -7;
sun.shadow.camera.near = 7;
sun.shadow.camera.far = 28;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.035;
scene.add(sun);
scene.add(sun.target);

const skyLight = new THREE.HemisphereLight(0xd7fff1, 0x101008, 3.0);
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
  const contours = font.generateShapes(word, TEXT_SIZE).map((shape) => shape.extractPoints(8));

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

const fontLoader = new FontLoader();
fontLoader.load(
  'https://threejs.org/examples/fonts/helvetiker_bold.typeface.json',
  (font) => {
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

    const craftyMesh = createRockLetter('CRAFTY');
    const hedgeMesh = createRockLetter('HEDGE');

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

    const craftyMask = createGlyphMask(
      font,
      'CRAFTY',
      craftyMesh.userData.footprintCenter.x,
      craftyMesh.userData.footprintCenter.z,
      TEXT_CENTER_Z - TEXT_LINE_SPACING / 2,
    );
    const hedgeMask = createGlyphMask(
      font,
      'HEDGE',
      hedgeMesh.userData.footprintCenter.x,
      hedgeMesh.userData.footprintCenter.z,
      TEXT_CENTER_Z + TEXT_LINE_SPACING / 2,
    );
    // Cull tufts under the letters AND any rooted within a blade-reach of the
    // glyph edge: a tuft is ~0.5 units wide and leans in the wind, so one rooted
    // just outside (or just inside near a wall) still fans its blades up over the
    // now-taller letter sides. Removing inside-or-near-edge clears those.
    const TUFT_CULL_MARGIN = 0.3;
    const isUnderRock = (x, z) => {
      if (craftyMask.contains(x, z) || hedgeMask.contains(x, z)) return true;
      const nearest = Math.min(
        craftyMask.nearestEdge(x, z).distance,
        hedgeMask.nearestEdge(x, z).distance,
      );
      return nearest < TUFT_CULL_MARGIN;
    };

    // Flowers are short, so they don't need the tuft's wide keep-out — only the
    // rock itself plus a hair of clearance. Using the full TUFT_CULL_MARGIN here
    // sealed the inner letter gaps (the A/R/O counters, slots between strokes):
    // 0.3 from each facing wall closed any gap under ~0.6 wide. A tiny margin
    // lets blooms fill those holes reliably while still keeping them off the rock.
    const FLOWER_CULL_MARGIN = 0.06;
    const isUnderRockForFlowers = (x, z) => {
      if (craftyMask.contains(x, z) || hedgeMask.contains(x, z)) return true;
      const nearest = Math.min(
        craftyMask.nearestEdge(x, z).distance,
        hedgeMask.nearestEdge(x, z).distance,
      );
      return nearest < FLOWER_CULL_MARGIN;
    };

    isUnderRockTest = isUnderRockForFlowers;
    mossTop.removeWhere(isUnderRock);

    // Fine fill tufts that hug the letters: half-size, denser-spaced moss that
    // grows into the bare halo the big-tuft cull leaves around the text. Short
    // blades, so they can crowd much closer (FILL_CULL_MARGIN) than the big tufts
    // without poking over the letter walls. Restricted to a band near the edges
    // (FILL_BAND) so this stays a cheap near-text layer, not a whole-field pass.
    const FILL_CULL_MARGIN = 0.08;
    const FILL_BAND = 0.9;
    const nearestRockEdge = (x, z) => Math.min(
      craftyMask.nearestEdge(x, z).distance,
      hedgeMask.nearestEdge(x, z).distance,
    );
    nearestRockEdgeTest = (x, z) => {
      const craftyEdge = craftyMask.nearestEdge(x, z);
      const hedgeEdge = hedgeMask.nearestEdge(x, z);
      return craftyEdge.distance < hedgeEdge.distance ? craftyEdge : hedgeEdge;
    };
    fillTop = createTuftBlanket({
      width: HEDGE_WIDTH,
      depth: HEDGE_DEPTH,
      centerX: HEDGE_CENTER_X,
      centerZ: HEDGE_CENTER_Z,
      visibilityTest: (x, z) => {
        if (!isInVisibleHedge(x, z)) return false;
        if (craftyMask.contains(x, z) || hedgeMask.contains(x, z)) return false;
        const edge = nearestRockEdge(x, z);
        return edge >= FILL_CULL_MARGIN && edge <= FILL_BAND;
      },
      spacing: 0.1,
      seed: 521,
      heightRange: [0.12, 0.34],
      widthRange: [0.32, 0.56],
      windRange: [0.1, 0.22],
      animated: true,
      windScale: 3.2,
      windSpeed: 1.0,
      yOffset: GROUND_Y,
      hueRange: [0.22, 0.33],
      saturationRange: [0.62, 0.86],
      lightnessRange: [0.24, 0.56],
      brightnessRange: [0.9, 1.18],
      shadeRange: [0.72, 1.1],
      roughness: 1,
      dapple: tuftDappleConfig,
    });
    scene.add(fillTop.mesh);
    fillTuftCount = fillTop.mesh.count;

    const applyWindAvoidance = (blanket) => blanket.setWindAvoidance((x, z) => {
      const craftyEdge = craftyMask.nearestEdge(x, z);
      const hedgeEdge = hedgeMask.nearestEdge(x, z);
      const edge = craftyEdge.distance < hedgeEdge.distance ? craftyEdge : hedgeEdge;

      return {
        x: edge.x,
        z: edge.z,
        influence: 1 - THREE.MathUtils.smoothstep(edge.distance, 0.08, 0.75),
      };
    });
    applyWindAvoidance(mossTop);
    applyWindAvoidance(fillTop);
    updateStats();
  }
);

function resize() {
  const width = sceneStage.clientWidth;
  const height = sceneStage.clientHeight;

  fitCameraToText(width / height);
  renderer.setSize(width, height, false);
}

function updateCamera() {
  camera.updateMatrixWorld();
}

// Hover-to-bloom: project the pointer onto the ground plane and spawn flowers
// where it passes over visible moss (but never on the bare rock letters).
const clock = new THREE.Clock();
const FLOWER_VISIT_CELL_SIZE = 1.15;
const FLOWER_REENTRY_DELAY = 750;
const FLOWER_LEVEL_DECAY = 50000;
const FLOWER_SPAWN_STEP = 0.18;
const TEXT_FLOWER_BAND = 0.5;
const TEXT_FLOWER_EDGE_OFFSET = 0.2;
const flowerVisitGrid = new Map();
let activeFlowerCell = null;
let lastFlowerSpawn = null;

function decayFlowerVisit(visit, now) {
  const elapsed = now - visit.levelChangedAt;
  const levelsLost = Math.min(visit.count - 1, Math.floor(elapsed / FLOWER_LEVEL_DECAY));
  if (levelsLost <= 0) return false;

  visit.count -= levelsLost;
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
    visit = { count: 1, leftAt: -Infinity, levelChangedAt: now };
    flowerVisitGrid.set(key, visit);
  } else if (!decayFlowerVisit(visit, now) && now - visit.leftAt >= FLOWER_REENTRY_DELAY) {
    visit.count = Math.min(3, visit.count + 1);
    visit.levelChangedAt = now;
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
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);

  const ground = getGroundCorner(ndcX, ndcY);
  const { x, z } = ground;

  if (!isInVisibleHedge(x, z)) {
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
  lastFlowerSpawn = { x, z };

  // Each flower that breaks ground nudges the surrounding hedge tufts aside,
  // so the moss reads as parting for the new growth rather than ignoring it.
  let planted;
  if (growsOnTextBoundary) {
    const edgeX = x - rockEdge.x * rockEdge.distance;
    const edgeZ = z - rockEdge.z * rockEdge.distance;
    planted = flowerPatch.scatterBoundary(
      edgeX + rockEdge.x * TEXT_FLOWER_EDGE_OFFSET,
      edgeZ + rockEdge.z * TEXT_FLOWER_EDGE_OFFSET,
      visit.count - 1,
    );
  } else {
    planted = flowerPatch.scatter(x, z, visit.count - 1);
  }
  for (const p of planted) {
    mossTop.pushFrom(p.x, p.z);
    if (fillTop) fillTop.pushFrom(p.x, p.z);
  }
}

canvas.addEventListener('pointermove', spawnFlowerAtPointer);
canvas.addEventListener('pointerleave', leaveFlowerArea);
canvas.addEventListener('pointercancel', leaveFlowerArea);

// Bloom post-processing: scene → threshold bloom added back over the original.
// Only the bright emissive flower blooms clear the threshold, so they throw a
// neon halo while the moss/rock stay clean. strength/radius/threshold are the dials.
const postProcessing = new THREE.PostProcessing(renderer);
const scenePass = pass(scene, camera);
const sceneColor = scenePass.getTextureNode('output');
// Gentle, scene-wide bloom: a soft glow on genuine highlights now that the
// lighting is balanced (nothing is over-driven past ~1.0 any more). Tasteful,
// not a halo machine — strength, radius, threshold.
const bloomPass = bloom(sceneColor, 0.1, 0.4, 0.8);
postProcessing.outputNode = sceneColor.add(bloomPass);

function animate() {
  updateCamera();
  const dt = clock.getDelta();
  flowerPatch.update(dt);
  mossTop.update(dt);
  if (fillTop) fillTop.update(dt);
  postProcessing.render();
}

function updateStats() {
  const backend = navigator.gpu ? 'WebGPU' : 'WebGL2 fallback';
  const tuftCount = mossTop.mesh.count + fillTuftCount;
  console.log(`[craftyhedge] ${backend} / ${tuftCount.toLocaleString()} moss instances`);
}

async function start() {
  try {
    await renderer.init();
  } catch (error) {
    fallback.hidden = false;
    fallback.textContent = 'WebGPU could not start in this browser.';
    console.error(error);
    return;
  }

  resize();
  renderer.setAnimationLoop(animate);
}

window.addEventListener('resize', resize);

start();
