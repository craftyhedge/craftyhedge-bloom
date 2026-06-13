import * as THREE from 'three/webgpu';

const HASH_SCALE = 43758.5453123;

function fract(value) {
  return value - Math.floor(value);
}

function hash2(x, z) {
  return fract(Math.sin(x * 127.1 + z * 311.7) * HASH_SCALE);
}

function fade(value) {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function valueNoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fade(fx);
  const v = fade(fz);

  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);

  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, u),
    THREE.MathUtils.lerp(c, d, u),
    v,
  );
}

export function fbm(x, z, octaves = 5) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;

  for (let i = 0; i < octaves; i += 1) {
    value += valueNoise(x * frequency, z * frequency) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }

  return value / total;
}

export function sampleTerrainHeight(x, z) {
  const broad = fbm(x * 0.025 + 12.4, z * 0.025 - 8.2, 5);
  const middle = fbm(x * 0.075 - 4.1, z * 0.075 + 9.7, 4);
  const detail = fbm(x * 0.24 + 1.7, z * 0.24 - 3.5, 3);
  const ridge = Math.sin(x * 0.11 + Math.cos(z * 0.08) * 1.6) * 0.34;

  return (broad - 0.45) * 7.2 + (middle - 0.5) * 2.15 + (detail - 0.5) * 0.55 + ridge;
}

export function sampleHedgeDensity(x, z) {
  const patches = fbm(x * 0.055 + 41.8, z * 0.055 - 19.6, 4);
  const lanes = Math.abs(Math.sin(x * 0.18 + fbm(x * 0.03, z * 0.03) * 5.5));
  const braided = 1 - THREE.MathUtils.smoothstep(lanes, 0.2, 0.66);
  const waves = 0.5 + Math.sin(z * 0.21 + patches * 4.8) * 0.5;

  return THREE.MathUtils.clamp(patches * 0.68 + braided * 0.42 + waves * 0.16, 0, 1);
}

function terrainColor(height, density) {
  const low = new THREE.Color(0x31412c);
  const moss = new THREE.Color(0x4f6f33);
  const bright = new THREE.Color(0x83a747);
  const earth = new THREE.Color(0x594735);

  const color = earth.clone().lerp(low, THREE.MathUtils.smoothstep(height, -3.8, 1.2));
  color.lerp(moss, density * 0.7);
  color.lerp(bright, Math.max(0, height * 0.055 + density * 0.18));
  return color;
}

export function createTerrain({ size = 92, segments = 176 } = {}) {
  const half = size * 0.5;
  const positions = [];
  const colors = [];
  const uvs = [];
  const indices = [];

  for (let zIndex = 0; zIndex <= segments; zIndex += 1) {
    const v = zIndex / segments;
    const z = THREE.MathUtils.lerp(-half, half, v);

    for (let xIndex = 0; xIndex <= segments; xIndex += 1) {
      const u = xIndex / segments;
      const x = THREE.MathUtils.lerp(-half, half, u);
      const y = sampleTerrainHeight(x, z);
      const density = sampleHedgeDensity(x, z);
      const color = terrainColor(y, density);

      positions.push(x, y, z);
      colors.push(color.r, color.g, color.b);
      uvs.push(u, v);
    }
  }

  for (let zIndex = 0; zIndex < segments; zIndex += 1) {
    for (let xIndex = 0; xIndex < segments; xIndex += 1) {
      const a = zIndex * (segments + 1) + xIndex;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;

      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0.9,
    vertexColors: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;

  return mesh;
}
