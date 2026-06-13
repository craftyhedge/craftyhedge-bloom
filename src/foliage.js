import * as THREE from 'three/webgpu';
import { Fn, attribute, clamp, cos, dot, float, min, mix, mul, output, positionLocal, sin, time, uniform, vec2, vec3, vec4, vertexColor } from 'three/tsl';
import { fbm, sampleHedgeDensity, sampleTerrainHeight } from './terrain.js';
import { createDappleNode } from './dapple.js';

const dummy = new THREE.Object3D();
const windAxis = new THREE.Vector3();

function createSeededRandom(seed = 7) {
  let value = seed;

  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pushCurvedLeaf({ positions, colors, indices, palette, root, right, forward, height, length, width, arch = 0.08, segments = 5 }) {
  const baseIndex = positions.length / 3;

  for (let segment = 0; segment <= segments; segment += 1) {
    const t = segment / segments;
    const widthT = Math.sin(t * Math.PI);
    const taper = THREE.MathUtils.lerp(0.52, 0.08, t);
    const bladeWidth = Math.max(0.018, width * Math.pow(widthT, 0.72) * taper);
    const center = root
      .clone()
      .add(forward.clone().multiplyScalar(length * (t + Math.sin(t * Math.PI) * 0.12)))
      .setY(root.y + height * t + Math.sin(t * Math.PI) * arch);
    const shade = THREE.MathUtils.clamp(t * (palette.length - 1), 0, palette.length - 1);
    const lo = Math.floor(shade);
    const hi = Math.min(palette.length - 1, lo + 1);
    const color = palette[lo].clone().lerp(palette[hi], shade - lo);

    positions.push(
      center.x - right.x * bladeWidth,
      center.y,
      center.z - right.z * bladeWidth,
      center.x + right.x * bladeWidth,
      center.y,
      center.z + right.z * bladeWidth,
    );
    colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
  }

  for (let segment = 0; segment < segments; segment += 1) {
    const a = baseIndex + segment * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;

    indices.push(a, c, b, b, c, d);
  }
}

function makeLeafClumpGeometry() {
  const positions = [];
  const colors = [];
  const indices = [];
  const leafColors = [
    new THREE.Color(0x071f08),
    new THREE.Color(0x1b4912),
    new THREE.Color(0x5f8d2f),
    new THREE.Color(0x91ad45),
  ];

  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2;
    const height = 0.5 + (i % 4) * 0.075;
    const width = 0.2 + (i % 3) * 0.028;
    const length = 0.08 + (i % 5) * 0.02;
    const right = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const forward = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
    // Spread the roots outward AND give each blade a unique small Y so the 12
    // near-horizontal strips don't pile up coplanar at the tuft centre. When they
    // shared the same depth plane there, the top-down depth test tied between
    // overlapping DoubleSide blades and the per-pixel winner flipped as the wind
    // nudged them — that depth-fight flicker was the white pixel sparkle (it was
    // never a shading effect, which is why no material change touched it).
    const root = forward.clone().multiplyScalar(0.05 + (i % 3) * 0.03).setY(i * 0.006);

    pushCurvedLeaf({
      positions,
      colors,
      indices,
      palette: leafColors,
      root,
      right,
      forward,
      height,
      length,
      width,
      arch: 0.08,
      segments: 6,
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  return geometry;
}

function makeMossMatGeometry() {
  const positions = [];
  const colors = [];
  const indices = [];
  const leafColors = [
    new THREE.Color(0x051506),
    new THREE.Color(0x12310d),
    new THREE.Color(0x315f1b),
    new THREE.Color(0x587b2a),
  ];

  for (let i = 0; i < 18; i += 1) {
    const angle = (i / 18) * Math.PI * 2 + (i % 2) * 0.11;
    const length = 0.56 + (i % 5) * 0.065;
    const width = 0.28 + (i % 4) * 0.04;
    const right = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const forward = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
    // Unique per-blade Y so the strips don't sit coplanar at one depth plane and
    // z-fight from the top-down view (the wind-flicker sparkle).
    const root = forward.clone().multiplyScalar(0.04 + (i % 3) * 0.018).setY(0.01 + i * 0.004);

    pushCurvedLeaf({
      positions,
      colors,
      indices,
      palette: leafColors,
      root,
      right,
      forward,
      height: 0.06 + (i % 4) * 0.018,
      length,
      width,
      arch: 0.05,
      segments: 5,
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  return geometry;
}

function setClumpMatrix(clump, time = 0) {
  // Clean sine wind matching the shader approach (smooth, no negative swings or noise artifacts).
  // Uses global windAngle per clump for this (legacy) foliage type.
  const windDirX = Math.sin(clump.windAngle);
  const windDirZ = Math.cos(clump.windAngle);

  const phase = clump.x * windDirX + clump.z * windDirZ;
  const t = time;

  const w1 = Math.sin(t * 0.82 + phase * 0.72);
  const w2 = Math.sin(t * 1.47 + phase * 1.18 + 1.9) * 0.55;
  const w3 = Math.sin(t * 2.65 + phase * 0.35 + clump.phase * 0.8) * 0.35;

  const windSway = (w1 + w2 + w3) * clump.windStrength * 0.09;

  windAxis.set(windDirX, 0, windDirZ).normalize();

  // Transient "growth push": a nearby flower breaking ground shoves the tuft
  // outward (px/pz) and tips it away from the source. push in [0,1], eases to 0.
  const push = clump.push || 0;
  const pushX = (clump.pushX || 0) * push;
  const pushZ = (clump.pushZ || 0) * push;

  dummy.position.set(
    clump.x + windAxis.x * windSway + pushX,
    clump.y,
    clump.z + windAxis.z * windSway + pushZ,
  );
  dummy.rotation.set(
    windAxis.z * windSway * 0.85 + pushZ * 0.9,
    clump.rotation + Math.sin(time * 0.24 + clump.phase) * 0.06,
    -windAxis.x * windSway * 0.85 - pushX * 0.9,
  );
  dummy.scale.set(clump.width, clump.height, clump.width * clump.depth);
  dummy.updateMatrix();

  return dummy.matrix;
}

function createWindMaterial({
  roughness = 0.9,
  emissive = 0x000000,
  emissiveIntensity = 0,
  windDirection = new THREE.Vector2(0.58, 0.82).normalize(),
  windScale = 1,
  windSpeed = 1.55,
  windTurbulence = 0.3,
  dapple = null,
} = {}) {
  // Lambert (diffuse-only), NOT Standard. MeshStandardNodeMaterial always carries
  // a 0.04 dielectric specular term whose Fresnel lifts toward 1.0 at grazing
  // angles — on the near-flat blade tops under the strong key light that produced
  // bright specular glints, and because the blades sway those glints flickered
  // per pixel: the white sparkle. Lambert has no specular lobe at all, so the
  // highlight simply never forms. Foliage doesn't need specular anyway.
  const material = new THREE.MeshLambertNodeMaterial({
    color: 0xffffff,
    emissive,
    emissiveIntensity,
    side: THREE.DoubleSide,
    vertexColors: true,
  });

  const direction = uniform(windDirection);
  const scale = uniform(windScale);
  const speed = uniform(windSpeed);
  const turbulence = uniform(windTurbulence);

  // Clean, proven sine-based wind (standard approach from good grass/foliage shaders).
  // Layered sines create smooth traveling gusts without sharp noise fronts or visible cells.
  // No value noise for primary motion — noise produces the "sharp wind fronts" problem.
  material.positionNode = Fn(() => {
    const windData = attribute('windData', 'vec4');
    const windPhase = attribute('windPhase', 'float');
    const windAvoidance = attribute('windAvoidance', 'vec3');
    const origin = windData.xy;
    const rot = windData.z;
    const response = windData.w;

    const localPosition = positionLocal;
    const worldXZ = origin.add(vec2(localPosition.x, localPosition.z));

    // Global coherent phase: makes waves propagate along the wind direction
    const phase = dot(worldXZ, direction);
    const crossDirection = vec2(direction.y.mul(-1), direction.x);
    const crossPhase = dot(worldXZ, crossDirection);
    const t = time.mul(speed);

    // Three smooth sine layers at different freqs = organic gusting (no hard edges)
    // Frequencies and offsets chosen to interfere into natural rolling wind.
    const w1 = sin(t.mul(0.82).add(phase.mul(0.72)));
    const w2 = sin(t.mul(1.47).add(phase.mul(1.18)).add(1.9)).mul(0.55);
    const w3 = sin(t.mul(2.65).add(phase.mul(0.35)).add(windPhase.mul(0.8))).mul(0.35);

    const windSway = w1.add(w2).add(w3); // smooth ~[-1.9, 1.9] range before scaling
    const crossSway = sin(t.mul(0.53).add(crossPhase.mul(0.86)).add(0.7))
      .add(sin(t.mul(1.21).sub(phase.mul(0.41)).add(windPhase)).mul(0.45));

    const h = localPosition.y;
    const bendWeight = clamp(h.div(0.65), 0, 1);
    const bend = bendWeight.mul(bendWeight.mul(0.9).add(0.1));

    // Scale the effect. response = per-clump windStrength from windRange.
    const sway = response.mul(windSway).mul(0.055).mul(scale);

    const lateral = bend.mul(sway);
    const crossLateral = bend.mul(response).mul(crossSway).mul(0.055).mul(scale).mul(turbulence);

    // Slight tip droop + subtle base counter for natural curve
    const vert = bend.mul(bendWeight).mul(sway).mul(-0.055).add(
      float(1).sub(bendWeight).mul(sway).mul(0.012)
    );

    // Remove only the component of wind that points into a nearby solid edge.
    // Tangential and outward motion remain, so foliage still moves beside rocks.
    const avoidanceNormal = windAvoidance.xy;
    const rawWorldWind = direction.mul(lateral).add(crossDirection.mul(crossLateral));
    const inward = min(dot(rawWorldWind, avoidanceNormal), 0).mul(windAvoidance.z);
    const worldWind = rawWorldWind.sub(avoidanceNormal.mul(inward));

    // Convert desired world sway into the tuft's local space.
    // This ensures *every* tuft sways in the exact same global wind direction,
    // regardless of how the tuft was randomly rotated when placed.
    const c = cos(rot);
    const s = sin(rot);
    // R(-rot) * direction
    const localWindX = worldWind.x.mul(c).add(worldWind.y.mul(s));
    const localWindZ = worldWind.x.mul(s.mul(-1)).add(worldWind.y.mul(c));

    return localPosition.add(vec3(
      localWindX,
      vert,
      localWindZ,
    ));
  })();

  if (dapple) {
    // Multiply the dapple gobo into the per-instance vertex color so the same
    // light pools that fall on the ground also brighten/darken the moss tufts.
    material.colorNode = mul(vertexColor(), createDappleNode(dapple));
  }

  // Safety ceiling on the final shaded colour so no tuft pixel can blow out to
  // pure white even from strong sky/key fill. Lambert already removes the
  // specular glint that caused the sparkle; this just caps the diffuse peak.
  material.outputNode = vec4(min(output.rgb, vec3(0.9)), output.a);

  return material;
}

export function createFoliageField({
  count = 11000,
  size = 88,
  seed = 18,
  minCoverage = 0,
  densityPower = 1.45,
  heightRange = [0.7, 1.8],
  widthRange = [0.46, 1.15],
  colorLightnessRange = [0.2, 0.42],
  windRange = [0.045, 0.18],
} = {}) {
  const random = createSeededRandom(seed);
  const geometry = makeLeafClumpGeometry();
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0.82,
    side: THREE.DoubleSide,
    vertexColors: true,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const clumps = [];
  const half = size * 0.5;
  const color = new THREE.Color();

  let attempts = 0;
  while (clumps.length < count && attempts < count * 18) {
    attempts += 1;

    const x = (random() * 2 - 1) * half;
    const z = (random() * 2 - 1) * half;
    const density = sampleHedgeDensity(x, z);
    const edgeFade = 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(x), Math.abs(z)), half * 0.82, half);
    const acceptance = Math.max(minCoverage, Math.pow(density, densityPower)) * edgeFade;

    if (random() > acceptance) {
      continue;
    }

    const y = sampleTerrainHeight(x, z) + 0.02;
    const localMass = fbm(x * 0.12 + 8.2, z * 0.12 - 5.7, 3);
    const height = THREE.MathUtils.lerp(heightRange[0], heightRange[1], density) * THREE.MathUtils.lerp(0.76, 1.24, random());
    const width = THREE.MathUtils.lerp(widthRange[0], widthRange[1], localMass) * THREE.MathUtils.lerp(0.72, 1.18, random());

    clumps.push({
      x,
      y,
      z,
      width,
      height,
      depth: THREE.MathUtils.lerp(0.74, 1.28, random()),
      rotation: random() * Math.PI * 2,
      phase: random() * Math.PI * 2,
      speed: THREE.MathUtils.lerp(1.35, 2.65, random()),
      windAngle: THREE.MathUtils.lerp(0.74, 1.16, random()),
      windStrength: THREE.MathUtils.lerp(windRange[0], windRange[1], random()) * THREE.MathUtils.lerp(0.7, 1.5, density),
      density,
    });
  }

  mesh.count = clumps.length;

  for (let i = 0; i < clumps.length; i += 1) {
    const clump = clumps[i];
    mesh.setMatrixAt(i, setClumpMatrix(clump));

    color
      .setHSL(
        THREE.MathUtils.lerp(0.22, 0.31, random()),
        THREE.MathUtils.lerp(0.42, 0.68, random()),
        THREE.MathUtils.lerp(colorLightnessRange[0], colorLightnessRange[1], clump.density),
      )
      .multiplyScalar(THREE.MathUtils.lerp(0.82, 1.2, random()));
    mesh.setColorAt(i, color);
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }

  mesh.castShadow = false;
  mesh.receiveShadow = false;

  return {
    mesh,
    clumps,
    update(time) {
      for (let i = 0; i < clumps.length; i += 1) {
        mesh.setMatrixAt(i, setClumpMatrix(clumps[i], time));
      }

      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

export function createTuftBlanket({
  size = 38,
  width = size,
  depth = size,
  centerX = 0,
  centerZ = 0,
  visibilityTest = null,
  spacing = 0.34,
  seed = 91,
  heightRange = [0.22, 0.62],
  widthRange = [0.24, 0.54],
  windRange = [0.018, 0.08],
  animated = true,
  shape = 'upright',
  yOffset = 0.04,
  hueRange = [0.24, 0.34],
  saturationRange = [0.5, 0.78],
  lightnessRange = [0.16, 0.5],
  brightnessRange = [0.82, 1.18],
  shadeRange = [0.88, 1.06],
  lightDirection = 2.45,
  roughness = 0.9,
  emissive = 0x000000,
  emissiveIntensity = 0,
  windScale = 1,
  windSpeed = 1.55,
  windTurbulence = 0.3,
  dapple = null,
} = {}) {
  const random = createSeededRandom(seed);
  const cellsX = Math.ceil(width / spacing);
  const cellsZ = Math.ceil(depth / spacing);
  const halfWidth = width * 0.5;
  const halfDepth = depth * 0.5;
  const geometry = shape === 'mat' ? makeMossMatGeometry() : makeLeafClumpGeometry();
  const material = createWindMaterial({
    roughness,
    emissive,
    emissiveIntensity,
    windScale,
    windSpeed,
    windTurbulence,
    dapple,
  });
  const clumps = [];

  for (let zIndex = 0; zIndex < cellsZ; zIndex += 1) {
    for (let xIndex = 0; xIndex < cellsX; xIndex += 1) {
      const x = centerX - halfWidth + (xIndex + 0.5) * spacing + (random() - 0.5) * spacing * 0.72;
      const z = centerZ - halfDepth + (zIndex + 0.5) * spacing + (random() - 0.5) * spacing * 0.72;
      if (visibilityTest && !visibilityTest(x, z)) continue;

      const density = THREE.MathUtils.lerp(0.72, 1, sampleHedgeDensity(x, z));
      const localMass = fbm(x * 0.21 + 2.4, z * 0.21 - 7.8, 3);
      const height = THREE.MathUtils.lerp(heightRange[0], heightRange[1], density) * THREE.MathUtils.lerp(0.82, 1.18, random());
      const width = THREE.MathUtils.lerp(widthRange[0], widthRange[1], localMass) * THREE.MathUtils.lerp(0.86, 1.2, random());
      clumps.push({
        x,
        y: yOffset,
        z,
        width,
        height,
        depth: THREE.MathUtils.lerp(0.82, 1.18, random()),
        rotation: random() * Math.PI * 2,
        phase: random() * Math.PI * 2,
        speed: THREE.MathUtils.lerp(1.1, 2.2, random()),
        windAngle: THREE.MathUtils.lerp(0.62, 1.28, random()),
        windStrength: THREE.MathUtils.lerp(windRange[0], windRange[1], random()),
        density,
      });
    }
  }

  const count = clumps.length;
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const color = new THREE.Color();
  const windData = new Float32Array(count * 4);
  const windPhase = new Float32Array(count);
  const windAvoidance = new Float32Array(count * 3);
  mesh.count = clumps.length;

  for (let i = 0; i < clumps.length; i += 1) {
    const clump = clumps[i];
    mesh.setMatrixAt(i, setClumpMatrix(clump));
    const windIndex = i * 4;
    windData[windIndex] = clump.x;
    windData[windIndex + 1] = clump.z;
    windData[windIndex + 2] = clump.rotation;
    windData[windIndex + 3] = animated ? clump.windStrength : 0;
    windPhase[i] = clump.phase;
    const heightT = THREE.MathUtils.clamp((clump.height - heightRange[0]) / (heightRange[1] - heightRange[0]), 0, 1);
    const facing = 0.5 + Math.cos(clump.rotation - lightDirection) * 0.5;
    const depthShade = THREE.MathUtils.lerp(shadeRange[0], shadeRange[1], heightT * 0.72 + facing * 0.28);

    color
      .setHSL(
        THREE.MathUtils.lerp(hueRange[0], hueRange[1], clump.density),
        THREE.MathUtils.lerp(saturationRange[0], saturationRange[1], heightT),
        THREE.MathUtils.lerp(lightnessRange[0], lightnessRange[1], heightT),
      )
      .multiplyScalar(THREE.MathUtils.lerp(brightnessRange[0], brightnessRange[1], facing) * depthShade);
    mesh.setColorAt(i, color);
  }

  geometry.setAttribute('windData', new THREE.InstancedBufferAttribute(windData, 4));
  geometry.setAttribute('windPhase', new THREE.InstancedBufferAttribute(windPhase, 1));
  geometry.setAttribute('windAvoidance', new THREE.InstancedBufferAttribute(windAvoidance, 3));

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }

  mesh.castShadow = false;
  mesh.receiveShadow = true;

  // --- growth-push state ----------------------------------------------------
  // A uniform spatial grid over the clumps so a flower spawn only touches the
  // handful of tufts within its reach instead of scanning all of them. Cell
  // size ~ the push radius. Disturbed clumps live in `active` and decay there.
  const PUSH_RADIUS = 0.55;          // how far a growth event reaches (world units)
  const PUSH_AMOUNT = 0.07;          // peak outward shove (subtle)
  const PUSH_RISE = 9;              // 1/sec — how fast the swell eases in (fast, not instant)
  const PUSH_DECAY = 2.6;            // 1/sec — settles back in ~0.4s
  const cell = PUSH_RADIUS;
  const grid = new Map();
  const gridKey = (cx, cz) => `${cx},${cz}`;
  const active = new Set();
  // (Re)build the lookup grid and sync each clump's instance index. Must run
  // after any reordering of `clumps` (e.g. removeWhere) or `update` would write
  // a push to a stale slot — a tuft you never touched would lurch.
  function rebuildGrid() {
    grid.clear();
    active.clear();
    for (let i = 0; i < clumps.length; i += 1) {
      const c = clumps[i];
      c.index = i;
      c.push = 0;
      c.pushTarget = 0;
      const k = gridKey(Math.floor(c.x / cell), Math.floor(c.z / cell));
      let bucket = grid.get(k);
      if (!bucket) { bucket = []; grid.set(k, bucket); }
      bucket.push(c);
    }
  }
  rebuildGrid();

  return {
    mesh,
    clumps,
    pushFrom(x, z, strength = 1) {
      const cx = Math.floor(x / cell);
      const cz = Math.floor(z / cell);
      const r2 = PUSH_RADIUS * PUSH_RADIUS;
      for (let gx = cx - 1; gx <= cx + 1; gx += 1) {
        for (let gz = cz - 1; gz <= cz + 1; gz += 1) {
          const bucket = grid.get(gridKey(gx, gz));
          if (!bucket) continue;
          for (const c of bucket) {
            const dx = c.x - x;
            const dz = c.z - z;
            const d2 = dx * dx + dz * dz;
            if (d2 >= r2 || d2 === 0) continue;
            const d = Math.sqrt(d2);
            // Closer tufts shove harder; normalise the direction to outward.
            const falloff = (1 - d / PUSH_RADIUS) * strength;
            // Keep the strongest concurrent push rather than summing (avoids a
            // tuft caught between two flowers launching twice as far). Direction
            // is the unit outward vector scaled by peak amount; setClumpMatrix
            // re-scales it by the live (decaying) `push` factor each frame.
            if (falloff > (c.pushTarget || 0)) {
              c.pushTarget = falloff;
              c.pushX = (dx / d) * PUSH_AMOUNT;
              c.pushZ = (dz / d) * PUSH_AMOUNT;
            }
            active.add(c);
          }
        }
      }
    },
    update(dt = 0) {
      if (active.size === 0) return;
      for (const c of active) {
        // Two-stage easing so the tuft neither pops out nor pops back:
        //  - `push` chases `pushTarget` quickly (the swell as growth shoulders in)
        //  - `pushTarget` itself relaxes to 0 (the slow settle once it's grown)
        // The result is a smooth round-trip rather than an instant displacement.
        const target = c.pushTarget || 0;
        c.push = (c.push || 0) + (target - (c.push || 0)) * Math.min(1, PUSH_RISE * dt);
        c.pushTarget = Math.max(0, target - PUSH_DECAY * dt);
        // Rewrite from the same rest pose (time 0) the blanket was baked at,
        // plus the live push — the per-vertex sway is the shader's job, so we
        // must NOT re-inject CPU wind here or the tuft would move twice.
        mesh.setMatrixAt(c.index, setClumpMatrix(c, 0));
        if (c.push < 0.001 && c.pushTarget <= 0) { c.push = 0; c.pushTarget = 0; active.delete(c); }
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    removeWhere(predicate) {
      const originalCount = clumps.length;
      let writeIndex = 0;

      for (let readIndex = 0; readIndex < clumps.length; readIndex += 1) {
        const clump = clumps[readIndex];
        if (predicate(clump.x, clump.z)) continue;

        if (writeIndex !== readIndex) {
          clumps[writeIndex] = clump;
          mesh.setMatrixAt(writeIndex, setClumpMatrix(clump));
          mesh.getColorAt(readIndex, color);
          mesh.setColorAt(writeIndex, color);

          const writeWindIndex = writeIndex * 4;
          const readWindIndex = readIndex * 4;
          windData[writeWindIndex] = windData[readWindIndex];
          windData[writeWindIndex + 1] = windData[readWindIndex + 1];
          windData[writeWindIndex + 2] = windData[readWindIndex + 2];
          windData[writeWindIndex + 3] = windData[readWindIndex + 3];
          windPhase[writeIndex] = windPhase[readIndex];

          const writeAvoidanceIndex = writeIndex * 3;
          const readAvoidanceIndex = readIndex * 3;
          windAvoidance[writeAvoidanceIndex] = windAvoidance[readAvoidanceIndex];
          windAvoidance[writeAvoidanceIndex + 1] = windAvoidance[readAvoidanceIndex + 1];
          windAvoidance[writeAvoidanceIndex + 2] = windAvoidance[readAvoidanceIndex + 2];
        }

        writeIndex += 1;
      }

      clumps.length = writeIndex;
      mesh.count = writeIndex;
      // Clumps were reordered — resync indices and the push grid to match.
      rebuildGrid();
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      geometry.getAttribute('windData').needsUpdate = true;
      geometry.getAttribute('windPhase').needsUpdate = true;
      geometry.getAttribute('windAvoidance').needsUpdate = true;

      return originalCount - writeIndex;
    },
    setWindAvoidance(sampleAvoidance) {
      for (let i = 0; i < clumps.length; i += 1) {
        const clump = clumps[i];
        const avoidance = sampleAvoidance(clump.x, clump.z);
        const index = i * 3;
        windAvoidance[index] = avoidance.x;
        windAvoidance[index + 1] = avoidance.z;
        windAvoidance[index + 2] = avoidance.influence;
      }

      geometry.getAttribute('windAvoidance').needsUpdate = true;
    },
  };
}

export function createHedgeMounds({ count = 220, size = 78, heightScale = 1, densityPower = 2.25 } = {}) {
  const random = createSeededRandom(43);
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const material = new THREE.MeshStandardMaterial({
    color: 0x4f7a35,
    metalness: 0,
    roughness: 0.95,
    flatShading: true,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const half = size * 0.5;
  let placed = 0;

  for (let attempts = 0; placed < count && attempts < count * 16; attempts += 1) {
    const x = (random() * 2 - 1) * half;
    const z = (random() * 2 - 1) * half;
    const density = sampleHedgeDensity(x, z);

    if (random() > Math.pow(density, densityPower)) {
      continue;
    }

    const y = sampleTerrainHeight(x, z) + 0.02;
    const scale = THREE.MathUtils.lerp(0.45, 1.8, random()) * THREE.MathUtils.lerp(0.75, 1.35, density);

    dummy.position.set(x, y, z);
    dummy.rotation.set(random() * 0.25, random() * Math.PI * 2, random() * 0.18);
    dummy.scale.set(
      scale * THREE.MathUtils.lerp(1.1, 2.2, random()),
      scale * THREE.MathUtils.lerp(0.35, 0.75, random()) * heightScale,
      scale,
    );
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);
    placed += 1;
  }

  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.receiveShadow = false;
  mesh.castShadow = false;

  return mesh;
}
