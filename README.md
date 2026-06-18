# Crafty Hedge

![CRAFTY HEDGE rendered as stone lettering on moss, ringed with colourful blooms](docs/preview.webp)

**[Crafty Hedge](https://craftyhedge.github.io/craftyhedge-bloom/)**

Performance may vary.

⚠️ WebGPU is required

A little bio site for Crafty Hedge's Craft CMS plugin work and
Craft web development, wrapped in a very unnecessary interactive hedge.

It is also a bit of fun. The site started as an excuse to play with **WebGPU**
and Three.js, then became the landing page instead of just a throwaway demo.

Sweep your pointer across the hedge and blooms break ground in your wake. Come back to a
patch you've already grown and it cultivates over repeated visits — denser, taller, more
elaborate arrangements — so the hedge slowly remembers where you've spent time.

Mostly it was an exploration: procedural grass, dappled "light through the trees" shading,
and a little bloom glow, all driven on the GPU through Three.js's TSL node materials. No
grand plan, no roadmap — just seeing how convincingly a handful of shaders can make
something feel alive and growing. Expect rough edges; that's part of the fun.

## Custom text

The lettering is built fresh on every load, so you can swap it with a `?text=` query
param — **two words max**, one per line, comma-separated. It's uppercased to match the
font.

- `?text=HELLO,WORLD` → **HELLO** over **WORLD**
- `?text=HELLO` → just **HELLO** (second line stays empty)
- no param → the usual **CRAFTY HEDGE**

Long words can run past the framing — the camera doesn't auto-fit — and only characters
the font actually has will show up (uppercase Latin and basic punctuation).

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
