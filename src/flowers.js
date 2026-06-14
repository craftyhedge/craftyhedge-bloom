import * as THREE from 'three/webgpu';
import {
  abs, attribute, cos, floor, instancedBufferAttribute, mix, mul, normalLocal,
  normalView, positionLocal, sin, smoothstep, uniform, vec3, vec4, vertexColor,
  transformNormalToView, vibrance,
} from 'three/tsl';
import { createDappleNode } from './dapple.js';

const HEAD_Y = 0.62; // local height of the bloom face above the flower root

// Each species is a plant archetype: its own petal FORM, palette, size, stem
// height, lean and open speed. A patch of one species reads as a real wildflower
// stand rather than confetti.
//   size: [min,max] scale   stem: [min,max] head height   tilt: max lean (rad)
//   bloom: [min,max] open speed   form: petal morphology
const SPECIES = [
  {
    stage: 0,
    name: 'indigo', palette: ['#596fd8', '#4056b9', '#7689e2'],
    size: [0.6, 0.95], stem: [0.42, 0.58], tilt: 0.5, bloom: [1.4, 2.4],
    form: { petals: 5, rings: 1, tip: 0.52, wide: 0.34, lift: 0.13, cup: 0.3, closed: 1.05, open: 0.12, postureSpread: 0.2, shape: 'round', disc: 0.16, discColor: 0xffdf62, discLift: 0.02 },
  },
  {
    stage: 0,
    name: 'aqua', palette: ['#3ce0a0', '#15bd86', '#6ff2bf'],
    size: [0.45, 0.7], stem: [0.4, 0.54], tilt: 0.35, bloom: [2.2, 3.4],
    form: { petals: 14, rings: 1, tip: 0.5, wide: 0.07, lift: 0.04, cup: 0.06, closed: 0.9, open: -0.16, shape: 'spoon', disc: 0.2, discColor: 0xd6a32e, discLift: 0.05 },
  },
  {
    stage: 0,
    name: 'blue', palette: ['#5791d2', '#3972b7', '#76aae0'],
    size: [0.4, 0.62], stem: [0.46, 0.62], tilt: 0.6, bloom: [2.0, 3.0],
    form: { petals: 8, rings: 2, tip: 0.5, wide: 0.13, lift: 0.12, cup: 0.32, closed: 1.1, open: 0.1, ringLift: 0.2, postureSpread: 0.18, shape: 'notch', disc: 0.1, discColor: 0xdff7ff, discLift: 0.06 },
  },
  {
    stage: 0,
    name: 'emerald', palette: ['#4cd860', '#2aa83f', '#7ce882'],
    size: [0.4, 0.6], stem: [0.4, 0.52], tilt: 0.4, bloom: [2.6, 3.8],
    architecture: {
      type: 'root-clump', stems: [4, 6], rootSpread: 0.07,
      tilt: [0.08, 0.3], scale: [0.82, 1.02], stemScale: [0.78, 1.05],
    },
    form: { petals: 5, rings: 1, tip: 0.46, wide: 0.3, lift: 0.12, cup: 0.38, closed: 1.0, open: 0.18, postureSpread: 0.22, shape: 'round', disc: 0.12, discColor: 0xffe56b, discLift: 0.03 },
  },
  {
    stage: 0,
    name: 'snowdrop', palette: ['#f2f2e9', '#dfe8df', '#eef3e6'],
    size: [0.34, 0.48], stem: [0.54, 0.72], tilt: 0.48, bloom: [2.0, 3.0],
    architecture: {
      type: 'root-clump', stems: [3, 5], rootSpread: 0.055,
      tilt: [0.18, 0.5], scale: [0.86, 1.08], stemScale: [0.82, 1.16],
    },
    form: { petals: 3, rings: 1, tip: 0.44, wide: 0.18, lift: 0.03, cup: 0.48, closed: -0.5, open: -1.18, postureSpread: 0.08, shape: 'spoon', disc: 0.075, discColor: 0x83a94f, discLift: 0.015 },
  },
  {
    stage: 1,
    name: 'cobalt', palette: ['#5a70c8', '#4055aa', '#788bd4'],
    size: [0.35, 0.55], stem: [0.38, 0.5], tilt: 0.7, bloom: [2.4, 3.4],
    form: { petals: 5, rings: 1, tip: 0.44, wide: 0.26, lift: 0.06, cup: 0.04, closed: 0.95, open: -0.2, shape: 'point', disc: 0.08, discColor: 0xd6a32e, discLift: 0.02 },
  },
  {
    stage: 1,
    name: 'sun-yellow', palette: ['#fff02e', '#ffc928', '#fff866'],
    size: [0.6, 0.95], stem: [0.48, 0.64], tilt: 0.55, bloom: [1.6, 2.6],
    form: { petals: 8, rings: 1, tip: 0.54, wide: 0.2, lift: 0.07, cup: 0.08, closed: 1.05, open: -0.12, shape: 'notch', disc: 0.16, discColor: 0xffa914, discLift: 0.04 },
  },
  {
    stage: 1,
    name: 'clear-cyan', palette: ['#27dfff', '#00addf', '#64ebff'],
    size: [0.48, 0.72], stem: [0.5, 0.68], tilt: 0.48, bloom: [2.0, 3.0],
    form: { petals: 7, rings: 1, tip: 0.58, wide: 0.16, lift: 0.08, cup: 0.1, closed: 1.1, open: -0.18, shape: 'point', disc: 0.12, discColor: 0xffed87, discLift: 0.05 },
  },
  {
    stage: 1,
    name: 'tangerine', palette: ['#ff9f2f', '#ef741c', '#ffbd4d'],
    size: [0.52, 0.78], stem: [0.45, 0.62], tilt: 0.4, bloom: [1.8, 2.8],
    form: { petals: 6, rings: 1, tip: 0.5, wide: 0.24, lift: 0.15, cup: 0.5, closed: 1.15, open: 0.24, postureSpread: 0.18, shape: 'round', disc: 0.13, discColor: 0xffdc50, discLift: 0.05 },
  },
  {
    stage: 2,
    name: 'crimson-crown', palette: ['#ed3552', '#c91f3d', '#ff5e6e'],
    size: [0.72, 1.0], stem: [0.62, 0.82], tilt: 0.38, bloom: [1.4, 2.2],
    form: { petals: 7, rings: 3, tierHeight: 0.11, tierScale: 0.76, tierTwist: 0.34, tip: 0.64, wide: 0.15, lift: 0.16, cup: 0.38, closed: 1.24, open: 0.08, ringLift: 0.11, postureSpread: 0.2, shape: 'notch', disc: 0.14, discColor: 0xffe278, discLift: 0.08 },
  },
  {
    stage: 2,
    name: 'electric-blue', palette: ['#4384cb', '#2866aa', '#65a1d9'],
    size: [0.65, 0.9], stem: [0.58, 0.78], tilt: 0.5, bloom: [1.5, 2.3],
    form: { petals: 4, rings: 3, tierHeight: 0.16, tierScale: 0.7, tierTwist: 0.68, tip: 0.66, wide: 0.25, lift: 0.2, cup: 0.58, closed: 1.34, open: 0.3, ringLift: 0.1, postureSpread: 0.24, shape: 'spoon', disc: 0.1, discColor: 0xe9fbff, discLift: 0.08 },
  },
  {
    stage: 2,
    name: 'orange-crown', palette: ['#ff7424', '#e84a15', '#ff9b38'],
    size: [0.7, 0.96], stem: [0.56, 0.76], tilt: 0.42, bloom: [1.5, 2.4],
    form: { petals: 6, rings: 3, tierHeight: 0.13, tierScale: 0.72, tierTwist: 0.46, tip: 0.62, wide: 0.18, lift: 0.09, cup: 0.12, closed: 1.14, open: -0.16, ringLift: 0.08, postureSpread: 0.14, shape: 'point', disc: 0.18, discColor: 0xfff0a8, discLift: 0.07 },
  },
  {
    stage: 3,
    name: 'violet-spire', palette: ['#b64cff', '#7b26dc', '#dc78ff'],
    size: [0.54, 0.74], stem: [0.66, 0.86], tilt: 0.25, bloom: [1.6, 2.3],
    form: { petals: 4, rings: 5, tierHeight: 0.14, tierScale: 0.83, tierTwist: 0.62, tip: 0.38, wide: 0.14, lift: 0.1, cup: 0.42, closed: 1.25, open: 0.28, ringLift: 0.05, postureSpread: 0.12, shape: 'spoon', disc: 0.07, discColor: 0xffdf70, discLift: 0.03 },
  },
  {
    stage: 3,
    name: 'scarlet-spire', palette: ['#ff405c', '#d51f45', '#ff7480'],
    size: [0.52, 0.72], stem: [0.68, 0.9], tilt: 0.23, bloom: [1.5, 2.2],
    form: { petals: 5, rings: 5, tierHeight: 0.13, tierScale: 0.82, tierTwist: 0.5, tip: 0.34, wide: 0.11, lift: 0.08, cup: 0.3, closed: 1.18, open: 0.14, ringLift: 0.04, postureSpread: 0.1, shape: 'point', disc: 0.06, discColor: 0xfff0a0, discLift: 0.03 },
  },
  {
    stage: 3,
    name: 'azure-plume', palette: ['#49b8cf', '#2f8fae', '#79cfda'],
    size: [0.48, 0.68], stem: [0.74, 0.94], tilt: 0.3, bloom: [1.7, 2.5],
    form: { petals: 3, rings: 7, tierHeight: 0.1, tierScale: 0.9, tierTwist: 0.92, tip: 0.46, wide: 0.08, lift: 0.05, cup: 0.08, closed: 1.05, open: -0.24, ringLift: 0.025, postureSpread: 0.08, shape: 'point', disc: 0.05, discColor: 0xeaffff, discLift: 0.02 },
  },
  {
    stage: 3,
    name: 'amber-pagoda', palette: ['#ffb52e', '#e86616', '#ffe06b'],
    size: [0.58, 0.78], stem: [0.62, 0.82], tilt: 0.2, bloom: [1.4, 2.1],
    form: { petals: 6, rings: 4, tierHeight: 0.18, tierScale: 0.72, tierTwist: 0.38, tip: 0.5, wide: 0.22, lift: 0.12, cup: 0.54, closed: 1.3, open: 0.32, ringLift: 0.08, postureSpread: 0.12, shape: 'round', disc: 0.08, discColor: 0x6c3515, discLift: 0.04 },
  },
  {
    stage: 4,
    name: 'moon-candelabra', palette: ['#f4f2ff', '#a9c8ff', '#d9aaff'],
    size: [0.68, 0.9], stem: [0.72, 0.96], tilt: 0.2, bloom: [1.3, 2.0],
    form: { petals: 7, rings: 3, tierHeight: 0.24, tierScale: 0.7, tierTwist: 0.32, tip: 0.66, wide: 0.16, lift: 0.15, cup: 0.18, closed: 1.15, open: -0.08, ringLift: 0.12, postureSpread: 0.16, shape: 'notch', disc: 0.11, discColor: 0xffd95c, discLift: 0.05 },
  },
  {
    stage: 4,
    name: 'gold-candelabra', palette: ['#fff43d', '#ffb51f', '#fff79a'],
    size: [0.66, 0.88], stem: [0.7, 0.94], tilt: 0.18, bloom: [1.25, 1.9],
    form: { petals: 6, rings: 3, tierHeight: 0.25, tierScale: 0.68, tierTwist: 0.4, tip: 0.7, wide: 0.2, lift: 0.13, cup: 0.12, closed: 1.08, open: -0.16, ringLift: 0.1, postureSpread: 0.14, shape: 'point', disc: 0.12, discColor: 0xff7b17, discLift: 0.05 },
  },
  {
    stage: 4,
    name: 'ruby-lantern', palette: ['#ff315f', '#a80e45', '#ff8097'],
    size: [0.72, 0.94], stem: [0.78, 1.0], tilt: 0.16, bloom: [1.2, 1.8],
    form: { petals: 4, rings: 4, tierHeight: 0.2, tierScale: 0.76, tierTwist: 0.78, tip: 0.72, wide: 0.3, lift: 0.2, cup: 0.72, closed: 1.42, open: 0.42, ringLift: 0.14, postureSpread: 0.18, shape: 'spoon', disc: 0.1, discColor: 0xffd36b, discLift: 0.06 },
  },
  {
    stage: 4,
    name: 'teal-orbit', palette: ['#46ec9c', '#149e6e', '#9bffce'],
    size: [0.7, 0.92], stem: [0.68, 0.9], tilt: 0.22, bloom: [1.35, 2.0],
    form: { petals: 10, rings: 2, tierHeight: 0.34, tierScale: 0.58, tierTwist: 0.17, tip: 0.76, wide: 0.09, lift: 0.06, cup: 0.02, closed: 0.96, open: -0.32, ringLift: 0.08, postureSpread: 0.1, shape: 'point', disc: 0.2, discColor: 0xf2ffff, discLift: 0.04 },
  },
  {
    boundary: true,
    stage: 0,
    name: 'edge-bell', palette: ['#e8ffff', '#a8efff', '#c8f8ef'],
    size: [0.3, 0.46], stem: [0.3, 0.44], tilt: 0.32, bloom: [2.5, 3.6],
    form: { petals: 6, rings: 1, tip: 0.38, wide: 0.16, lift: 0.12, cup: 0.48, closed: 1.2, open: 0.22, shape: 'round', disc: 0.08, discColor: 0xffe66d, discLift: 0.04 },
  },
  {
    boundary: true,
    stage: 1,
    name: 'edge-star', palette: ['#fff43b', '#ffd21f', '#ffeb58'],
    size: [0.36, 0.54], stem: [0.34, 0.5], tilt: 0.38, bloom: [2.1, 3.2],
    form: { petals: 7, rings: 1, tip: 0.42, wide: 0.1, lift: 0.06, cup: 0.04, closed: 1.0, open: -0.2, shape: 'point', disc: 0.09, discColor: 0xf6ffff, discLift: 0.05 },
  },
  {
    boundary: true,
    stage: 2,
    name: 'edge-trumpet', palette: ['#ff5e55', '#df3340', '#ff805f'],
    size: [0.42, 0.62], stem: [0.38, 0.56], tilt: 0.42, bloom: [1.8, 2.8],
    form: { petals: 5, rings: 1, tip: 0.48, wide: 0.2, lift: 0.16, cup: 0.62, closed: 1.3, open: 0.3, shape: 'spoon', disc: 0.08, discColor: 0xffef9c, discLift: 0.06 },
  },
  {
    boundary: true,
    stage: 2,
    name: 'edge-electric-blue', palette: ['#4388c4', '#2e6fa5', '#69a7d0'],
    size: [0.46, 0.66], stem: [0.4, 0.58], tilt: 0.36, bloom: [1.7, 2.7],
    form: { petals: 8, rings: 2, tip: 0.46, wide: 0.1, lift: 0.07, cup: 0.1, closed: 1.15, open: -0.12, ringLift: 0.14, shape: 'point', disc: 0.09, discColor: 0xd9ffff, discLift: 0.07 },
  },
];

const SPECIES_INDEX = new Map(SPECIES.map((species, index) => [species.name, index]));
const makeFamily = (...names) => names.map((name) => SPECIES_INDEX.get(name));

// Each repeat visit advances through a deliberately contrasting sequence. The
// previous generation remains visible through its longer lifetime, so spawning
// more parent flowers here only muddies the change instead of clarifying it.
const FIELD_FAMILIES = [
  makeFamily('indigo', 'sun-yellow', 'orange-crown', 'violet-spire', 'moon-candelabra'),
  makeFamily('tangerine', 'clear-cyan', 'crimson-crown', 'azure-plume', 'gold-candelabra'),
  makeFamily('snowdrop', 'cobalt', 'orange-crown', 'scarlet-spire', 'ruby-lantern'),
  makeFamily('emerald', 'edge-star', 'electric-blue', 'amber-pagoda', 'teal-orbit'),
];
const BOUNDARY_FAMILIES = [
  makeFamily('edge-bell', 'edge-star', 'edge-trumpet', 'violet-spire', 'moon-candelabra'),
];

// Make repeat visits readable even before the viewer notices a different petal
// shape: later stages rise above the earlier carpet and step toward lighter,
// more luminous colours.
const STAGE_STYLE = [
  { scale: 0.86, stem: 0.92, life: 1, saturation: 0.02, lightness: 0 },
  { scale: 1.06, stem: 1.08, life: 1.35, saturation: 0.015, lightness: 0.015 },
  { scale: 1.28, stem: 1.22, life: 1.75, saturation: 0.025, lightness: 0.02 },
  { scale: 1.42, stem: 1.34, life: 2.1, saturation: 0.03, lightness: 0.03 },
  { scale: 1.56, stem: 1.46, life: 2.45, saturation: 0.035, lightness: 0.04 },
];

// ---------------------------------------------------------------------------
// Geometry: petals and bases are SEPARATE meshes so a petal can detach unchanged.
// A petal is built once per species, radiating along +X from the head origin,
// already cupped and lifted exactly as it sits on the bloom. An instance is then
// placed by rotating that canonical petal around Y to its ring slot. Because the
// free (floating) petal uses the same geometry and the same world transform it
// had while attached, detaching produces no shape/size/orientation pop.
// ---------------------------------------------------------------------------

function pushStrip(positions, colors, indices, c, build) {
  // build(s) -> { x, y, z, hw, sideX, sideZ, fold } centreline samples. Each
  // sample has left, raised-centre, and right vertices: a shallow midrib fold
  // gives the petal two softly lit faces instead of one obvious flat card.
  const samples = build();
  const base = positions.length / 3;

  for (const sample of samples) {
    positions.push(
      sample.x - sample.sideX * sample.hw,
      sample.y,
      sample.z - sample.sideZ * sample.hw,
      sample.x,
      sample.y + sample.fold,
      sample.z,
      sample.x + sample.sideX * sample.hw,
      sample.y,
      sample.z + sample.sideZ * sample.hw,
    );
    colors.push(c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b);
  }

  for (let s = 1; s < samples.length; s += 1) {
    const previousLeft = base + (s - 1) * 3;
    const previousCenter = previousLeft + 1;
    const previousRight = previousLeft + 2;
    const currentLeft = base + s * 3;
    const currentCenter = currentLeft + 1;
    const currentRight = currentLeft + 2;
    indices.push(
      previousLeft, currentLeft, currentCenter,
      previousLeft, currentCenter, previousCenter,
      previousCenter, currentCenter, currentRight,
      previousCenter, currentRight, previousRight,
    );
  }
}

// One petal geometry, radiating along +X, baked white (tinted per instance).
function makePetalGeometry(form) {
  const { tip = 0.5, wide = 0.2, lift = 0.12, cup = 0.3, shape = 'round' } = form;
  const positions = [];
  const colors = [];
  const indices = [];
  const c = new THREE.Color(1, 1, 1);

  const profile = (t) => {
    const e = Math.sin(Math.PI * t);
    switch (shape) {
      case 'point': return Math.pow(Math.sin(Math.PI * t), 1.6) * (1 - t * 0.55);
      case 'spoon': return 0.35 * e + 0.65 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 2.2);
      case 'notch': return Math.pow(e, 0.7);
      default: return Math.pow(e, 0.62);
    }
  };

  const SEG = 6;
  const inner = 0.08;
  pushStrip(positions, colors, indices, c, () => {
    const out = [];
    for (let s = 0; s <= SEG; s += 1) {
      const t = s / SEG;
      let along = inner + (tip - inner) * t;
      if (shape === 'notch' && t > 0.8) along -= (t - 0.8) * tip * 0.5;
      out.push({
        x: along,
        y: lift + cup * tip * (t * t),
        z: 0,
        hw: wide * profile(t),
        fold: wide * profile(t) * Math.sin(Math.PI * t) * 0.16,
        sideX: 0,
        sideZ: 1,
      });
    }
    return out;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// Stem + centre disc as one geometry (rooted; never floats). Stem/disc keep
// their own baked colours; the per-instance tint barely moves the dark disc.
function makeBaseGeometry(form) {
  const {
    disc = 0.16,
    discColor = 0xffcf4d,
    discLift = 0.04,
    rings = 1,
    tierHeight = 0,
  } = form;
  const positions = [];
  const colors = [];
  const parts = [];
  const indices = [];
  const pushTri = (ax, ay, az, bx, by, bz, cx, cy, cz, col, part = 0) => {
    const base = positions.length / 3;
    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    for (let k = 0; k < 3; k += 1) colors.push(col.r, col.g, col.b);
    parts.push(part, part, part);
    indices.push(base, base + 1, base + 2);
  };

  const stemColor = new THREE.Color(0x78b84a);
  const sh = 0.03;
  const stemTop = HEAD_Y + tierHeight * (rings - 1);
  pushTri(-sh, 0, 0, sh, 0, 0, 0, stemTop, 0, stemColor);
  pushTri(0, 0, -sh, 0, 0, sh, 0, stemTop, 0, stemColor);

  // A smooth, gently domed centre instead of a flat fan: a high segment count
  // kills the faceted-polygon silhouette, and concentric rings round the profile
  // so the disc reads as a soft mound that catches light, not a flat card.
  const discSeg = 28;
  const discRings = 3;
  const domeH = 0.04;          // apex height above the rim
  const cc = new THREE.Color(discColor);
  const discY = stemTop + discLift;
  // Ring radius/height follow a hemispherical-ish profile (sin radius, cos height).
  const ringPoint = (ring, i) => {
    const t = ring / discRings;                 // 0 at apex … 1 at rim
    const r = Math.sin((t * Math.PI) / 2) * disc;
    const y = discY + Math.cos((t * Math.PI) / 2) * domeH;
    const a = (i / discSeg) * Math.PI * 2;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  };
  for (let ring = 0; ring < discRings; ring += 1) {
    for (let i = 0; i < discSeg; i += 1) {
      if (ring === 0) {
        // Apex cap: fan from the centre point to the first ring.
        const [bx, by, bz] = ringPoint(1, i);
        const [cx, cy, cz] = ringPoint(1, i + 1);
        pushTri(0, discY + domeH, 0, bx, by, bz, cx, cy, cz, cc, 1);
      } else {
        // Quad band between two rings, split into two triangles.
        const [ax, ay, az] = ringPoint(ring, i);
        const [bx, by, bz] = ringPoint(ring, i + 1);
        const [dx, dy, dz] = ringPoint(ring + 1, i);
        const [ex, ey, ez] = ringPoint(ring + 1, i + 1);
        pushTri(ax, ay, az, dx, dy, dz, ex, ey, ez, cc, 1);
        pushTri(ax, ay, az, ex, ey, ez, bx, by, bz, cc, 1);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('basePart', new THREE.Float32BufferAttribute(parts, 1));
  geometry.computeVertexNormals();
  return geometry;
}

function makeDetachedCenterGeometry(form) {
  const { disc = 0.16, discColor = 0xffcf4d } = form;
  const positions = [];
  const colors = [];
  const indices = [];
  const centerColor = new THREE.Color(discColor);
  // Mirror makeBaseGeometry's domed centre so a detached centre keeps the same
  // smooth, rounded look it had while attached.
  const segments = 28;
  const rings = 3;
  const domeH = 0.04;
  const pushTri = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    const base = positions.length / 3;
    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    for (let vertex = 0; vertex < 3; vertex += 1) {
      colors.push(centerColor.r, centerColor.g, centerColor.b);
    }
    indices.push(base, base + 1, base + 2);
  };
  const ringPoint = (ring, i) => {
    const t = ring / rings;
    const r = Math.sin((t * Math.PI) / 2) * disc;
    const y = Math.cos((t * Math.PI) / 2) * domeH;
    const a = (i / segments) * Math.PI * 2;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  };
  for (let ring = 0; ring < rings; ring += 1) {
    for (let i = 0; i < segments; i += 1) {
      if (ring === 0) {
        const [bx, by, bz] = ringPoint(1, i);
        const [cx, cy, cz] = ringPoint(1, i + 1);
        pushTri(0, domeH, 0, bx, by, bz, cx, cy, cz);
      } else {
        const [ax, ay, az] = ringPoint(ring, i);
        const [bx, by, bz] = ringPoint(ring, i + 1);
        const [dx, dy, dz] = ringPoint(ring + 1, i);
        const [ex, ey, ez] = ringPoint(ring + 1, i + 1);
        pushTri(ax, ay, az, dx, dy, dz, ex, ey, ez);
        pushTri(ax, ay, az, ex, ey, ez, bx, by, bz);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------------------

export function createFlowerPatch({
  maxFlowers = 400,
  yOffset = 0,
  seed = 7,
  canGrow = null,
  tiltScale = null,
  lifespan = [7, 14],
  dapple = null,
  wind = {},
} = {}) {
  const [LIFE_MIN, LIFE_MAX] = lifespan;
  const {
    windDirection = new THREE.Vector2(0.58, 0.82).normalize(),
    windScale = 1,
    windSpeed = 1.55,
    windTurbulence = 0.3,
  } = wind;

  let randSeed = seed;
  const rand = () => {
    randSeed = (randSeed * 1664525 + 1013904223) >>> 0;
    return randSeed / 4294967296;
  };

  const tmpColor = new THREE.Color();
  const deadPetalColor = new THREE.Color('#c8c5bd');
  const deadStemColor = new THREE.Color('#7f8468');
  const zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);
  const WIND = windDirection.clone().normalize();

  // --- GPU head sway --------------------------------------------------------
  // Wind is evaluated once per vertex on the GPU. Petals rebuild their complete
  // head hierarchy there; bases keep the simpler height-weighted bend.
  const windTimeUniform = uniform(0);          // = windClock, pushed each frame
  const u_windSpeed = uniform(windSpeed);
  const u_windScale = uniform(windScale);
  const u_windTurb = uniform(windTurbulence);
  const u_windX = uniform(WIND.x);
  const u_windZ = uniform(WIND.y);

  const rotateX = (position, angle) => {
    const c = cos(angle);
    const s = sin(angle);
    return vec3(
      position.x,
      position.y.mul(c).sub(position.z.mul(s)),
      position.y.mul(s).add(position.z.mul(c)),
    );
  };
  const rotateY = (position, angle) => {
    const c = cos(angle);
    const s = sin(angle);
    return vec3(
      position.x.mul(c).add(position.z.mul(s)),
      position.y,
      position.z.mul(c).sub(position.x.mul(s)),
    );
  };
  const rotateZ = (position, angle) => {
    const c = cos(angle);
    const s = sin(angle);
    return vec3(
      position.x.mul(c).sub(position.y.mul(s)),
      position.x.mul(s).add(position.y.mul(c)),
      position.z,
    );
  };
  const rotateEulerXYZ = (position, x, y, z) => {
    // THREE.Euler('XYZ') produces Rx * Ry * Rz for column vectors, so Z is
    // applied first. Keeping this identical to Object3D.updateMatrix() is vital:
    // attached petals use this shader path, while detached petals use CPU TRS.
    return rotateX(rotateY(rotateZ(position, z), y), x);
  };

  // Return both world-axis and flower-local bend angles. The local pair matches
  // the old CPU Euler additions exactly: x += localWindZ, z -= localWindX.
  const makeWindRotation = (responseNode) => {
    const swayData = attribute('swayData', 'vec4');
    const rootX = swayData.x;
    const rootZ = swayData.y;
    const windPhaseAttr = swayData.z;
    const response = responseNode;

    const t = windTimeUniform.mul(u_windSpeed);
    const phase = rootX.mul(u_windX).add(rootZ.mul(u_windZ));
    const crossPhase = rootX.mul(u_windZ).negate().add(rootZ.mul(u_windX));

    const windWave = sin(t.mul(0.82).add(phase.mul(0.72)))
      .add(sin(t.mul(1.47).add(phase.mul(1.18)).add(1.9)).mul(0.55))
      .add(sin(t.mul(2.65).add(phase.mul(0.35)).add(windPhaseAttr.mul(0.8))).mul(0.35));
    const windBend = response.mul(windWave).mul(0.055).mul(u_windScale).div(HEAD_Y);

    const crossWave = sin(t.mul(0.53).add(crossPhase.mul(0.86)).add(0.7))
      .add(sin(t.mul(1.21).sub(phase.mul(0.41)).add(windPhaseAttr)).mul(0.45));
    const crossBend = response.mul(crossWave).mul(0.055)
      .mul(u_windScale).mul(u_windTurb).div(HEAD_Y);

    const worldWindX = u_windX.mul(windBend).sub(u_windZ.mul(crossBend));
    const worldWindZ = u_windZ.mul(windBend).add(u_windX.mul(crossBend));

    const c = cos(swayData.w);
    const s = sin(swayData.w);
    const localWindX = worldWindX.mul(c).add(worldWindZ.mul(s));
    const localWindZ = worldWindZ.mul(c).sub(worldWindX.mul(s));

    return vec4(worldWindX, worldWindZ, localWindX, localWindZ);
  };

  // Reusable transform scratch.
  const petalObj = new THREE.Object3D();   // a petal as child of the head
  const worldMat = new THREE.Matrix4();
  const qScratch = new THREE.Quaternion();
  const pScratch = new THREE.Vector3();
  const sScratch = new THREE.Vector3();
  const eScratch = new THREE.Euler();

  // Per-species base pool. It was sized as maxFlowers/SPECIES.length — i.e. the
  // average share assuming flowers spread evenly across all species. But familyAt
  // maps each 2.4-unit cell to ONE family and the stage picks one species within
  // it, so hovering an area concentrates demand on a handful of species. Those
  // few hit the even-share cap (~79) almost immediately and then refuse to plant
  // — the patch goes permanently dead under the cursor while most species sit
  // empty. Give each species enough headroom to absorb a heavy LOCAL share
  // (several times the even share) so a worked area keeps filling. Total instance
  // memory is still bounded — sparse species never allocate their bases.
  const PER_SPECIES_SHARE = 4;
  const perBase = Math.max(
    48,
    Math.ceil((maxFlowers / SPECIES.length) * PER_SPECIES_SHARE),
  );

  // One shared dapple gobo for every flower material — it's a pure function of
  // world position + time, so the same drifting light pools that fall on the moss
  // and ground also play across the blooms, grounding them in the scene.
  const dappleNode = dapple ? createDappleNode(dapple) : null;

  const forms = SPECIES.map((species) => {
    const petalGeo = makePetalGeometry(species.form);
    const baseGeo = makeBaseGeometry(species.form);
    const centerGeo = makeDetachedCenterGeometry(species.form);

    const makeMesh = (geo, count, tintArr, isPetal = false, animateDisc = false) => {
      const material = new (isPetal
        ? THREE.MeshPhysicalNodeMaterial
        : THREE.MeshStandardNodeMaterial)({
        color: 0xffffff,
        vertexColors: true,
        side: THREE.DoubleSide,
        metalness: 0,
        roughness: isPetal ? 0.68 : 0.82,
        ...(isPetal ? {
          ior: 1.34,
          specularIntensity: 0.32,
          sheen: 0.42,
          sheenColor: 0xffffff,
          sheenRoughness: 0.78,
          clearcoat: 0.06,
          clearcoatRoughness: 0.88,
        } : {}),
      });
      // flowerTint is vec4: rgb tint + .w = per-instance sway response (folded
      // here to stay under WebGPU's 8 vertex-buffer limit). tintArr is sized
      // count*4; sway response lives at index*4+3.
      const attr = new THREE.InstancedBufferAttribute(tintArr, 4);
      geo.setAttribute('flowerTint', attr);
      const tintNode = instancedBufferAttribute(attr);
      const tinted = mul(vertexColor(), tintNode.xyz);
      let petalTint = tinted;
      if (isPetal) {
        const tip = species.form.tip || 0.5;
        const wide = species.form.wide || 0.2;
        const along = positionLocal.x.sub(0.08).div(Math.max(0.01, tip - 0.08)).clamp(0, 1);
        const fromMidrib = abs(positionLocal.z).div(Math.max(0.01, wide));
        const midrib = smoothstep(0.08, 0.5, fromMidrib);
        const baseFade = smoothstep(0.02, 0.32, along);
        const edgeTissue = smoothstep(0.46, 0.92, fromMidrib);
        const tissueLight = mix(0.8, 1.07, baseFade)
          .mul(mix(0.9, 1, midrib))
          .mul(mix(1, 1.045, edgeTissue));
        petalTint = vibrance(tinted, 0.22).mul(tissueLight).mul(1.06);
      }
      // Fold the dapple into the base colour so blooms dim/warm with the same
      // light pools as the moss instead of reading as flatly-lit decals on top.
      const shadedTint = dappleNode ? mul(petalTint, dappleNode) : petalTint;
      material.colorNode = shadedTint;
      // Petals should respond to light rather than carrying a broad self-lit
      // wash. A tiny emissive floor preserves saturated colour in deep shade.
      material.emissiveNode = mul(petalTint, isPetal ? 0.085 : 0.14);
      // Per-instance sway inputs: vec4 (rootX, rootZ, windPhase, rotation).
      // response rides in flowerTint.w. Written once at placement; response is
      // zeroed on detach so the free-flight CPU matrix is authoritative.
      const swayData = new Float32Array(count * 4);
      const swayDataAttr = new THREE.InstancedBufferAttribute(swayData, 4);
      geo.setAttribute('swayData', swayDataAttr);

      let pose = null;
      if (isPetal) {
        const poseA = new Float32Array(count * 4);
        const poseB = new Float32Array(count * 4);
        const poseAAttr = new THREE.InstancedBufferAttribute(poseA, 4);
        const poseBAttr = new THREE.InstancedBufferAttribute(poseB, 4);
        geo.setAttribute('petalPoseA', poseAAttr);
        geo.setAttribute('petalPoseB', poseBAttr);
        pose = { a: poseA, b: poseB, aAttr: poseAAttr, bAttr: poseBAttr };
      }

      let discGrowth = null;
      let discGrowthAttr = null;
      if (isPetal) {
        const poseA = instancedBufferAttribute(pose.aAttr);
        const poseB = instancedBufferAttribute(pose.bAttr);
        const packedTiltX = floor(poseB.w.div(4096));
        const packedTiltZ = poseB.w.sub(packedTiltX.mul(4096));
        const tiltX = packedTiltX.div(4095).mul(2).sub(1);
        const tiltZ = packedTiltZ.div(4095).mul(2).sub(1);
        const windRotation = makeWindRotation(tintNode.w);

        const posedPosition = rotateEulerXYZ(
          positionLocal.mul(poseB.xyz),
          poseA.x,
          poseA.y,
          poseA.z,
        ).add(vec3(0, poseA.w, 0));
        const attachedPosition = rotateEulerXYZ(
          posedPosition,
          tiltX.add(windRotation.w),
          attribute('swayData', 'vec4').w,
          tiltZ.sub(windRotation.z),
        );
        material.positionNode = tintNode.w.greaterThan(0).select(attachedPosition, positionLocal);

        // Non-uniform petal scale requires inverse scale for its normal before
        // applying the same petal/head rotations as the vertex position.
        const posedNormal = rotateEulerXYZ(
          normalLocal.div(poseB.xyz),
          poseA.x,
          poseA.y,
          poseA.z,
        );
        const attachedNormal = rotateEulerXYZ(
          posedNormal,
          tiltX.add(windRotation.w),
          attribute('swayData', 'vec4').w,
          tiltZ.sub(windRotation.z),
        );
        const attachedNormalView = transformNormalToView(attachedNormal).normalize();
        material.normalNode = tintNode.w.greaterThan(0).select(attachedNormalView, normalView);
      } else if (animateDisc) {
        // vec4 = disc radial growth, uniform head scale, rest tilt X, rest tilt Z.
        // Widening this existing buffer keeps the geometry within WebGPU's
        // vertex-buffer limit while letting bases use the exact petal head frame.
        discGrowth = new Float32Array(count * 4);
        discGrowthAttr = new THREE.InstancedBufferAttribute(discGrowth, 4);
        geo.setAttribute('discGrowth', discGrowthAttr);
        const baseData = instancedBufferAttribute(discGrowthAttr);
        const part = attribute('basePart', 'float');
        const radialScale = mix(1, baseData.x, part);
        // Y is left unscaled: the disc sits at an absolute head height, so
        // scaling its Y would slide it down the stem instead of resizing it.
        // The shallow dome (domeH) reads fine; radial scale carries the size.
        const windRotation = makeWindRotation(tintNode.w);
        const rotation = attribute('swayData', 'vec4').w;
        const grown = vec3(
          positionLocal.x.mul(radialScale),
          positionLocal.y,
          positionLocal.z.mul(radialScale),
        ).mul(baseData.y);
        material.positionNode = rotateEulerXYZ(
          grown,
          baseData.z.add(windRotation.w),
          rotation,
          baseData.w.sub(windRotation.z),
        );

        const grownNormal = normalLocal.div(vec3(radialScale, 1, radialScale));
        const swayedNormal = rotateEulerXYZ(
          grownNormal,
          baseData.z.add(windRotation.w),
          rotation,
          baseData.w.sub(windRotation.z),
        );
        material.normalNode = transformNormalToView(swayedNormal).normalize();
      }
      const mesh = new THREE.InstancedMesh(geo, material, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < count; i += 1) mesh.setMatrixAt(i, zeroMat);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.count = count;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      // sway shares the tint buffer for `response` (flowerTint.w), so detach's
      // response-zeroing and tint writes both go through `attr`/`tintArr`.
      const sway = { data: swayData, dataAttr: swayDataAttr, tintArr, tintAttr: attr };
      return { mesh, attr, tintArr, discGrowth, discGrowthAttr, sway, pose };
    };

    // Headroom: detached petals linger in the pool while they drift, so allow
    // ~1.8× a full field of attached petals before placement is refused.
    const petalCap = Math.ceil(perBase * species.form.petals * (species.form.rings || 1) * 1.8);
    const petalTint = new Float32Array(petalCap * 4);
    const baseTint = new Float32Array(perBase * 4);
    const petal = makeMesh(petalGeo, petalCap, petalTint, true);
    const base = makeMesh(baseGeo, perBase, baseTint, false, true);
    const centerCap = perBase * 2;
    const centerMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: false,
      side: THREE.DoubleSide,
      metalness: 0,
      roughness: 0.86,
    });
    const centerMesh = new THREE.InstancedMesh(centerGeo, centerMaterial, centerCap);
    for (let i = 0; i < centerCap; i += 1) centerMesh.setMatrixAt(i, zeroMat);
    centerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    centerMesh.count = centerCap;
    centerMesh.castShadow = true;
    centerMesh.receiveShadow = true;
    centerMesh.frustumCulled = false;

    return {
      species,
      petalCap,
      petalMesh: petal.mesh, petalAttr: petal.attr, petalTint: petalTint,
      baseMesh: base.mesh, baseAttr: base.attr, baseTint: baseTint,
      centerMesh, centerCap,
      discGrowth: base.discGrowth, discGrowthAttr: base.discGrowthAttr,
      petalSway: petal.sway, baseSway: base.sway,
      petalPose: petal.pose,
      petals: [],  // live petal records (attached or free)
      bases: [],   // live base records (one per living flower head)
      centers: [], // detached flower centres in free flight
    };
  });

  const group = new THREE.Group();
  for (const f of forms) group.add(f.petalMesh, f.baseMesh, f.centerMesh);

  const CROWN_RADIUS = 0.5;
  const flowers = [];

  // Spatial hash for the placement collision test. place() used to scan the whole
  // `flowers` array on every attempt — and scatter makes several attempts per
  // pointermove — so over a populated field a single mouse move that planted
  // nothing still paid an O(flowers) scan many times over. That was the "lag with
  // no flower on blank moss" stall. Cell ≥ the largest possible collision
  // distance (~1.26 world units), so a query only inspects the 3×3 neighbourhood.
  const COLLISION_CELL = 1.5;
  const collisionGrid = new Map();
  const collisionKey = (x, z) => `${Math.floor(x / COLLISION_CELL)},${Math.floor(z / COLLISION_CELL)}`;
  function collisionInsert(flower) {
    const key = collisionKey(flower.x, flower.z);
    let bucket = collisionGrid.get(key);
    if (!bucket) { bucket = []; collisionGrid.set(key, bucket); }
    flower.collisionKey = key;
    bucket.push(flower);
  }
  function collisionRemove(flower) {
    const bucket = collisionGrid.get(flower.collisionKey);
    if (!bucket) return;
    const idx = bucket.indexOf(flower);
    if (idx !== -1) {
      const last = bucket.length - 1;
      if (idx !== last) bucket[idx] = bucket[last];
      bucket.pop();
    }
    if (bucket.length === 0) collisionGrid.delete(flower.collisionKey);
  }
  // Is any existing flower within (radius + its radius) * pack of (x, z)?
  function collisionBlocked(x, z, radius, pack) {
    const cx = Math.floor(x / COLLISION_CELL);
    const cz = Math.floor(z / COLLISION_CELL);
    for (let gx = cx - 1; gx <= cx + 1; gx += 1) {
      for (let gz = cz - 1; gz <= cz + 1; gz += 1) {
        const bucket = collisionGrid.get(`${gx},${gz}`);
        if (!bucket) continue;
        for (const o of bucket) {
          const dx = o.x - x, dz = o.z - z;
          const minDist = (radius + o.radius) * pack;
          if (dx * dx + dz * dz < minDist * minDist) return true;
        }
      }
    }
    return false;
  }

  function findFamilyParent(x, z, family, maxDistance) {
    const cellRadius = Math.ceil(maxDistance / COLLISION_CELL);
    const cx = Math.floor(x / COLLISION_CELL);
    const cz = Math.floor(z / COLLISION_CELL);
    const maxDistanceSq = maxDistance * maxDistance;
    let parent = null;
    let parentDistanceSq = maxDistanceSq;

    for (let gx = cx - cellRadius; gx <= cx + cellRadius; gx += 1) {
      for (let gz = cz - cellRadius; gz <= cz + cellRadius; gz += 1) {
        const bucket = collisionGrid.get(`${gx},${gz}`);
        if (!bucket) continue;
        for (const flower of bucket) {
          if (flower.dying || flower.family !== family) continue;
          const dx = flower.x - x;
          const dz = flower.z - z;
          const distanceSq = dx * dx + dz * dz;
          if (distanceSq < parentDistanceSq) {
            parent = flower;
            parentDistanceSq = distanceSq;
          }
        }
      }
    }
    return parent;
  }

  // --- writers --------------------------------------------------------------

  // flowerTint is vec4 (stride 4): rgb tint + .w = sway response. writeTint only
  // touches rgb; response is written by writeSway into the same buffer.
  function writeTint(arr, attr, slot, r, g, b) {
    const j = slot * 4;
    arr[j] = r; arr[j + 1] = g; arr[j + 2] = b;
  }

  function writePetalTint(form, petal) {
    const whiteness = petal.free ? petal.deathWhiteness : 0;
    writeTint(
      form.petalTint,
      form.petalAttr,
      petal.slot,
      THREE.MathUtils.lerp(petal.r, deadPetalColor.r, whiteness),
      THREE.MathUtils.lerp(petal.g, deadPetalColor.g, whiteness),
      THREE.MathUtils.lerp(petal.b, deadPetalColor.b, whiteness),
    );
  }

  function writeBaseTint(form, b) {
    const death = b.deathProgress || 0;
    writeTint(
      form.baseTint,
      form.baseAttr,
      b.slot,
      THREE.MathUtils.lerp(b.flower.r, deadStemColor.r, death),
      THREE.MathUtils.lerp(b.flower.g, deadStemColor.g, death),
      THREE.MathUtils.lerp(b.flower.b, deadStemColor.b, death),
    );
  }

  // Write a slot's GPU-sway inputs. swayData vec4 = (rootX, rootZ, phase, rot);
  // response rides in the tint buffer's .w. `response` is passed explicitly so
  // detach can zero it (freezing GPU sway for free petals).
  function writeSway(sway, slot, flower, response) {
    const j = slot * 4;
    sway.data[j] = flower.x;
    sway.data[j + 1] = flower.z;
    sway.data[j + 2] = flower.windPhase;
    sway.data[j + 3] = flower.rotation;
    sway.tintArr[slot * 4 + 3] = response;
  }

  function markSwayDirty(sway) {
    sway.dataAttr.needsUpdate = true;
    sway.tintAttr.needsUpdate = true;
  }

  function packTilts(tiltX, tiltZ) {
    const x = Math.round(THREE.MathUtils.clamp(tiltX * 0.5 + 0.5, 0, 1) * 4095);
    const z = Math.round(THREE.MathUtils.clamp(tiltZ * 0.5 + 0.5, 0, 1) * 4095);
    return x * 4096 + z;
  }

  function flowerGrowth(flower) {
    const stageProgress = flower.stage / (STAGE_STYLE.length - 1);
    const burstTarget = THREE.MathUtils.lerp(0.98, 0.91, stageProgress);
    if (flower.age < flower.growthBurstDuration) {
      const progress = flower.age / flower.growthBurstDuration;
      const burst = 1 - Math.pow(1 - progress, 3);
      return THREE.MathUtils.lerp(0.12, burstTarget, burst);
    }

    const progress = THREE.MathUtils.clamp(
      (flower.age - flower.growthBurstDuration) / flower.growthSettleDuration,
      0,
      1,
    );
    const settle = progress * progress * (3 - 2 * progress);
    return THREE.MathUtils.lerp(burstTarget, 1, settle);
  }

  function flowerOpening(flower) {
    const stageProgress = flower.stage / (STAGE_STYLE.length - 1);
    const initialOpening = THREE.MathUtils.lerp(0.36, 0.08, stageProgress);
    const burstOpening = THREE.MathUtils.lerp(0.54, 0.3, stageProgress);

    if (flower.age < flower.growthBurstDuration) {
      const progress = flower.age / flower.growthBurstDuration;
      const burst = 1 - Math.pow(1 - progress, 3);
      return THREE.MathUtils.lerp(initialOpening, burstOpening, burst);
    }

    const progress = THREE.MathUtils.clamp(
      (flower.age - flower.growthBurstDuration) / flower.growthSettleDuration,
      0,
      1,
    );
    const opening = progress * progress * (3 - 2 * progress);
    return THREE.MathUtils.lerp(burstOpening, 1, opening);
  }

  // Attached petal: world = headMatrix · rotateY(petalAngle). Same transform the
  // baked head used, so detaching is seamless.
  function writeAttachedPetal(form, petal) {
    const flower = petal.flower;
    const opening = flowerOpening(flower);
    const unfurlProgress = THREE.MathUtils.clamp(
      (opening - petal.unfurlDelay) / (1 - petal.unfurlDelay),
      0,
      1,
    );
    const unfurl = unfurlProgress * unfurlProgress * (3 - 2 * unfurlProgress);
    // Before release, ease partway back toward the species' closed posture.
    // Keeping this partial preserves the readable flower shape while making the
    // final petal departure feel like the end of a living cycle.
    const wiltedOpening = unfurl * (1 - flower.wilt * 0.68);
    const petalGrowth = flowerGrowth(flower);
    const headScale = flower.scale * petalGrowth;
    const {
      closed = 1.05,
      open = 0,
      ringLift = 0,
      tierHeight = 0,
      tierScale = 1,
    } = form.species.form;
    const posture = THREE.MathUtils.lerp(closed, open + petal.ring * ringLift, wiltedOpening)
      + petal.postureOffset;
    // Lift to the head height here (not baked into the geometry) so the petal's
    // own origin stays at its base — it then tumbles about its base when free,
    // not about the distant flower root.
    petalObj.position.set(0, HEAD_Y + petal.ring * tierHeight + petal.heightOffset, 0);
    // rotateY sends +X→(cos,-sin) so negate to match make\* placement (cos,+sin)
    petalObj.rotation.set(petal.pitch, -petal.angle, posture + petal.roll);
    const ringScale = Math.pow(tierScale, petal.ring);
    const lengthScale = THREE.MathUtils.lerp(0.55, 1, unfurl);
    const widthScale = THREE.MathUtils.lerp(0.28, 1, unfurl);
    const liftScale = THREE.MathUtils.lerp(0.65, 1, unfurl);
    const wiltLength = THREE.MathUtils.lerp(1, 0.78, flower.wilt);
    const wiltWidth = THREE.MathUtils.lerp(1, 0.72, flower.wilt);
    const wiltThickness = THREE.MathUtils.lerp(1, 0.86, flower.wilt);
    petalObj.scale.set(
      petal.sizeVariation * petal.lengthVariation * ringScale * lengthScale * wiltLength,
      petal.sizeVariation * ringScale * liftScale * wiltThickness,
      petal.sizeVariation * petal.widthVariation * ringScale * widthScale * wiltWidth,
    );
    petalObj.updateMatrix();

    const poseIndex = petal.slot * 4;
    const tiltX = Math.cos(flower.tiltDir) * flower.tilt;
    const tiltZ = Math.sin(flower.tiltDir) * flower.tilt;
    form.petalPose.a[poseIndex] = petal.pitch;
    form.petalPose.a[poseIndex + 1] = -petal.angle;
    form.petalPose.a[poseIndex + 2] = posture + petal.roll;
    form.petalPose.a[poseIndex + 3] = petalObj.position.y * headScale;
    form.petalPose.b[poseIndex] = petalObj.scale.x * headScale;
    form.petalPose.b[poseIndex + 1] = petalObj.scale.y * headScale;
    form.petalPose.b[poseIndex + 2] = petalObj.scale.z * headScale;
    form.petalPose.b[poseIndex + 3] = packTilts(tiltX, tiltZ);

    // The shader owns the complete attached hierarchy. The instance matrix only
    // supplies the flower root translation, avoiding any inverse world transform.
    worldMat.makeTranslation(flower.x, yOffset + flower.y, flower.z);
    form.petalMesh.setMatrixAt(petal.slot, worldMat);
  }

  // Free petal: integrate its own world position/orientation.
  function writeFreePetal(form, petal) {
    eScratch.set(petal.rx, petal.ry, petal.rz);
    qScratch.setFromEuler(eScratch);
    pScratch.set(petal.x, petal.y, petal.z);
    sScratch.set(
      petal.scaleX * petal.fade,
      petal.scaleY * petal.fade,
      petal.scaleZ * petal.fade,
    );
    worldMat.compose(pScratch, qScratch, sScratch);
    form.petalMesh.setMatrixAt(petal.slot, worldMat);
  }

  function writeBase(form, b) {
    const flower = b.flower;
    const growth = flowerGrowth(flower);
    const j = b.slot * 4;
    // The centre disc draws down with the petals as the flower wilts so it
    // doesn't sit full-size while the bloom shrinks around it. This rides the
    // disc-only radial channel (basePart == 1) — NOT the j+1 head scale, which
    // also drives the stem and would otherwise pull the whole head downward.
    const wiltDisc = THREE.MathUtils.lerp(1, 0.4, flower.wilt);
    form.discGrowth[j] = THREE.MathUtils.lerp(0.18, 1, flowerOpening(flower)) * b.discFade * wiltDisc;
    form.discGrowth[j + 1] = flower.scale * growth * b.fade;
    const droop = (b.deathProgress || 0) * 0.42;
    form.discGrowth[j + 2] = Math.cos(flower.tiltDir) * (flower.tilt + droop);
    form.discGrowth[j + 3] = Math.sin(flower.tiltDir) * (flower.tilt + droop);
    worldMat.makeTranslation(flower.x, yOffset + flower.y, flower.z);
    form.baseMesh.setMatrixAt(b.slot, worldMat);
  }

  // --- petal slot management (per form) ------------------------------------

  function addPetal(form, petal) {
    petal.slot = form.petals.length;
    form.petals.push(petal);
    writePetalTint(form, petal);
    // Attached petal: full GPU sway. (Detach zeroes response on this slot.)
    writeSway(form.petalSway, petal.slot, petal.flower, petal.flower.windResponse);
  }

  function removePetal(form, index) {
    const last = form.petals.length - 1;
    if (index !== last) {
      const moved = form.petals[last];
      moved.slot = index;
      form.petals[index] = moved;
      // rewrite moved into its new slot (matrix + tint + sway)
      if (moved.free) writeFreePetal(form, moved); else writeAttachedPetal(form, moved);
      writePetalTint(form, moved);
      writeSway(form.petalSway, index, moved.flower, moved.free ? 0 : moved.flower.windResponse);
    }
    form.petals.pop();
    form.petalMesh.setMatrixAt(last, zeroMat);
    // Compaction changes every GPU input associated with the destination slot,
    // not just its matrix. Without uploading swayData, an attached petal moved
    // into a freed slot bends around the previous occupant's root/rotation.
    form.dirty = true;
    markSwayDirty(form.petalSway);
  }

  function removeBase(form, index) {
    const last = form.bases.length - 1;
    if (index !== last) {
      const moved = form.bases[last];
      moved.slot = index;
      form.bases[index] = moved;
      writeBaseTint(form, moved);
      writeBase(form, moved);
      writeSway(form.baseSway, index, moved.flower, moved.flower.windResponse);
    }
    form.bases.pop();
    form.baseMesh.setMatrixAt(last, zeroMat);
    form.dirty = true;
    markSwayDirty(form.baseSway);
  }

  // --- placement ------------------------------------------------------------

  function makeFlower(
    x,
    z,
    speciesIndex,
    growthScale = 1,
    growthStage = 0,
    family = -1,
    architecture = null,
  ) {
    const species = SPECIES[speciesIndex];
    const stage = THREE.MathUtils.clamp(Math.floor(growthStage), 0, STAGE_STYLE.length - 1);
    const stageStyle = STAGE_STYLE[stage];
    const tiltConstraint = tiltScale ? tiltScale(x, z) : 1;
    const localTiltScale = typeof tiltConstraint === 'number' ? tiltConstraint : tiltConstraint.scale;
    const randomTiltDir = architecture?.tiltDir ?? rand() * Math.PI * 2;
    let tiltDir = randomTiltDir;
    let localWindScale = 1;
    if (typeof tiltConstraint !== 'number') {
      const directionInfluence = tiltConstraint.directionInfluence || 0;
      const targetX = Math.cos(tiltConstraint.direction);
      const targetZ = Math.sin(tiltConstraint.direction);
      const randomX = Math.cos(randomTiltDir);
      const randomZ = Math.sin(randomTiltDir);
      tiltDir = Math.atan2(
        THREE.MathUtils.lerp(randomZ, targetZ, directionInfluence),
        THREE.MathUtils.lerp(randomX, targetX, directionInfluence),
      );
      localWindScale = tiltConstraint.windScale ?? 1;
    }
    tmpColor.set(species.palette[Math.floor(rand() * species.palette.length)]);
    tmpColor.offsetHSL(0, stageStyle.saturation, stageStyle.lightness);
    const scale = (
      species.size[0] + rand() * (species.size[1] - species.size[0])
    ) * stageStyle.scale * growthScale * (architecture?.scale ?? 1);
    return {
      x, z,
      y: (
        species.stem[0] + rand() * (species.stem[1] - species.stem[0])
      ) * stageStyle.stem * (architecture?.stemScale ?? 1),
      rotation: rand() * Math.PI * 2,
      scale,
      tilt: (architecture?.tilt ?? rand() * species.tilt) * localTiltScale,
      tiltDir,
      windPhase: rand() * Math.PI * 2,
      windResponse: (0.12 + rand() * 0.14) * localWindScale,
      bloom: 0.0001,
      bloomSpeed: species.bloom[0] + rand() * (species.bloom[1] - species.bloom[0]),
      growthBurstDuration: 0.2 + rand() * 0.1,
      growthSettleDuration: 1.5 + rand() * 0.7,
      age: 0,
      life: (LIFE_MIN + rand() * (LIFE_MAX - LIFE_MIN)) * stageStyle.life,
      wilt: 0,
      wiltDuration: 0.8 + rand() * 0.45,
      wilting: false,
      dying: false,
      stage,
      family,
      species: speciesIndex,
      radius: CROWN_RADIUS * scale,
      r: tmpColor.r, g: tmpColor.g, b: tmpColor.b,
      base: null,
      petalRecords: [],
    };
  }

  function place(
    x,
    z,
    speciesIndex,
    pack = 0.62,
    growthScale = 1,
    growthStage = 0,
    family = -1,
    options = null,
  ) {
    const form = forms[speciesIndex];
    const np = form.species.form.petals;
    const rings = form.species.form.rings || 1;
    const perRing = np;
    const totalPetals = np * rings;
    if (form.bases.length >= perBase) return false;
    if (form.petals.length + totalPetals > form.petalCap) return false;

    const flower = makeFlower(
      x, z, speciesIndex, growthScale, growthStage, family, options?.architecture,
    );
    // Boundary tests may use the actual generated crown radius. A root-only
    // check lets large blooms sit outside an obstacle while their petals overlap
    // it, especially after later growth stages increase flower scale.
    if (canGrow && !canGrow(x, z, flower.radius)) return false;
    if (!options?.skipCollision && collisionBlocked(x, z, flower.radius, pack)) return false;

    // base
    const baseRec = { flower, slot: -1, fade: 1, discFade: 1, deathProgress: 0 };
    baseRec.slot = form.bases.length;
    form.bases.push(baseRec);
    writeBaseTint(form, baseRec);
    writeSway(form.baseSway, baseRec.slot, flower, flower.windResponse);
    flower.base = baseRec;

    // petals — one record per (ring, i), angle matches makeFlowerForm placement
    for (let ring = 0; ring < rings; ring += 1) {
      const phase = ring * (form.species.form.tierTwist || Math.PI / (rings * perRing));
      for (let i = 0; i < perRing; i += 1) {
        const petalStep = Math.PI * 2 / perRing;
        const angle = i * petalStep + phase + (rand() - 0.5) * petalStep * 0.22;
        const postureSpread = form.species.form.postureSpread || 0.12;
        // Keep a bloom chromatically coherent, but avoid every cloned petal
        // carrying the exact same flat RGB. Inner tiers sit slightly deeper;
        // individual petals get restrained hue/saturation/value variation.
        tmpColor.setRGB(flower.r, flower.g, flower.b);
        const ringDepth = rings > 1 ? ring / (rings - 1) : 0;
        tmpColor.offsetHSL(
          (rand() - 0.5) * 0.018,
          (rand() - 0.5) * 0.07,
          (rand() - 0.5) * 0.08 - ringDepth * 0.035,
        );
        const petal = {
          flower, angle, ring, free: false, slot: -1,
          r: tmpColor.r, g: tmpColor.g, b: tmpColor.b,
          // Cheap, stable imperfections keep cloned geometry from reading as a
          // radial stamp. These are folded into the existing instance matrix.
          sizeVariation: 0.95 + rand() * 0.1,
          lengthVariation: 0.9 + rand() * 0.2,
          widthVariation: 0.88 + rand() * 0.24,
          unfurlDelay: rand() * 0.12,
          heightOffset: (rand() - 0.5) * 0.07,
          pitch: (rand() - 0.5) * 0.3,
          roll: (rand() - 0.5) * 0.26,
          postureOffset: (rand() - 0.5) * postureSpread,
          // free-state fields (unused until detach)
          x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
          rx: 0, ry: 0, rz: 0, dx: 0, dy: 0, dz: 0,
          flutter: rand() * Math.PI * 2, flutterRate: 1.8 + rand() * 1.6,
          scale: flower.scale,
          scaleX: flower.scale, scaleY: flower.scale, scaleZ: flower.scale,
          fade: 1, age: 0, life: 4 + rand() * 2.5,
        };
        addPetal(form, petal);
        writeAttachedPetal(form, petal);
        flower.petalRecords.push(petal);
      }
    }

    flowers.push(flower);
    collisionInsert(flower);
    form.petalAttr.needsUpdate = true;
    form.petalPose.aAttr.needsUpdate = true;
    form.petalPose.bAttr.needsUpdate = true;
    form.petalMesh.instanceMatrix.needsUpdate = true;
    form.baseAttr.needsUpdate = true;
    form.baseMesh.instanceMatrix.needsUpdate = true;
    markSwayDirty(form.petalSway);
    markSwayDirty(form.baseSway);
    return true;
  }

  function placeRootClump(
    x,
    z,
    speciesIndex,
    pack,
    growthScale,
    growthStage,
    family,
    groupLean = null,
  ) {
    const species = SPECIES[speciesIndex];
    const architecture = species.architecture;
    const requestedStemCount = architecture.stems[0]
      + Math.floor(rand() * (architecture.stems[1] - architecture.stems[0] + 1));
    const form = forms[speciesIndex];
    const petalsPerStem = species.form.petals * (species.form.rings || 1);
    const availableBases = perBase - form.bases.length;
    const availablePetalStems = Math.floor((form.petalCap - form.petals.length) / petalsPerStem);
    const stemCount = Math.min(requestedStemCount, availableBases, availablePetalStems);
    if (stemCount < 1) return false;

    const stageStyle = STAGE_STYLE[growthStage];
    const averageScale = (species.size[0] + species.size[1]) * 0.5
      * stageStyle.scale * growthScale;
    const clumpRadius = CROWN_RADIUS * averageScale + architecture.rootSpread;
    let rootX = x;
    let rootZ = z;
    let foundRoot = false;
    for (let probe = 0; probe < 4; probe += 1) {
      if (probe > 0) {
        const probeAngle = rand() * Math.PI * 2;
        const probeDistance = architecture.rootSpread * (1.2 + probe * 0.7);
        rootX = x + Math.cos(probeAngle) * probeDistance;
        rootZ = z + Math.sin(probeAngle) * probeDistance;
      }
      if (canGrow && !canGrow(rootX, rootZ, clumpRadius)) continue;
      // A root clump is several narrow crowns fanning from one point, not one
      // solid disc, so use a looser external spacing test than a radial bloom.
      if (collisionBlocked(rootX, rootZ, clumpRadius, pack * 0.68)) continue;
      foundRoot = true;
      break;
    }
    if (!foundRoot) return false;

    const clumpRotation = rand() * Math.PI * 2;
    let planted = false;
    for (let stem = 0; stem < stemCount; stem += 1) {
      const fraction = stem / stemCount;
      const radialAngle = clumpRotation + fraction * Math.PI * 2 + (rand() - 0.5) * 0.48;
      const angle = groupLean === null
        ? radialAngle
        : Math.atan2(
          Math.sin(radialAngle) * 0.48 + Math.sin(groupLean) * 0.52,
          Math.cos(radialAngle) * 0.48 + Math.cos(groupLean) * 0.52,
        );
      const rootDistance = stem === 0 ? 0 : architecture.rootSpread * (0.35 + rand() * 0.65);
      const sx = rootX + Math.cos(angle) * rootDistance;
      const sz = rootZ + Math.sin(angle) * rootDistance;
      const outwardTilt = architecture.tilt[0]
        + rand() * (architecture.tilt[1] - architecture.tilt[0]);
      const didPlace = place(
        sx,
        sz,
        speciesIndex,
        pack,
        growthScale,
        growthStage,
        family,
        {
          skipCollision: true,
          architecture: {
            tiltDir: angle,
            tilt: outwardTilt,
            scale: architecture.scale[0]
              + rand() * (architecture.scale[1] - architecture.scale[0]),
            stemScale: architecture.stemScale[0]
              + rand() * (architecture.stemScale[1] - architecture.stemScale[0]),
          },
        },
      );
      planted = planted || didPlace;
    }
    return planted;
  }

  function placePlant(
    x,
    z,
    species,
    pack,
    growthScale,
    growthStage,
    family,
    groupRoot = null,
    groupLean = null,
  ) {
    if (SPECIES[species].architecture?.type === 'root-clump') {
      return placeRootClump(
        x, z, species, pack, growthScale, growthStage, family, groupLean,
      );
    }
    let options = null;
    if (groupRoot) {
      const dx = x - groupRoot.x;
      const dz = z - groupRoot.z;
      const outwardDirection = groupLean ?? (dx * dx + dz * dz > 0.0001
        ? Math.atan2(dz, dx)
        : rand() * Math.PI * 2);
      const maxTilt = SPECIES[species].tilt;
      options = {
        architecture: {
          tiltDir: outwardDirection + (rand() - 0.5) * 0.34,
          tilt: Math.min(maxTilt, 0.27 + rand() * 0.2),
        },
      };
    }
    return place(x, z, species, pack, growthScale, growthStage, family, options);
  }

  // CPU mirror of the GPU head sway, used only at detach so the free petal starts
  // from the exact head orientation that was visible in the shader.
  const qSwayScratch = new THREE.Quaternion();
  function computeSwayQuaternion(flower) {
    const phase = flower.x * WIND.x + flower.z * WIND.y;
    const t = windClock * windSpeed;
    const windWave = Math.sin(t * 0.82 + phase * 0.72)
      + Math.sin(t * 1.47 + phase * 1.18 + 1.9) * 0.55
      + Math.sin(t * 2.65 + phase * 0.35 + flower.windPhase * 0.8) * 0.35;
    const windBend = flower.windResponse * windWave * 0.055 * windScale / HEAD_Y;
    const crossPhase = -flower.x * WIND.y + flower.z * WIND.x;
    const crossWave = Math.sin(t * 0.53 + crossPhase * 0.86 + 0.7)
      + Math.sin(t * 1.21 - phase * 0.41 + flower.windPhase) * 0.45;
    const crossBend = flower.windResponse * crossWave * 0.055
      * windScale * windTurbulence / HEAD_Y;
    const c = Math.cos(flower.rotation);
    const rotationSine = Math.sin(flower.rotation);
    const worldWindX = WIND.x * windBend - WIND.y * crossBend;
    const worldWindZ = WIND.y * windBend + WIND.x * crossBend;
    const localWindX = worldWindX * c + worldWindZ * rotationSine;
    const localWindZ = -worldWindX * rotationSine + worldWindZ * c;
    const tiltX = Math.cos(flower.tiltDir) * flower.tilt;
    const tiltZ = Math.sin(flower.tiltDir) * flower.tilt;
    eScratch.set(tiltX + localWindZ, flower.rotation, tiltZ - localWindX);
    qSwayScratch.setFromEuler(eScratch);
  }

  // Detach one petal: freeze its CURRENT world transform, then switch to physics.
  function detach(form, petal) {
    const flower = petal.flower;
    // Refresh the final wilted petal pose, then compose the same swayed head and
    // local petal hierarchy used by the shader. This avoids a delta quaternion
    // handoff, which was sensitive to any transform-order discrepancy.
    writeAttachedPetal(form, petal);
    computeSwayQuaternion(flower);
    const headScale = flower.scale * flowerGrowth(flower);
    pScratch.set(flower.x, yOffset + flower.y, flower.z);
    sScratch.set(headScale, headScale, headScale);
    worldMat.compose(pScratch, qSwayScratch, sScratch);
    worldMat.multiply(petalObj.matrix);
    worldMat.decompose(pScratch, qScratch, sScratch);
    eScratch.setFromQuaternion(qScratch);
    petal.x = pScratch.x; petal.y = pScratch.y; petal.z = pScratch.z;
    petal.rx = eScratch.x; petal.ry = eScratch.y; petal.rz = eScratch.z;
    petal.scaleX = sScratch.x;
    petal.scaleY = sScratch.y;
    petal.scaleZ = sScratch.z;
    petal.free = true;
    petal.age = 0;
    petal.fade = 1;
    petal.deathWhiteness = 0;
    // Free petals are CPU-driven full world matrices now — kill GPU sway on this
    // slot so the shader doesn't double-apply wind on top of the flight matrix.
    // response lives in flowerTint.w (slot*4+3).
    form.petalSway.tintArr[petal.slot * 4 + 3] = 0;
    form.petalSway.tintAttr.needsUpdate = true;
    const flightLifeScale = THREE.MathUtils.lerp(
      0.45,
      1,
      petal.flower.stage / (STAGE_STYLE.length - 1),
    );
    petal.life = (3.4 + rand() * 3.2) * flightLifeScale;
    // Almost no radial launch: the bloom simply lets go, then the shared wind
    // separates the petals. A tiny drift prevents perfectly stacked paths.
    const out = 0.01 + rand() * 0.035;
    const facing = petal.flower.rotation - petal.angle;
    petal.vx = Math.cos(facing) * out;
    petal.vz = Math.sin(facing) * out;
    petal.vy = 0.26 + rand() * 0.18;
    // Flight character, varied widely per petal so the swarm isn't uniform —
    // Motion develops after release, as though the air catches each petal.
    petal.buoyancy = 0.55 + rand() * 0.75;
    petal.swirl = 0.18 + rand() * 0.48;
    petal.windGain = 0.7 + rand() * 1.1;
    petal.flutterRate = 1.3 + rand() * 1.8;
    petal.dx = (rand() - 0.5) * 1.8;
    petal.dy = (rand() - 0.5) * 1.8;
    petal.dz = (rand() - 0.5) * 1.8;
  }

  function writeFreeCenter(form, center) {
    eScratch.set(center.rx, center.ry, center.rz);
    qScratch.setFromEuler(eScratch);
    pScratch.set(center.x, center.y, center.z);
    const scale = center.scale * center.fade;
    sScratch.set(scale, scale, scale);
    worldMat.compose(pScratch, qScratch, sScratch);
    form.centerMesh.setMatrixAt(center.slot, worldMat);
    tmpColor.setRGB(
      THREE.MathUtils.lerp(center.r, deadPetalColor.r, center.bleach),
      THREE.MathUtils.lerp(center.g, deadPetalColor.g, center.bleach),
      THREE.MathUtils.lerp(center.b, deadPetalColor.b, center.bleach),
    );
    form.centerMesh.setColorAt(center.slot, tmpColor);
  }

  function detachCenter(form, flower) {
    if (form.centers.length >= form.centerCap) return;
    computeSwayQuaternion(flower);
    // headScale positions the centre at the true head height. The wilt-shrink
    // (matching the attached disc) is applied ONLY to the rendered size below —
    // folding it into the transform here would scale the HEAD_Y offset too and
    // spawn the centre partway down the stem.
    const headScale = flower.scale * flowerGrowth(flower);
    const wiltDisc = THREE.MathUtils.lerp(1, 0.4, flower.wilt);
    pScratch.set(flower.x, yOffset + flower.y, flower.z);
    sScratch.set(headScale, headScale, headScale);
    worldMat.compose(pScratch, qSwayScratch, sScratch);
    const { rings = 1, tierHeight = 0, discLift = 0.04, discColor = 0xffcf4d } = form.species.form;
    pScratch.set(0, HEAD_Y + tierHeight * (rings - 1) + discLift, 0).applyMatrix4(worldMat);
    eScratch.setFromQuaternion(qSwayScratch);
    tmpColor.set(discColor);
    const center = {
      slot: form.centers.length,
      x: pScratch.x, y: pScratch.y, z: pScratch.z,
      rx: eScratch.x, ry: eScratch.y, rz: eScratch.z,
      scale: headScale * wiltDisc,
      r: tmpColor.r, g: tmpColor.g, b: tmpColor.b,
      vx: (rand() - 0.5) * 0.04,
      vy: 0.18 + rand() * 0.12,
      vz: (rand() - 0.5) * 0.04,
      dx: (rand() - 0.5) * 1.2,
      dy: (rand() - 0.5) * 1.2,
      dz: (rand() - 0.5) * 1.2,
      windGain: 0.42 + rand() * 0.35,
      age: 0,
      life: 3.8 + rand() * 2.2,
      fade: 1,
      bleach: 0,
    };
    form.centers.push(center);
    writeFreeCenter(form, center);
  }

  function removeCenter(form, index) {
    const last = form.centers.length - 1;
    if (index !== last) {
      const moved = form.centers[last];
      moved.slot = index;
      form.centers[index] = moved;
      writeFreeCenter(form, moved);
    }
    form.centers.pop();
    form.centerMesh.setMatrixAt(last, zeroMat);
  }

  // --- colony state ---------------------------------------------------------
  const fieldColony = {
    family: Math.floor(rand() * FIELD_FAMILIES.length),
    stage: 0,
    x: 0,
    z: 0,
    radius: 1.6,
    vigor: 1,
    initialized: false,
    centers: [],
    groupX: 0,
    groupZ: 0,
  };
  const boundaryColony = {
    family: Math.floor(rand() * BOUNDARY_FAMILIES.length),
    stage: 0,
    x: 0,
    z: 0,
    radius: 1.1,
    vigor: 1,
    initialized: false,
    centers: [],
    groupX: 0,
    groupZ: 0,
  };
  let windClock = 0;

  function familyAt(x, z, familyCount) {
    const gridX = Math.floor(x / 2.4);
    const gridZ = Math.floor(z / 2.4);
    const hash = Math.imul(gridX, 73856093) ^ Math.imul(gridZ, 19349663);
    return (hash >>> 0) % familyCount;
  }

  function scatterFromFamilies(
    x,
    z,
    growthStage,
    families,
    colony,
    spread,
    maxTries,
    legacyChance = 0,
    legacyStage = growthStage,
  ) {
    const stage = THREE.MathUtils.clamp(Math.floor(growthStage), 0, families[0].length - 1);
    const rememberedStage = THREE.MathUtils.clamp(
      Math.floor(legacyStage), stage, families[0].length - 1,
    );
    const dcx = x - colony.x, dcz = z - colony.z;
    const startsNewColony = !colony.initialized
      || dcx * dcx + dcz * dcz > colony.radius * colony.radius;
    if (startsNewColony) {
      colony.family = familyAt(x, z, families.length);
      colony.x = x; colony.z = z;
      const nearbyCenters = colony.centers.filter((center) => {
        const dx = center.x - x;
        const dz = center.z - z;
        return dx * dx + dz * dz < 3.2 * 3.2;
      });
      colony.groupX = x;
      colony.groupZ = z;
      for (const center of nearbyCenters) {
        colony.groupX += center.x;
        colony.groupZ += center.z;
      }
      const groupCount = nearbyCenters.length + 1;
      colony.groupX /= groupCount;
      colony.groupZ /= groupCount;
      colony.centers.push({ x, z });
      if (colony.centers.length > 32) colony.centers.shift();
      // Smaller territories make each family read as a distinct local stand
      // instead of stretching one species along a long pointer trail.
      colony.radius = maxTries === 1 ? 0.55 + rand() * 0.35 : 0.72 + rand() * 0.48;
      colony.vigor = 0.9 + rand() * 0.22;
      colony.initialized = true;
    }
    colony.stage = stage;
    const family = families[colony.family];

    const distanceFromCenter = Math.sqrt(
      (x - colony.x) * (x - colony.x) + (z - colony.z) * (z - colony.z),
    );
    const centerStrength = 1 - THREE.MathUtils.smoothstep(
      distanceFromCenter,
      colony.radius * 0.15,
      colony.radius,
    );
    const tries = maxTries === 1
      ? 1
      : centerStrength > 0.62 ? (rand() < 0.35 ? 2 : maxTries)
        : centerStrength > 0.25 ? (rand() < 0.55 ? 1 : 2)
          : 1;
    const planted = [];
    for (let t = 0; t < tries; t += 1) {
      const plantStage = rememberedStage > stage && rand() < legacyChance
        ? Math.min(stage + 1, rememberedStage)
        : stage;
      const species = family[plantStage];
      const speciesDef = SPECIES[species];
      const edgeScale = THREE.MathUtils.lerp(0.74, 1.12, centerStrength);
      const nominalScale = (
        (speciesDef.size[0] + speciesDef.size[1]) * 0.5
        * STAGE_STYLE[plantStage].scale
        * colony.vigor
        * edgeScale
      );
      // 0 for large architectural flowers, approaching 1 for compact ground
      // flowers. Drive all density choices from the expected rendered crown.
      const smallness = 1 - THREE.MathUtils.smoothstep(nominalScale, 0.52, 0.9);
      // More probes per try, and the jitter radius shrinks across attempts: if the
      // outer ring is already packed, later attempts close in toward the hover
      // point where free ground is more likely. Previously only 2-3 fixed-radius
      // probes ran, so a spot ringed by a few blooms kept colliding and the hover
      // planted nothing even though open moss sat right under the cursor.
      const placementAttempts = maxTries === 1 ? 4 : 5;
      // Keep new members orbiting the colony's original anchor. The pointer still
      // steers the patch outward, but it cannot smear one family into a uniform
      // trail across the full territory.
      const clumpPull = maxTries === 1
        ? 0.48
        : THREE.MathUtils.lerp(0.64, 0.82, centerStrength);
      const spawnCenterX = THREE.MathUtils.lerp(x, colony.x, clumpPull);
      const spawnCenterZ = THREE.MathUtils.lerp(z, colony.z, clumpPull);
      const clumpSpread = spread * THREE.MathUtils.lerp(0.56, 0.34, centerStrength);
      const parentChance = THREE.MathUtils.lerp(0.72, 0.92, smallness);
      const parent = rand() < parentChance
        ? findFamilyParent(x, z, colony.family, maxTries === 1 ? 1.1 : 2.2)
        : null;
      const parentAngle = rand() * Math.PI * 2;
      const childRadius = CROWN_RADIUS * nominalScale;
      // The offset must clear the parent's collision shell, otherwise the anchored
      // spot is already inside the parent and every probe around it collides. The
      // pack ratio caps near ~0.82, so keep the minimum separation above that —
      // small blooms used to anchor at 0.52, well inside the parent, and starved.
      const parentDistance = parent
        ? (parent.radius + childRadius)
          * THREE.MathUtils.lerp(1.05 + rand() * 0.4, 0.92 + rand() * 0.26, smallness)
        : 0;
      const parentCenterX = parent ? parent.x + Math.cos(parentAngle) * parentDistance : spawnCenterX;
      const parentCenterZ = parent ? parent.z + Math.sin(parentAngle) * parentDistance : spawnCenterZ;
      // A parent's offspring still inherit a little pointer/colony influence, so
      // stands spread outward in lobes rather than forming perfect circles.
      const candidateCenterX = parent
        ? THREE.MathUtils.lerp(parentCenterX, spawnCenterX, 0.24)
        : spawnCenterX;
      const candidateCenterZ = parent
        ? THREE.MathUtils.lerp(parentCenterZ, spawnCenterZ, 0.24)
        : spawnCenterZ;
      const candidateSpread = parent
        ? clumpSpread * THREE.MathUtils.lerp(0.42, 0.24, smallness)
        : clumpSpread * THREE.MathUtils.lerp(1, 0.78, smallness);

      // Parent-anchored probes cluster in a tiny neighbourhood beside an existing
      // bloom; once that spot is taken every attempt collides and the try plants
      // nothing. The extra attempts fall back to the open spawn centre under the
      // cursor so a worked area keeps filling instead of starving — the failure
      // that left early/low-density patches looking dead.
      const fallbackAttempts = parent ? placementAttempts : 0;
      const totalAttempts = placementAttempts + fallbackAttempts;
      for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
        const onFallback = attempt >= placementAttempts;
        const localAttempt = onFallback ? attempt - placementAttempts : attempt;
        const localCount = onFallback ? fallbackAttempts : placementAttempts;
        const closeIn = 1 - localAttempt / localCount;
        const activeCenterX = onFallback ? spawnCenterX : candidateCenterX;
        const activeCenterZ = onFallback ? spawnCenterZ : candidateCenterZ;
        const activeSpread = onFallback
          ? clumpSpread * THREE.MathUtils.lerp(1, 0.78, smallness)
          : candidateSpread;
        const r = (rand() * rand()) * activeSpread * closeIn;
        // Around a parent, bias the probe into the outward half-disc (away from the
        // parent) so jitter adds clearance instead of steering back into the bloom
        // we are trying to sit beside. The open-ground passes stay fully radial.
        const a = parent && !onFallback
          ? parentAngle + (rand() - 0.5) * Math.PI
          : rand() * Math.PI * 2;
        const fx = activeCenterX + Math.cos(a) * r;
        const fz = activeCenterZ + Math.sin(a) * r;
        const growthScale = colony.vigor * edgeScale * (0.92 + rand() * 0.16);
        const basePack = THREE.MathUtils.lerp(0.74, 0.5, centerStrength) + rand() * 0.08;
        const pack = THREE.MathUtils.lerp(basePack, basePack * 0.78, smallness);
        const groupRoot = {
          x: THREE.MathUtils.lerp(fx, colony.x, 0.72),
          z: THREE.MathUtils.lerp(fz, colony.z, 0.72),
        };
        const localX = fx - groupRoot.x;
        const localZ = fz - groupRoot.z;
        const groupX = colony.x - colony.groupX;
        const groupZ = colony.z - colony.groupZ;
        const leanX = localX * 0.85 + groupX * 1.25;
        const leanZ = localZ * 0.85 + groupZ * 1.25;
        const groupLean = leanX * leanX + leanZ * leanZ > 0.0001
          ? Math.atan2(leanZ, leanX)
          : null;
        if (placePlant(
          fx,
          fz,
          species,
          pack,
          growthScale,
          plantStage,
          colony.family,
          groupRoot,
          groupLean,
        )) {
          planted.push({
            x: fx,
            z: fz,
            rootX: groupRoot.x,
            rootZ: groupRoot.z,
          });
          break;
        }
      }
    }
    return planted;
  }

  return {
    object: group,
    flowers,
    scatter(x, z, growthStage = 0, legacyChance = 0, legacyStage = growthStage) {
      return scatterFromFamilies(
        x, z, growthStage, FIELD_FAMILIES, fieldColony, 0.85, 3, legacyChance, legacyStage,
      );
    },

    scatterBoundary(x, z, growthStage = 0, legacyChance = 0, legacyStage = growthStage) {
      return scatterFromFamilies(
        x, z, growthStage, BOUNDARY_FAMILIES, boundaryColony, 0.18, 1,
        legacyChance, legacyStage,
      );
    },

    update(delta) {
      const dt = Math.min(delta, 0.1);
      windClock += dt;
      // Drive the GPU head sway. This single uniform replaces the per-petal
      // wind matrix recompute that used to run on the CPU every frame.
      windTimeUniform.value = windClock;
      // Per-form dirty tracking: only re-upload a form's buffers if it actually
      // wrote a matrix this frame (a flower of that species bloomed/wilted/died
      // or had free petals). A settled or empty species uploads nothing.
      for (const form of forms) form.dirty = false;
      // Gusting: the breeze surges and lulls instead of a flat constant push.
      // Two offset sines → an irregular gust factor roughly in [0.6, 1.9].
      const gust = 1.25
        + Math.sin(windClock * 0.7) * 0.45
        + Math.sin(windClock * 1.9 + 1.1) * 0.2;

      // 1) flowers: bloom in, close partway at end of life, then release petals
      for (let i = flowers.length - 1; i >= 0; i -= 1) {
        const flower = flowers[i];
        const form = forms[flower.species];
        flower.age += dt;

        if (!flower.wilting && !flower.dying && flower.age >= flower.life) {
          flower.wilting = true;
        }

        if (flower.wilting) {
          const wiltProgress = Math.min(1, (flower.age - flower.life) / flower.wiltDuration);
          flower.wilt = wiltProgress * wiltProgress * (3 - 2 * wiltProgress);

          if (wiltProgress >= 1) {
            flower.wilting = false;
            flower.dying = true;
            flower.deathAge = 0;
            // Detach from the final, partly closed pose so there is no pop when
            // the petals switch from rooted transforms to airborne physics.
            for (const petal of flower.petalRecords) detach(form, petal);
            flower.petalRecords.length = 0;
            detachCenter(form, flower);
          }
        }

        if (flower.dying) {
          // The centre has detached with the petals. Leave the stem rooted long
          // enough to dull and droop, then retract it into the basal growth.
          const b = flower.base;
          flower.deathAge += dt;
          const progress = Math.min(1, flower.deathAge / 1.8);
          b.deathProgress = progress * progress * (3 - 2 * progress);
          b.discFade = Math.max(0, 1 - flower.deathAge / 0.14);
          const retract = THREE.MathUtils.clamp((progress - 0.55) / 0.45, 0, 1);
          b.fade = 1 - retract * retract * (3 - 2 * retract);
          writeBaseTint(form, b);
          writeBase(form, b);
          form.dirty = true;
          if (progress >= 1) {
            removeBase(form, b.slot);
            collisionRemove(flower);
            const last = flowers.length - 1;
            if (i !== last) flowers[i] = flowers[last];
            flowers.pop();
          }
          continue;
        }

        if (flower.bloom < 1) {
          flower.bloom = Math.min(1, flower.bloom + dt * flower.bloomSpeed);
        }

        // The head sway is now entirely on the GPU. The CPU rest pose only
        // changes while the flower's POSTURE is still animating — i.e. growth
        // hasn't settled, or it's wilting. Once settled, the rest matrix is
        // constant, so we stop rewriting it: this is the win that drops a mature
        // field's per-frame petal-matrix cost to zero.
        const settleEnd = flower.growthBurstDuration + flower.growthSettleDuration;
        const stillAnimating = flower.age < settleEnd || flower.wilting || flower.bloom < 1;
        if (stillAnimating) {
          for (const petal of flower.petalRecords) writeAttachedPetal(form, petal);
          writeBase(form, flower.base);
          form.dirty = true;
        }
      }

      // 2) free petals: catch an updraft and swirl up & away over the hedge,
      // rather than falling through the tufts. Buoyancy lifts them, a per-petal
      // circular swirl gives a looping flight path, wind carries them off, and
      // they fade out while still airborne — they never touch the moss.
      for (const form of forms) {
        for (let i = form.petals.length - 1; i >= 0; i -= 1) {
          const p = form.petals[i];
          if (!p.free) continue;
          p.age += dt;
          if (p.age >= p.life) { removePetal(form, i); continue; }

          // Rise almost vertically first, then arc smoothly into the prevailing
          // wind. This makes release feel buoyant rather than immediately swept.
          const releaseProgress = Math.min(1, p.age / 1.3);
          const windDelay = Math.max(0, (releaseProgress - 0.16) / 0.84);
          const windRamp = windDelay * windDelay * (3 - 2 * windDelay);
          const riseRamp = 1 - windRamp * 0.55;
          p.flutter += dt * p.flutterRate;
          // Swirl: a slowly-rotating horizontal drift vector → looping path.
          const swirlX = Math.cos(p.flutter) * p.swirl * windRamp;
          const swirlZ = Math.sin(p.flutter * 0.9 + 1.3) * p.swirl * windRamp;

          // Buoyant lift that eases off as the petal tires, so it rises then
          // levels out high above the canopy instead of climbing forever.
          const lift = p.buoyancy * riseRamp * Math.exp(-p.age * 0.36);
          p.vy += (lift - 0.1) * dt;
          p.vy = THREE.MathUtils.clamp(p.vy, -0.08, 1.05);
          p.vx *= 0.985; p.vz *= 0.985;        // initial nudge bleeds off slowly

          const wx = WIND.x * p.windGain * windRamp * gust;
          const wz = WIND.y * p.windGain * windRamp * gust;
          // Detached petals are light enough to catch smaller cross-currents
          // than rooted plants. One broad sine gives curl without noise lookups.
          const curl = Math.sin(
            windClock * 0.9 + p.x * 0.72 - p.z * 0.48 + p.flutter * 0.2,
          ) * p.windGain * windRamp * windTurbulence * 0.65;
          p.x += (p.vx + wx - WIND.y * curl + swirlX) * dt;
          p.y += p.vy * dt;
          p.z += (p.vz + wz + WIND.x * curl + swirlZ) * dt;

          // Lively tumble — petals spin as they ride the air.
          p.rx += (p.dx + swirlX * 1.5) * dt;
          p.ry += p.dy * dt;
          p.rz += (p.dz + swirlZ * 1.5) * dt;

          // Stay full-sized through the first quarter of the flight, then shrink
          // gradually across the remaining journey instead of vanishing late.
          const fadeOut = Math.min(1, (1 - p.age / p.life) / 0.75);
          p.fade = fadeOut;
          const bleachProgress = Math.min(1, p.age / Math.min(0.85, p.life * 0.22));
          p.deathWhiteness = bleachProgress * bleachProgress * (3 - 2 * bleachProgress);
          writePetalTint(form, p);
          writeFreePetal(form, p);
          form.dirty = true;
        }

        for (let i = form.centers.length - 1; i >= 0; i -= 1) {
          const center = form.centers[i];
          center.age += dt;
          if (center.age >= center.life) {
            removeCenter(form, i);
            form.dirty = true;
            continue;
          }
          const release = Math.min(1, center.age / 1.1);
          const windRamp = release * release * (3 - 2 * release);
          center.vy += (0.22 * Math.exp(-center.age * 0.45) - 0.08) * dt;
          center.vx *= 0.986;
          center.vz *= 0.986;
          center.x += (center.vx + WIND.x * center.windGain * windRamp * gust) * dt;
          center.y += center.vy * dt;
          center.z += (center.vz + WIND.y * center.windGain * windRamp * gust) * dt;
          center.rx += center.dx * dt;
          center.ry += center.dy * dt;
          center.rz += center.dz * dt;
          center.fade = Math.min(1, (1 - center.age / center.life) / 0.72);
          const bleach = Math.min(1, center.age / 0.75);
          center.bleach = bleach * bleach * (3 - 2 * bleach);
          writeFreeCenter(form, center);
          form.dirty = true;
        }
      }

      // Only re-upload buffers for forms that actually wrote a matrix this frame.
      // Settled/empty species upload nothing — the GPU sway needs no CPU upload.
      for (const form of forms) {
        if (!form.dirty) continue;
        form.petalMesh.instanceMatrix.needsUpdate = true;
        form.petalAttr.needsUpdate = true;
        form.petalPose.aAttr.needsUpdate = true;
        form.petalPose.bAttr.needsUpdate = true;
        form.baseMesh.instanceMatrix.needsUpdate = true;
        form.baseAttr.needsUpdate = true;
        form.discGrowthAttr.needsUpdate = true;
        form.centerMesh.instanceMatrix.needsUpdate = true;
        if (form.centerMesh.instanceColor) form.centerMesh.instanceColor.needsUpdate = true;
      }
    },
  };
}
