import * as THREE from 'three/webgpu';
import { Fn, abs, bitXor, clamp, float, floor, fract, int, mix, positionWorld, shiftRight, sin, smoothstep, time, uint, uniform, vec2, vec3 } from 'three/tsl';

// Procedural "dappled light through a tree" gobo.
//
// The pattern is evaluated in a 2D plane and *projected* from the sun direction,
// so the same light pools fall coherently across the flat moss AND (optionally)
// climb onto the raised rock letters the way a real cast shadow would.
//
// Rather than a flat brightness multiply (which only ever darkens the scene),
// this returns a *warm tint multiplier*: shadow gaps cool/dim slightly, open sun
// pools warm and brighten above 1.0 — so the net effect reads as a sunny day
// with leaf shadow drifting across it, not an overall darkening.

// Integer bit-mangling hash (no sin!). The old fract(sin(dot)*43758) hash relied
// on WGSL sin() being accurate for arguments in the tens-of-thousands range — it
// is NOT (sin is only reliable near [-pi, pi]; large args degrade to a piecewise
// approximation). That turned the "random" hash into a smooth low-frequency ramp,
// so fract() of it produced linear sawtooth -> flat tonal facets with straight
// diagonal edges across the letters. This integer scramble has no transcendental
// dependence, so the noise is actually random. Input p is a grid cell (integers).
const hash = Fn(([p]) => {
  // Pack the 2D integer cell into one uint and run an xorshift-multiply mix.
  let n = uint(int(p.x)).mul(uint(374761393)).add(uint(int(p.y)).mul(uint(668265263)));
  n = bitXor(n, shiftRight(n, uint(13)));
  n = n.mul(uint(1274126177));
  n = bitXor(n, shiftRight(n, uint(16)));
  // Map the top bits to [0,1).
  return float(n).mul(1.0 / 4294967296.0);
});

const valueNoise = Fn(([p]) => {
  const i = floor(p);
  const f = fract(p);
  // Quintic fade (6t^5 - 15t^4 + 10t^3), not cubic smoothstep. Cubic value noise
  // is only C0: its VALUE is continuous across cell boundaries but its GRADIENT
  // is not, so a thresholded result shows hard creases along the axis-aligned
  // floor() grid lines (the straight tonal blocks across the letter faces).
  // Quintic is C2 -> continuous gradient -> no grid creases.
  const u = f.mul(f).mul(f).mul(f.mul(f.mul(6).sub(15)).add(10));

  const a = hash(i);
  const b = hash(i.add(vec2(1, 0)));
  const c = hash(i.add(vec2(0, 1)));
  const d = hash(i.add(vec2(1, 1)));

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});

/**
 * Returns a TSL vec3 multiplier centered around white: open sun pools push warm
 * and slightly >1 (brighter), leaf shadow pulls toward `shadeColor` and `shadeMin`.
 * Multiply it into a material's colorNode.
 *
 * @param {object} opts
 * @param {THREE.Vector3} opts.sunDirection  Direction the light travels (sun -> scene).
 * @param {number} [opts.scale]      Pattern frequency (higher = smaller leaf gaps).
 * @param {number} [opts.shadeMin]   Darkest the shadow gets (0..1).
 * @param {number} [opts.sunBoost]   How much brighter open pools get (0 = no boost).
 * @param {number} [opts.coverage]   Shadow(0) vs light(1) bias. ~0.5 balanced.
 * @param {number} [opts.swaySpeed]  Speed of the in-place flutter (no translation).
 * @param {number} [opts.swayAmount] How far the canopy sways (in pattern units).
 * @param {number} [opts.fadeHeight] World height over which the dapple fades out.
 *                                   0 disables fading (full strength everywhere).
 *                                   >0 keeps crisp shadow at the ground contact and
 *                                   eases it to nothing by this height — so tall hard
 *                                   geometry (the letters) reads as cleanly sunlit
 *                                   instead of showing tonal seams at its corners.
 * @param {THREE.Color} [opts.sunColor]   Warm tint of the sun pools.
 * @param {THREE.Color} [opts.shadeColor] Cool tint of the shadow gaps.
 */
export function createDappleNode({
  sunDirection,
  scale = 0.42,
  shadeMin = 0.62,
  sunBoost = 0.26,
  coverage = 0.5,
  swaySpeed = 0.6,
  swayAmount = 0.12,
  fadeHeight = 0,
  project = true,
  clampMax = 4,
  sunColor = new THREE.Color(0xfff0c8),
  shadeColor = new THREE.Color(0x6f86a8),
} = {}) {
  // Cast-shadow projection: every fragment is shifted along the sun ray by its
  // height, so the SAME shadow shape stays continuous across a letter's cap, down
  // its walls, and onto the ground.
  //
  // BUT projection makes the gobo sample depend on positionWorld.y, which is
  // interpolated per-fragment across the mesh's triangles. On coarsely tessellated
  // hard-edged geometry (the bevelled letters) that y-dependence snaps the
  // smoothstep into straight tonal creases along facet edges. So projection is
  // right for the flat ground but wrong for the letters: set project:false there
  // to sample by plain world XZ (no y term, no facet leakage). The letters are
  // small vs. the leaf-gap scale, so the dapple still reads as coherent on them.
  // dir.y is negative (light descends), so negate for a positive descent.
  const downY = Math.max(1e-3, -sunDirection.y);
  const slope = uniform(new THREE.Vector2(
    project ? sunDirection.x / downY : 0,
    project ? sunDirection.z / downY : 0,
  ));
  const freq = uniform(scale);
  const sway = uniform(swayAmount);
  const swaySpd = uniform(swaySpeed);
  const minShade = uniform(shadeMin);
  const boost = uniform(sunBoost);
  const cover = uniform(coverage);
  const fade = uniform(fadeHeight);
  const sun = uniform(sunColor);
  const shade = uniform(shadeColor);

  return Fn(() => {
    // Project to the ground footprint the sun ray passes through at this height.
    const projected = vec2(
      positionWorld.x.sub(positionWorld.y.mul(slope.x)),
      positionWorld.z.sub(positionWorld.y.mul(slope.y)),
    ).mul(freq);

    // The canopy SWAYS in place — a small looping offset, NOT a translation. The
    // pattern stays anchored to the world and just shimmers, like leaves moving
    // in a breeze rather than the whole tree sliding across the lawn.
    const t = time;
    const swayOffset = vec2(
      sin(t.mul(swaySpd)),
      sin(t.mul(swaySpd).mul(0.77).add(2.1)),
    ).mul(sway);
    const anchored = projected.add(swayOffset);

    // Rotate once so leaf and branch structures do not inherit the noise grid.
    const rotated = vec2(
      anchored.x.mul(0.85).sub(anchored.y.mul(0.53)),
      anchored.x.mul(0.53).add(anchored.y.mul(0.85)),
    );
    const broad = valueNoise(anchored.mul(0.72));
    const middle = valueNoise(rotated.mul(1.45).add(vec2(4.6, -2.8)));
    const fine = valueNoise(rotated.mul(2.3).add(vec2(
      sin(t.mul(swaySpd).mul(1.3)).mul(0.18),
      sin(t.mul(swaySpd).mul(1.1).add(1.7)).mul(0.18),
    )));

    // Branches are smooth distance fields around finite, gently curved paths.
    // Noise only bends the centreline; it never defines the edge, so stretching
    // cannot expose square interpolation cells as blocky shadow shapes.
    const branchWarp = valueNoise(rotated.mul(0.38).add(vec2(7.3, -4.1))).sub(0.5);
    const trunkAxis = rotated.y.mul(0.42)
      .sub(sin(rotated.x.mul(0.48).add(branchWarp.mul(1.8))).mul(0.34))
      .add(0.12);
    const trunkGate = smoothstep(-3.8, -2.4, rotated.x)
      .mul(float(1).sub(smoothstep(2.2, 3.6, rotated.x)));
    const trunk = float(1).sub(smoothstep(0.045, 0.18, abs(trunkAxis))).mul(trunkGate);

    const forkAxis = rotated.y.mul(0.58)
      .sub(rotated.x.mul(0.22))
      .sub(sin(rotated.x.mul(0.62).add(1.7)).mul(0.2))
      .sub(0.42);
    const forkGate = smoothstep(-1.8, -0.6, rotated.x)
      .mul(float(1).sub(smoothstep(2.4, 3.25, rotated.x)));
    const fork = float(1).sub(smoothstep(0.035, 0.13, abs(forkAxis))).mul(forkGate);
    const branchShadow = clamp(trunk.mul(0.7).add(fork.mul(0.48)), 0, 1);

    const leafLight = broad.mul(0.34).add(middle.mul(0.34)).add(fine.mul(0.32));
    const canopy = leafLight.mul(float(1).sub(branchShadow.mul(0.68)));

    // Soft light pools with a wide penumbra: a generous smoothstep band so pool
    // edges feather gently instead of snapping to a hard line. coverage shifts
    // the midpoint (lower = more shadow, higher = more open sun).
    const lo = cover.sub(0.32);
    const hi = cover.add(0.32);
    const rawLight = smoothstep(lo, hi, canopy); // 0 = shadow, 1 = open sun

    // Fade the shadow out with height. A cast shadow's penumbra widens (softens)
    // the further it's thrown; on hard-edged geometry that softening is also what
    // prevents tonal seams at corners. We ease the gobo toward fully-open (1) as
    // worldY rises, so the crisp shadow lives at the ground contact and the tops
    // of the letters read as clean sunlit stone. fade=0 keeps full strength.
    const heightFade = fadeHeight > 0
      ? clamp(positionWorld.y.div(fade), 0, 1)
      : float(0);
    const light = mix(rawLight, float(1), heightFade);

    // Brightness: dip toward shadeMin in gaps, lift above 1 in open pools.
    const brightness = mix(minShade, float(1).add(boost), light);

    // Warm/cool tint that tracks the same mask, kept near white so it tints
    // rather than recolors.
    const tint = mix(shade, sun, light);

    // The dapple is a >1 multiplier in open sun (warm tint * brightness up to
    // 1+boost). On the ground and letters that lift is the desired sunny look.
    // On the moss tufts it multiplied already-bright tip vertex colours past 1.0,
    // tone-mapping isolated tips to white — and because the pattern sways and the
    // tufts blow in the wind, those over-bright tips flickered: the pixel sparkle.
    // clampMax caps the per-channel multiplier so the dapple can still darken into
    // shadow but never push a tuft above its own colour. Callers that want the sun
    // boost (ground, rock) leave clampMax high; the tufts pass 1.0.
    return clamp(tint.mul(brightness), vec3(0), vec3(clampMax));
  })();
}
