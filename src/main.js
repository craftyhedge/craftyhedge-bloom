import './styles.css';
import gsap from 'gsap';
import * as THREE from 'three/webgpu';
import { createTuftBlanket } from './foliage.js';

const canvas = document.querySelector('#scene');
const stats = document.querySelector('[data-scene-stats]');
const fallback = document.querySelector('[data-webgpu-fallback]');

const renderer = new THREE.WebGPURenderer({
  antialias: true,
  canvas,
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.03;
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x173f18);
scene.fog = new THREE.Fog(0x173f18, 13, 44);

const DESIGN_ASPECT = 16 / 9;
const DESIGN_VERTICAL_FOV = 42;
const camera = new THREE.PerspectiveCamera(DESIGN_VERTICAL_FOV, 1, 0.08, 80);
camera.position.set(0, 8.8, 8.1);
camera.lookAt(0, 0.35, -1.05);

const mossBase = createTuftBlanket({
  size: 44,
  spacing: 0.16,
  seed: 122,
  heightRange: [0.2, 0.42],
  widthRange: [1.1, 1.65],
  windRange: [0.006, 0.02],
  animated: false,
  shape: 'mat',
  yOffset: 0.16,
  hueRange: [0.26, 0.34],
  saturationRange: [0.54, 0.72],
  lightnessRange: [0.05, 0.14],
  brightnessRange: [0.5, 0.78],
  shadeRange: [0.58, 0.86],
  roughness: 1,
});

const mossFill = createTuftBlanket({
  size: 44,
  spacing: 0.16,
  seed: 151,
  heightRange: [0.24, 0.52],
  widthRange: [0.76, 1.18],
  windRange: [0.006, 0.026],
  animated: false,
  shape: 'mat',
  yOffset: 0.24,
  hueRange: [0.23, 0.32],
  saturationRange: [0.5, 0.72],
  lightnessRange: [0.08, 0.24],
  brightnessRange: [0.62, 0.92],
  shadeRange: [0.68, 0.98],
  roughness: 0.96,
});

const mossTop = createTuftBlanket({
  size: 44,
  spacing: 0.18,
  seed: 184,
  heightRange: [0.26, 0.74],
  widthRange: [0.64, 1.08],
  windRange: [0.12, 0.26],
  animated: true,
  windScale: 3.2,
  windSpeed: 1.0,
  yOffset: 0.3,
  hueRange: [0.21, 0.31],
  saturationRange: [0.58, 0.78],
  lightnessRange: [0.13, 0.42],
  brightnessRange: [0.82, 1.08],
  shadeRange: [0.72, 1.1],
  roughness: 0.86,
});

scene.add(mossBase.mesh, mossFill.mesh, mossTop.mesh);

const sun = new THREE.DirectionalLight(0xfff2c4, 5.2);
sun.position.set(-6, 15, 8);
sun.target.position.set(0, 0, -2);
scene.add(sun);
scene.add(sun.target);

const skyLight = new THREE.HemisphereLight(0xd7fff1, 0x101008, 0.9);
scene.add(skyLight);

const rim = new THREE.DirectionalLight(0xa8d8ff, 0.42);
rim.position.set(18, 12, -20);
scene.add(rim);

const cameraTarget = new THREE.Vector3(0, 0.35, -1.05);
const cameraHome = new THREE.Vector3(0, 8.8, 8.1);

function getCoverFov(aspect) {
  if (aspect <= DESIGN_ASPECT) {
    return DESIGN_VERTICAL_FOV;
  }

  const baseFovRadians = THREE.MathUtils.degToRad(DESIGN_VERTICAL_FOV);
  return THREE.MathUtils.radToDeg(2 * Math.atan((Math.tan(baseFovRadians * 0.5) * DESIGN_ASPECT) / aspect));
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.aspect = width / height;
  camera.fov = getCoverFov(camera.aspect);
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function updateCamera() {
  camera.position.copy(cameraHome);
  camera.lookAt(cameraTarget);
}

function animate() {
  updateCamera();
  renderer.render(scene, camera);
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

  if (stats) {
    const backend = navigator.gpu ? 'WebGPU' : 'WebGL2 fallback';
    const tuftCount = mossBase.mesh.count + mossFill.mesh.count + mossTop.mesh.count;
    stats.textContent = `${backend} / ${tuftCount.toLocaleString()} moss instances`;
  }

  gsap
    .timeline({ defaults: { ease: 'power3.out' } })
    .from('.scene-panel', { y: -18, opacity: 0, duration: 0.7 })
    .from('.scene-meter', { scaleX: 0, duration: 1.2, transformOrigin: 'left center' }, '-=0.35');
}

window.addEventListener('resize', resize);

start();
