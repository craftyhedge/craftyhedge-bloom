import './styles.css';
import gsap from 'gsap';
import * as THREE from 'three';

const canvas = document.querySelector('#scene');
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
  canvas,
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 0, 5);

const geometry = new THREE.IcosahedronGeometry(1.35, 8);
const material = new THREE.MeshStandardMaterial({
  color: 0x2dd4bf,
  emissive: 0x0f766e,
  emissiveIntensity: 0.28,
  metalness: 0.32,
  roughness: 0.18,
  wireframe: true,
});

const form = new THREE.Mesh(geometry, material);
scene.add(form);

const keyLight = new THREE.PointLight(0xffffff, 18, 12);
keyLight.position.set(3, 4, 5);
scene.add(keyLight);

const fillLight = new THREE.PointLight(0x38bdf8, 10, 9);
fillLight.position.set(-4, -2, 3);
scene.add(fillLight);

const pointer = {
  x: 0,
  y: 0,
};

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function animate() {
  form.rotation.x += 0.0025 + pointer.y * 0.0008;
  form.rotation.y += 0.004 + pointer.x * 0.0008;
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function handlePointerMove(event) {
  pointer.x = (event.clientX / window.innerWidth - 0.5) * 2;
  pointer.y = (event.clientY / window.innerHeight - 0.5) * 2;

  gsap.to(form.position, {
    x: pointer.x * 0.22,
    y: pointer.y * -0.18,
    duration: 0.7,
    ease: 'power3.out',
  });
}

window.addEventListener('resize', resize);
window.addEventListener('pointermove', handlePointerMove);

resize();
animate();

gsap
  .timeline({ defaults: { ease: 'power3.out' } })
  .from('.eyebrow', { y: 18, opacity: 0, duration: 0.7 })
  .from('.headline', { y: 28, opacity: 0, duration: 0.9 }, '-=0.35')
  .from('.intro', { y: 20, opacity: 0, duration: 0.7 }, '-=0.45')
  .from('.actions', { y: 18, opacity: 0, duration: 0.6 }, '-=0.35')
  .from('.feature', { y: 28, opacity: 0, stagger: 0.12, duration: 0.7 }, '-=0.15');
