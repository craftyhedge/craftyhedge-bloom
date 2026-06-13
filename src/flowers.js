import * as THREE from 'three/webgpu';
import { instancedBufferAttribute, mul, vertexColor } from 'three/tsl';
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
    name: 'indigo', palette: ['#416dff', '#294fe8', '#6790ff'],
    size: [0.6, 0.95], stem: [0.42, 0.58], tilt: 0.5, bloom: [1.4, 2.4],
    form: { petals: 5, rings: 1, tip: 0.52, wide: 0.34, lift: 0.16, cup: 0.5, shape: 'round', disc: 0.16, discColor: 0xffdf62, discLift: 0.02 },
  },
  {
    stage: 0,
    name: 'aqua', palette: ['#18e5d0', '#00bfb7', '#43f2df'],
    size: [0.45, 0.7], stem: [0.4, 0.54], tilt: 0.35, bloom: [2.2, 3.4],
    form: { petals: 14, rings: 1, tip: 0.5, wide: 0.07, lift: 0.05, cup: 0.15, shape: 'spoon', disc: 0.2, discColor: 0xd6a32e, discLift: 0.05 },
  },
  {
    stage: 0,
    name: 'blue', palette: ['#3e91ff', '#176de8', '#68adff'],
    size: [0.4, 0.62], stem: [0.46, 0.62], tilt: 0.6, bloom: [2.0, 3.0],
    form: { petals: 8, rings: 2, tip: 0.5, wide: 0.13, lift: 0.22, cup: 0.6, shape: 'notch', disc: 0.1, discColor: 0xdff7ff, discLift: 0.06 },
  },
  {
    stage: 0,
    name: 'emerald', palette: ['#35df91', '#17b86e', '#62efa9'],
    size: [0.4, 0.6], stem: [0.4, 0.52], tilt: 0.4, bloom: [2.6, 3.8],
    form: { petals: 5, rings: 1, tip: 0.46, wide: 0.3, lift: 0.13, cup: 0.7, shape: 'round', disc: 0.12, discColor: 0xffe56b, discLift: 0.03 },
  },
  {
    stage: 1,
    name: 'cobalt', palette: ['#526fff', '#354de0', '#748bff'],
    size: [0.35, 0.55], stem: [0.38, 0.5], tilt: 0.7, bloom: [2.4, 3.4],
    form: { petals: 5, rings: 1, tip: 0.44, wide: 0.26, lift: 0.1, cup: 0.3, shape: 'point', disc: 0.08, discColor: 0xd6a32e, discLift: 0.02 },
  },
  {
    stage: 1,
    name: 'sun-yellow', palette: ['#fff02e', '#ffc928', '#fff866'],
    size: [0.6, 0.95], stem: [0.48, 0.64], tilt: 0.55, bloom: [1.6, 2.6],
    form: { petals: 8, rings: 1, tip: 0.54, wide: 0.2, lift: 0.12, cup: 0.35, shape: 'notch', disc: 0.16, discColor: 0xffa914, discLift: 0.04 },
  },
  {
    stage: 1,
    name: 'clear-cyan', palette: ['#27dfff', '#00addf', '#64ebff'],
    size: [0.48, 0.72], stem: [0.5, 0.68], tilt: 0.48, bloom: [2.0, 3.0],
    form: { petals: 7, rings: 1, tip: 0.58, wide: 0.16, lift: 0.2, cup: 0.45, shape: 'point', disc: 0.12, discColor: 0xffed87, discLift: 0.05 },
  },
  {
    stage: 1,
    name: 'tangerine', palette: ['#ff9f2f', '#ef741c', '#ffbd4d'],
    size: [0.52, 0.78], stem: [0.45, 0.62], tilt: 0.4, bloom: [1.8, 2.8],
    form: { petals: 6, rings: 1, tip: 0.5, wide: 0.24, lift: 0.18, cup: 0.8, shape: 'round', disc: 0.13, discColor: 0xffdc50, discLift: 0.05 },
  },
  {
    stage: 2,
    name: 'crimson-crown', palette: ['#ed3552', '#c91f3d', '#ff5e6e'],
    size: [0.72, 1.0], stem: [0.62, 0.82], tilt: 0.38, bloom: [1.4, 2.2],
    form: { petals: 9, rings: 2, tip: 0.62, wide: 0.13, lift: 0.25, cup: 0.65, shape: 'notch', disc: 0.14, discColor: 0xffe278, discLift: 0.08 },
  },
  {
    stage: 2,
    name: 'electric-blue', palette: ['#176cff', '#0047d6', '#269fff'],
    size: [0.65, 0.9], stem: [0.58, 0.78], tilt: 0.5, bloom: [1.5, 2.3],
    form: { petals: 5, rings: 2, tip: 0.6, wide: 0.22, lift: 0.28, cup: 0.72, shape: 'spoon', disc: 0.1, discColor: 0xe9fbff, discLift: 0.08 },
  },
  {
    stage: 2,
    name: 'orange-crown', palette: ['#ff7424', '#e84a15', '#ff9b38'],
    size: [0.7, 0.96], stem: [0.56, 0.76], tilt: 0.42, bloom: [1.5, 2.4],
    form: { petals: 11, rings: 1, tip: 0.58, wide: 0.12, lift: 0.22, cup: 0.5, shape: 'point', disc: 0.18, discColor: 0xfff0a8, discLift: 0.07 },
  },
  {
    boundary: true,
    stage: 0,
    name: 'edge-bell', palette: ['#e8ffff', '#a8efff', '#c8f8ef'],
    size: [0.3, 0.46], stem: [0.3, 0.44], tilt: 0.32, bloom: [2.5, 3.6],
    form: { petals: 6, rings: 1, tip: 0.38, wide: 0.16, lift: 0.18, cup: 0.9, shape: 'round', disc: 0.08, discColor: 0xffe66d, discLift: 0.04 },
  },
  {
    boundary: true,
    stage: 1,
    name: 'edge-star', palette: ['#fff43b', '#ffd21f', '#ffeb58'],
    size: [0.36, 0.54], stem: [0.34, 0.5], tilt: 0.38, bloom: [2.1, 3.2],
    form: { petals: 7, rings: 1, tip: 0.42, wide: 0.1, lift: 0.16, cup: 0.48, shape: 'point', disc: 0.09, discColor: 0xf6ffff, discLift: 0.05 },
  },
  {
    boundary: true,
    stage: 2,
    name: 'edge-trumpet', palette: ['#ff5e55', '#df3340', '#ff805f'],
    size: [0.42, 0.62], stem: [0.38, 0.56], tilt: 0.42, bloom: [1.8, 2.8],
    form: { petals: 5, rings: 1, tip: 0.48, wide: 0.2, lift: 0.24, cup: 1.0, shape: 'spoon', disc: 0.08, discColor: 0xffef9c, discLift: 0.06 },
  },
  {
    boundary: true,
    stage: 2,
    name: 'edge-electric-blue', palette: ['#005dff', '#008cff', '#18c8ff'],
    size: [0.46, 0.66], stem: [0.4, 0.58], tilt: 0.36, bloom: [1.7, 2.7],
    form: { petals: 8, rings: 2, tip: 0.46, wide: 0.1, lift: 0.22, cup: 0.65, shape: 'point', disc: 0.09, discColor: 0xd9ffff, discLift: 0.07 },
  },
];

const SPECIES_BY_STAGE = [0, 1, 2].map((stage) => (
  SPECIES.flatMap((species, index) => !species.boundary && species.stage === stage ? [index] : [])
));
const BOUNDARY_SPECIES_BY_STAGE = [0, 1, 2].map((stage) => (
  SPECIES.flatMap((species, index) => species.boundary && species.stage === stage ? [index] : [])
));

// Make repeat visits readable even before the viewer notices a different petal
// shape: later stages rise above the earlier carpet and step toward lighter,
// more luminous colours.
const STAGE_STYLE = [
  { scale: 0.86, stem: 0.92, saturation: 0.06, lightness: 0 },
  { scale: 1.06, stem: 1.08, saturation: 0.05, lightness: 0.015 },
  { scale: 1.28, stem: 1.22, saturation: 0.08, lightness: 0.02 },
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
  // build(s) -> { x, y, z, hw, sideX, sideZ } centreline samples. Keep one
  // shared vertex pair per sample so computed normals blend across the curve.
  const samples = build();
  const base = positions.length / 3;

  for (const sample of samples) {
    positions.push(
      sample.x - sample.sideX * sample.hw,
      sample.y,
      sample.z - sample.sideZ * sample.hw,
      sample.x + sample.sideX * sample.hw,
      sample.y,
      sample.z + sample.sideZ * sample.hw,
    );
    colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }

  for (let s = 1; s < samples.length; s += 1) {
    const previousLeft = base + (s - 1) * 2;
    const previousRight = previousLeft + 1;
    const currentLeft = base + s * 2;
    const currentRight = currentLeft + 1;
    indices.push(
      previousLeft, currentLeft, currentRight,
      previousLeft, currentRight, previousRight,
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
  const { disc = 0.16, discColor = 0xffcf4d, discLift = 0.04 } = form;
  const positions = [];
  const colors = [];
  const indices = [];
  const pushTri = (ax, ay, az, bx, by, bz, cx, cy, cz, col) => {
    const base = positions.length / 3;
    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    for (let k = 0; k < 3; k += 1) colors.push(col.r, col.g, col.b);
    indices.push(base, base + 1, base + 2);
  };

  const stemColor = new THREE.Color(0x2f6b22);
  const sh = 0.03;
  pushTri(-sh, 0, 0, sh, 0, 0, 0, HEAD_Y, 0, stemColor);
  pushTri(0, 0, -sh, 0, 0, sh, 0, HEAD_Y, 0, stemColor);

  const discSeg = 9;
  const cc = new THREE.Color(discColor);
  for (let i = 0; i < discSeg; i += 1) {
    const a0 = (i / discSeg) * Math.PI * 2;
    const a1 = ((i + 1) / discSeg) * Math.PI * 2;
    pushTri(
      0, HEAD_Y + discLift + 0.04, 0,
      Math.cos(a0) * disc, HEAD_Y + discLift, Math.sin(a0) * disc,
      Math.cos(a1) * disc, HEAD_Y + discLift, Math.sin(a1) * disc,
      cc,
    );
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
} = {}) {
  const [LIFE_MIN, LIFE_MAX] = lifespan;

  let randSeed = seed;
  const rand = () => {
    randSeed = (randSeed * 1664525 + 1013904223) >>> 0;
    return randSeed / 4294967296;
  };

  const tmpColor = new THREE.Color();
  const zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);
  const WIND = new THREE.Vector2(0.58, 0.82).normalize();

  // Reusable transform scratch.
  const headObj = new THREE.Object3D();   // flower head frame (pos/lean/spin/scale)
  const petalObj = new THREE.Object3D();   // a petal as child of the head
  const worldMat = new THREE.Matrix4();
  const qScratch = new THREE.Quaternion();
  const pScratch = new THREE.Vector3();
  const sScratch = new THREE.Vector3();
  const eScratch = new THREE.Euler();

  // Total petals a species can have on screen at once (attached + detached).
  // Per flower it has form.petals; size the pool for a full field plus drift.
  const perBase = Math.max(24, Math.ceil(maxFlowers / SPECIES.length));

  // One shared dapple gobo for every flower material — it's a pure function of
  // world position + time, so the same drifting light pools that fall on the moss
  // and ground also play across the blooms, grounding them in the scene.
  const dappleNode = dapple ? createDappleNode(dapple) : null;

  const forms = SPECIES.map((species) => {
    const petalGeo = makePetalGeometry(species.form);
    const baseGeo = makeBaseGeometry(species.form);

    const makeMesh = (geo, count, tintArr, isPetal = false) => {
      const material = new THREE.MeshStandardNodeMaterial({
        color: 0xffffff,
        vertexColors: true,
        side: THREE.DoubleSide,
        metalness: 0,
        // Petals have a broad waxy/silky highlight; stems and flower centres
        // stay much more matte so the reflective response reads as petal-like.
        roughness: isPetal ? 0.46 : 0.82,
      });
      const attr = new THREE.InstancedBufferAttribute(tintArr, 3);
      geo.setAttribute('flowerTint', attr);
      const tinted = mul(vertexColor(), instancedBufferAttribute(attr));
      // Fold the dapple into the base colour so blooms dim/warm with the same
      // light pools as the moss instead of reading as flatly-lit decals on top.
      const shadedTint = dappleNode ? mul(tinted, dappleNode) : tinted;
      material.colorNode = isPetal ? mul(shadedTint, 1.03) : shadedTint;
      // Keep colour in the dapple shade without flattening it. Petals get a
      // slightly higher floor; the scene's bloom pass still supplies any halo.
      material.emissiveNode = mul(tinted, isPetal ? 0.2 : 0.14);
      const mesh = new THREE.InstancedMesh(geo, material, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < count; i += 1) mesh.setMatrixAt(i, zeroMat);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.count = count;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      return { mesh, attr, tintArr };
    };

    // Headroom: detached petals linger in the pool while they drift, so allow
    // ~1.8× a full field of attached petals before placement is refused.
    const petalCap = Math.ceil(perBase * species.form.petals * (species.form.rings || 1) * 1.8);
    const petalTint = new Float32Array(petalCap * 3);
    const baseTint = new Float32Array(perBase * 3);
    const petal = makeMesh(petalGeo, petalCap, petalTint, true);
    const base = makeMesh(baseGeo, perBase, baseTint);

    return {
      species,
      petalCap,
      petalMesh: petal.mesh, petalAttr: petal.attr, petalTint: petalTint,
      baseMesh: base.mesh, baseAttr: base.attr, baseTint: baseTint,
      petals: [],  // live petal records (attached or free)
      bases: [],   // live base records (one per living flower head)
    };
  });

  const group = new THREE.Group();
  for (const f of forms) group.add(f.petalMesh, f.baseMesh);

  const CROWN_RADIUS = 0.5;
  const flowers = [];

  // --- writers --------------------------------------------------------------

  // Compose the head frame for a flower (without scale-from-bloom applied to
  // children — bloom/fade scale is folded per element).
  function headMatrix(flower, scaleMul) {
    eScratch.set(
      Math.cos(flower.tiltDir) * flower.tilt,
      flower.rotation,
      Math.sin(flower.tiltDir) * flower.tilt,
    );
    qScratch.setFromEuler(eScratch);
    pScratch.set(flower.x, yOffset + flower.y, flower.z);
    const s = flower.scale * scaleMul;
    sScratch.set(s, s, s);
    return worldMat.compose(pScratch, qScratch, sScratch);
  }

  function writeTint(arr, attr, slot, r, g, b) {
    const j = slot * 3;
    arr[j] = r; arr[j + 1] = g; arr[j + 2] = b;
  }

  // Attached petal: world = headMatrix · rotateY(petalAngle). Same transform the
  // baked head used, so detaching is seamless.
  function writeAttachedPetal(form, petal) {
    const flower = petal.flower;
    const bloom = flower.bloom < 1 ? 1 - (1 - flower.bloom) * (1 - flower.bloom) : 1;
    const head = headMatrix(flower, bloom);
    // Lift to the head height here (not baked into the geometry) so the petal's
    // own origin stays at its base — it then tumbles about its base when free,
    // not about the distant flower root.
    petalObj.position.set(0, HEAD_Y + petal.heightOffset, 0);
    // rotateY sends +X→(cos,-sin) so negate to match make\* placement (cos,+sin)
    petalObj.rotation.set(petal.pitch, -petal.angle, petal.roll);
    petalObj.scale.setScalar(petal.sizeVariation);
    petalObj.updateMatrix();
    worldMat.multiply(petalObj.matrix); // head · petalLocal  (worldMat held head)
    form.petalMesh.setMatrixAt(petal.slot, worldMat);
  }

  // Free petal: integrate its own world position/orientation.
  function writeFreePetal(form, petal) {
    eScratch.set(petal.rx, petal.ry, petal.rz);
    qScratch.setFromEuler(eScratch);
    pScratch.set(petal.x, petal.y, petal.z);
    const s = petal.scale * petal.fade;
    sScratch.set(s, s, s);
    worldMat.compose(pScratch, qScratch, sScratch);
    form.petalMesh.setMatrixAt(petal.slot, worldMat);
  }

  function writeBase(form, b) {
    const flower = b.flower;
    const bloom = flower.bloom < 1 ? 1 - (1 - flower.bloom) * (1 - flower.bloom) : 1;
    headMatrix(flower, bloom * b.fade);
    form.baseMesh.setMatrixAt(b.slot, worldMat);
  }

  // --- petal slot management (per form) ------------------------------------

  function addPetal(form, petal) {
    petal.slot = form.petals.length;
    form.petals.push(petal);
    writeTint(form.petalTint, form.petalAttr, petal.slot, petal.r, petal.g, petal.b);
  }

  function removePetal(form, index) {
    const last = form.petals.length - 1;
    if (index !== last) {
      const moved = form.petals[last];
      moved.slot = index;
      form.petals[index] = moved;
      // rewrite moved into its new slot (matrix + tint)
      if (moved.free) writeFreePetal(form, moved); else writeAttachedPetal(form, moved);
      writeTint(form.petalTint, form.petalAttr, index, moved.r, moved.g, moved.b);
    }
    form.petals.pop();
    form.petalMesh.setMatrixAt(last, zeroMat);
  }

  function removeBase(form, index) {
    const last = form.bases.length - 1;
    if (index !== last) {
      const moved = form.bases[last];
      moved.slot = index;
      form.bases[index] = moved;
      writeTint(form.baseTint, form.baseAttr, index, moved.flower.r, moved.flower.g, moved.flower.b);
      writeBase(form, moved);
    }
    form.bases.pop();
    form.baseMesh.setMatrixAt(last, zeroMat);
  }

  // --- placement ------------------------------------------------------------

  function makeFlower(x, z, speciesIndex, growthScale = 1) {
    const species = SPECIES[speciesIndex];
    const stageStyle = STAGE_STYLE[species.stage];
    const localTiltScale = tiltScale ? tiltScale(x, z) : 1;
    tmpColor.set(species.palette[Math.floor(rand() * species.palette.length)]);
    tmpColor.offsetHSL(0, stageStyle.saturation, stageStyle.lightness);
    const scale = (
      species.size[0] + rand() * (species.size[1] - species.size[0])
    ) * stageStyle.scale * growthScale;
    return {
      x, z,
      y: (
        species.stem[0] + rand() * (species.stem[1] - species.stem[0])
      ) * stageStyle.stem,
      rotation: rand() * Math.PI * 2,
      scale,
      tilt: rand() * species.tilt * localTiltScale,
      tiltDir: rand() * Math.PI * 2,
      bloom: 0.0001,
      bloomSpeed: species.bloom[0] + rand() * (species.bloom[1] - species.bloom[0]),
      age: 0,
      life: LIFE_MIN + rand() * (LIFE_MAX - LIFE_MIN),
      dying: false,
      species: speciesIndex,
      radius: CROWN_RADIUS * scale,
      r: tmpColor.r, g: tmpColor.g, b: tmpColor.b,
      base: null,
      petalRecords: [],
    };
  }

  function place(x, z, speciesIndex, pack = 0.62, growthScale = 1) {
    if (canGrow && !canGrow(x, z)) return false;
    const form = forms[speciesIndex];
    const np = form.species.form.petals;
    const rings = form.species.form.rings || 1;
    const perRing = np;
    const totalPetals = np * rings;
    if (form.bases.length >= perBase) return false;
    if (form.petals.length + totalPetals > form.petalCap) return false;

    const flower = makeFlower(x, z, speciesIndex, growthScale);
    for (let i = 0; i < flowers.length; i += 1) {
      const o = flowers[i];
      const dx = o.x - x, dz = o.z - z;
      const minDist = (flower.radius + o.radius) * pack;
      if (dx * dx + dz * dz < minDist * minDist) return false;
    }

    // base
    const baseRec = { flower, slot: -1, fade: 1 };
    baseRec.slot = form.bases.length;
    form.bases.push(baseRec);
    writeTint(form.baseTint, form.baseAttr, baseRec.slot, flower.r, flower.g, flower.b);
    flower.base = baseRec;

    // petals — one record per (ring, i), angle matches makeFlowerForm placement
    for (let ring = 0; ring < rings; ring += 1) {
      const phase = (ring / rings) * (Math.PI / perRing);
      for (let i = 0; i < perRing; i += 1) {
        const petalStep = Math.PI * 2 / perRing;
        const angle = i * petalStep + phase + (rand() - 0.5) * petalStep * 0.22;
        const petal = {
          flower, angle, free: false, slot: -1,
          r: flower.r, g: flower.g, b: flower.b,
          // Cheap, stable imperfections keep cloned geometry from reading as a
          // radial stamp. These are folded into the existing instance matrix.
          sizeVariation: 0.88 + rand() * 0.24,
          heightOffset: (rand() - 0.5) * 0.045,
          pitch: (rand() - 0.5) * 0.2,
          roll: (rand() - 0.5) * 0.18,
          // free-state fields (unused until detach)
          x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
          rx: 0, ry: 0, rz: 0, dx: 0, dy: 0, dz: 0,
          flutter: rand() * Math.PI * 2, flutterRate: 1.8 + rand() * 1.6,
          scale: flower.scale, fade: 1, age: 0, life: 4 + rand() * 2.5,
        };
        addPetal(form, petal);
        writeAttachedPetal(form, petal);
        flower.petalRecords.push(petal);
      }
    }

    flowers.push(flower);
    form.petalAttr.needsUpdate = true;
    form.petalMesh.instanceMatrix.needsUpdate = true;
    form.baseAttr.needsUpdate = true;
    form.baseMesh.instanceMatrix.needsUpdate = true;
    return true;
  }

  // Detach one petal: freeze its CURRENT world transform, then switch to physics.
  function detach(form, petal) {
    // current attached world matrix → decompose to pos/quat
    writeAttachedPetal(form, petal); // leaves worldMat = this petal's world matrix
    worldMat.decompose(pScratch, qScratch, sScratch);
    eScratch.setFromQuaternion(qScratch);
    petal.x = pScratch.x; petal.y = pScratch.y; petal.z = pScratch.z;
    petal.rx = eScratch.x; petal.ry = eScratch.y; petal.rz = eScratch.z;
    petal.scale = sScratch.x;
    petal.free = true;
    petal.age = 0;
    petal.fade = 1;
    petal.life = 2.0 + rand() * 2.2;         // wide spread: brisk to lingering
    // a "let go" outward with an upward catch as the air takes it
    const out = 0.12 + rand() * 0.3;
    const facing = petal.flower.rotation - petal.angle;
    petal.vx = Math.cos(facing) * out;
    petal.vz = Math.sin(facing) * out;
    petal.vy = 0.3 + rand() * 0.5;           // initial upward catch
    // Flight character, varied widely per petal so the swarm isn't uniform —
    // some snap away on a gust, others loop and dawdle.
    petal.buoyancy = 0.5 + rand() * 0.9;     // how hard the updraft lifts
    petal.swirl = 0.3 + rand() * 0.9;        // radius of the looping drift
    petal.windGain = 0.9 + rand() * 1.6;     // how much the breeze carries it
    petal.flutterRate = 1.6 + rand() * 2.4;
    petal.dx = (rand() - 0.5) * 3.2;         // livelier tumble
    petal.dy = (rand() - 0.5) * 3.2;
    petal.dz = (rand() - 0.5) * 3.2;
  }

  // --- colony state ---------------------------------------------------------
  const fieldColony = {
    species: SPECIES_BY_STAGE[0][Math.floor(rand() * SPECIES_BY_STAGE[0].length)],
    stage: 0,
    x: 0,
    z: 0,
    radius: 1.6,
    vigor: 1,
    initialized: false,
  };
  const boundaryColony = {
    species: BOUNDARY_SPECIES_BY_STAGE[0][0],
    stage: 0,
    x: 0,
    z: 0,
    radius: 1.1,
    vigor: 1,
    initialized: false,
  };
  let windClock = 0;

  function scatterFromSet(x, z, growthStage, speciesByStage, colony, spread, maxTries) {
    const stage = THREE.MathUtils.clamp(Math.floor(growthStage), 0, speciesByStage.length - 1);
    const speciesSet = speciesByStage[stage];
    const dcx = x - colony.x, dcz = z - colony.z;
    if (!colony.initialized || stage !== colony.stage
      || dcx * dcx + dcz * dcz > colony.radius * colony.radius || rand() < 0.025) {
      colony.species = speciesSet[Math.floor(rand() * speciesSet.length)];
      colony.stage = stage;
      colony.x = x; colony.z = z;
      colony.radius = maxTries === 1 ? 0.8 + rand() * 0.65 : 1.25 + rand() * 1.1;
      colony.vigor = 0.9 + rand() * 0.22;
      colony.initialized = true;
    }

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
      const r = (rand() * rand()) * spread;
      const a = rand() * Math.PI * 2;
      const fx = x + Math.cos(a) * r;
      const fz = z + Math.sin(a) * r;
      const species = rand() < 0.08
        ? speciesSet[Math.floor(rand() * speciesSet.length)]
        : colony.species;
      const edgeScale = THREE.MathUtils.lerp(0.74, 1.12, centerStrength);
      const growthScale = colony.vigor * edgeScale * (0.92 + rand() * 0.16);
      const pack = THREE.MathUtils.lerp(0.74, 0.5, centerStrength) + rand() * 0.08;
      if (place(fx, fz, species, pack, growthScale)) planted.push({ x: fx, z: fz });
    }
    return planted;
  }

  return {
    object: group,
    flowers,
    scatter(x, z, growthStage = 0) {
      return scatterFromSet(x, z, growthStage, SPECIES_BY_STAGE, fieldColony, 0.85, 3);
    },

    scatterBoundary(x, z, growthStage = 0) {
      return scatterFromSet(
        x, z, growthStage, BOUNDARY_SPECIES_BY_STAGE, boundaryColony, 0.18, 1,
      );
    },

    update(delta) {
      const dt = Math.min(delta, 0.1);
      windClock += dt;
      // Gusting: the breeze surges and lulls instead of a flat constant push.
      // Two offset sines → an irregular gust factor roughly in [0.6, 1.9].
      const gust = 1.25
        + Math.sin(windClock * 0.7) * 0.45
        + Math.sin(windClock * 1.9 + 1.1) * 0.2;

      // 1) flowers: bloom in; at end of life, detach petals + start base wilt
      for (let i = flowers.length - 1; i >= 0; i -= 1) {
        const flower = flowers[i];
        const form = forms[flower.species];
        flower.age += dt;

        if (!flower.dying && flower.age >= flower.life) {
          flower.dying = true;
          for (const petal of flower.petalRecords) detach(form, petal);
          flower.petalRecords.length = 0;
        }

        if (flower.dying) {
          // shrink the bare stem+disc away, then drop the base + flower record
          const b = flower.base;
          b.fade = Math.max(0, b.fade - dt / 0.5);
          writeBase(form, b);
          if (b.fade <= 0) {
            removeBase(form, b.slot);
            const last = flowers.length - 1;
            if (i !== last) flowers[i] = flowers[last];
            flowers.pop();
          }
          continue;
        }

        if (flower.bloom < 1) {
          flower.bloom = Math.min(1, flower.bloom + dt * flower.bloomSpeed);
          for (const petal of flower.petalRecords) writeAttachedPetal(form, petal);
          writeBase(form, flower.base);
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

          const windRamp = Math.min(1, p.age / 0.6);
          p.flutter += dt * p.flutterRate;
          // Swirl: a slowly-rotating horizontal drift vector → looping path.
          const swirlX = Math.cos(p.flutter) * p.swirl;
          const swirlZ = Math.sin(p.flutter * 0.9 + 1.3) * p.swirl;

          // Buoyant lift that eases off as the petal tires, so it rises then
          // levels out high above the canopy instead of climbing forever.
          const lift = p.buoyancy * Math.exp(-p.age * 0.5);
          p.vy += (lift - 0.18) * dt;          // gentle net rise, slight settle late
          p.vy = THREE.MathUtils.clamp(p.vy, -0.15, 0.9);
          p.vx *= 0.985; p.vz *= 0.985;        // initial nudge bleeds off slowly

          const wx = WIND.x * p.windGain * windRamp * gust;
          const wz = WIND.y * p.windGain * windRamp * gust;
          p.x += (p.vx + wx + swirlX) * dt;
          p.y += p.vy * dt;
          p.z += (p.vz + wz + swirlZ) * dt;

          // Lively tumble — petals spin as they ride the air.
          p.rx += (p.dx + swirlX * 1.5) * dt;
          p.ry += p.dy * dt;
          p.rz += (p.dz + swirlZ * 1.5) * dt;

          const fadeOut = Math.min(1, (1 - p.age / p.life) / 0.55);
          p.fade = fadeOut;
          writeFreePetal(form, p);
        }
      }

      for (const form of forms) {
        form.petalMesh.instanceMatrix.needsUpdate = true;
        form.petalAttr.needsUpdate = true;
        form.baseMesh.instanceMatrix.needsUpdate = true;
        form.baseAttr.needsUpdate = true;
      }
    },
  };
}
