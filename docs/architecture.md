# Architecture

```
input (DOM) ──► InputFrame (per tick, quantised) ──► World.step()  ◄── BotBrain.think() (same InputFrame)
                                                      │  deterministic, 60 Hz, pure TS (src/sim)
                                                      ▼
                                             state + SimEvent[]
                                                      │ read-only
            ┌─────────────────────────────┬───────────┴──────────────┬────────────────────┐
     WorldView (interp.)            AudioEngine                  HUD / UI              InputLog
     GameRenderer (Babylon)      (Web Audio synth,             (DOM)                 (replay, killcam)
     characters/viewmodel/fx      HRTF, ray-probed reverb)
```

## Determinism
- `src/sim` imports nothing but itself and `src/config` (enforced by `tests/unit/boundaries.test.ts`, which also bans `Math.random`, `Math.sin/cos/atan2/hypot/...`, `Date.now`, `window`, `document`).
- Trig via `sim/core/fmath.ts` (only IEEE-exact operations). PRNG: xoshiro128** (`sim/core/rng.ts`).
- View angles travel as integers (65536 per turn). Each round reseeds from `(matchSeed, roundIndex)`, so **a round is a pure function of (options, round index, human inputs)**.
- Proven by tests: identical state hashes for identical logs (`determinism.test.ts`), bit-exact round re-simulation from the input log (`replay.test.ts`), deterministic bot-only matches (`bots.test.ts`).

## Physics
- Gameplay collision: static AABB world in a BVH; players are swept boxes moved one axis at a time (no tunnelling at any speed), step-up 0.42 m, ground snap.
- Hitscan: ray vs BVH + per-agent head/body/legs boxes (crouch shrinks them).
- Havok (`@babylonjs/havok`, MIT) is cosmetic only: debris from destroyed crates/glass. Loaded lazily when `destructibles` is on.

## Navigation
- Deterministic 1 m walkability grid + A* with string pulling (`sim/bots/nav.ts`). **Deviation from the plan:** Recast was replaced because a WASM navmesh inside the sim would make headless self-play and bit-exact replays depend on WASM/async loading; the grid is exact, fast (≈30k sim ticks/s with bots) and needs no assets.

## Bots
- Perception: FOV cone, line of sight (glass/smoke aware), smoke optical depth along the sight line, reaction delay (shorter when the enemy appears where expected), hearing of footsteps/gunshots/abilities (halved through walls), being shot reveals the attacker.
- Decision: utility scores (engage / retreat-to-cover / investigate / hold post / rotate / retake / push / capture) re-evaluated at 10 Hz; Tier 0 FSM when `botUtilityAi` is off.
- Tactics data (`sim/bots/tactics.ts`): crossfire post pairs per entrance, attack routes, smoke targets.
- Difficulty = reaction time, aim error (+ settle), coordination; multipliers tuned by self-play.

## Rendering (`src/render`)
- WebGPU first, WebGL2 fallback (`?engine=webgl`). Tree-shaken Babylon 9 deep imports; engine extensions registered in `render/engine.ts`.
- Map: merged greybox meshes with world-space UVs and procedural textures; destructibles as separate meshes.
- Characters: primitive meshes + analytic two-bone IK for legs (ground raycast, gait phase) and arms (hands on the gun).
- Viewmodel: primitives in rendering group 1 (never clips), spring-damper recoil, sway, bob, ADS blend, star-burst muzzle flash.
- Effects: pooled tracers, spark bursts (GPU particles; compute shaders under WebGPU), decals, ambient dust, smoke billboards bound to the sim's density puffs.
- Post: FXAA, bloom, ACES tone mapping, sharpen, SSAO2 (WebGL2 only: under WebGPU this Babylon build fails to bind its noise sampler), volumetric sun shafts (Ultra), damage chromatic aberration.
- Lighting moods per round (time of day), PBR + IBL from a reflection probe of the procedural sky.

## Quality
- Presets in `config/quality.ts` (each also enables Tier 1/2 visual flags). Auto-detected (integrated → Medium, discrete → High, software → Low).
- `render/quality/adaptive.ts`: p95 frame time per 2 s window; steps down **resolution → effects → post**, steps back up after sustained headroom, never retries a failed upgrade for 60 s.

## Exhibition safety (`src/app/app.ts`)
- 60 s without input anywhere → title. 30 s idle on the title → full-screen bot demo.
- Any uncaught error → message → title after 3 s; repeated crashes progressively disable risky effects, force Low, then WebGL2.
- Pointer lock lost → pause overlay. Fullscreen + Keyboard Lock so Ctrl-crouch cannot close the tab.

## Feature flags
`config/features.ts`. URL: `?f=ssao,-bloom` to toggle, `?f=tier0` for everything off. Gameplay-affecting flags (`destructibles`, `seededMap`, `botUtilityAi`) are part of the world options, so replays stay exact.
