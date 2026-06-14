# Crafty Hedge Bloom

![CRAFTY HEDGE rendered as stone lettering on moss, ringed with colourful blooms](docs/preview.webp)

**▶ [Live demo](https://craftyhedge.github.io/craftyhedge-bloom/)**

Performance may vary.

A bit of fun. This started as an excuse to play with **WebGPU** and Three.js.

Sweep your pointer across the hedge and blooms break ground in your wake. Come back to a
patch you've already grown and it cultivates over repeated visits — denser, taller, more
elaborate arrangements — so the hedge slowly remembers where you've spent time.

Mostly it was an exploration: procedural grass, dappled "light through the trees" shading,
and a little bloom glow, all driven on the GPU through Three.js's TSL node materials. No
grand plan, no roadmap — just seeing how convincingly a handful of shaders can make
something feel alive and growing. Expect rough edges; that's part of the fun.

## ⚠️ WebGPU is required — not every browser supports it yet

The whole thing runs on WebGPU, which is still new and rolling out. There's **no WebGL
fallback** — if your browser can't do WebGPU you'll get a friendly "this needs WebGPU"
message instead of the hedge. Whether it works depends on your browser **and** your
operating system: Chrome and Edge have shipped it for a while, Safari and Firefox arrived
more recently, and Linux is still hit-or-miss.

Live support data from [caniuse](https://caniuse.com/webgpu) (image updates daily):

[![WebGPU browser support](https://caniuse.bitsofco.de/image/webgpu.png)](https://caniuse.com/webgpu)

You can also check your own browser at [webgpureport.org](https://webgpureport.org/).

## Still to do

- Optimization
- AI slop clean up