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

## Maps
- Stage maps are ASCII grids in `sim/map/stages.ts` (legend in `sim/map/spec.ts`), one per difficulty, laid out as a forward push: attacker spawn (south) → approach with forward defender posts → three lanes → a single site (north).
- `buildFromSpec` produces colliders (walls merged per district, terrace levels, archway lintels, roofs, cover), tactics (entrances, site/forward posts, attack routes derived from markers) and render-only visual data (district floor finishes, props).
- Every district has a wall and floor colour; nearest-district tints are assigned by BFS so walls take the colour of the area they face.
- `sim/map/registry.ts` maps ids to builders and defines the stages (map, difficulty, default enemy count). The World takes `mapId`; replays carry it in their options.
- Validation: `tests/unit/stages.test.ts` (spawns, reachability of the relay/posts/routes, sight lines) and `tools/validate-map.ts`.

## Navigation
- Deterministic 1 m walkability grid + A* with string pulling (`sim/bots/nav.ts`). **Deviation from the plan:** Recast was replaced because a WASM navmesh inside the sim would make headless self-play and bit-exact replays depend on WASM/async loading; the grid is exact, fast (≈30k sim ticks/s with bots) and needs no assets.

## Bots
- Perception: FOV cone, line of sight (glass/smoke aware), smoke optical depth along the sight line, reaction delay (shorter when the enemy appears where expected), hearing of footsteps/gunshots/abilities (halved through walls), being shot reveals the attacker.
- Decision: utility scores (engage / retreat-to-cover / investigate / hold post / rotate / retake / push / capture) re-evaluated at 10 Hz; Tier 0 FSM when `botUtilityAi` is off.
- Tactics data come from each map (`MapData.tactics`): entrances with smoke spots, site posts and forward posts, attack routes. Defenders get distinct posts (≈40 % forward posts, the rest spread over the entrances).
- Movement: 8-way input is dithered (alternating the two nearest directions) so bots follow paths at any angle; paths carry a wall-clearance cost; a stuck bot sidesteps toward open space, jumps, and re-routes. `tools/stuck-probe.ts` measures it.
- Difficulty = reaction time, aim error (+ settle), coordination; multipliers tuned by self-play.

## Rendering (`src/render`)
- WebGPU first, WebGL2 fallback (`?engine=webgl`). Tree-shaken Babylon 9 deep imports; engine extensions registered in `render/engine.ts`.
- Map: merged greybox meshes with world-space UVs and procedural textures; destructibles as separate meshes.
- Characters: one skinned mesh per agent built from vertex-coloured primitives (one bone per rigid part); the analytic two-bone IK for legs (ground raycast, gait phase) and arms (hands on the gun) writes bone transforms each frame. ~5 draw calls per agent.
- Stage architecture (`render/architecture.ts`): per-district floor finishes, baseboards/cornices, windows and floor bands on buildings, arch frames, roof beams, trees, stalls, barrels, lamps, banners and the site marking — batched into a few meshes per theme (`config/themes.ts`).
- Viewmodel: primitives in rendering group 1 (never clips), spring-damper recoil, sway, bob, ADS blend, star-burst muzzle flash.
- Effects: pooled tracers, spark bursts (GPU particles; compute shaders under WebGPU), decals, ambient dust, smoke billboards bound to the sim's density puffs.
- Post: FXAA, bloom, ACES tone mapping, sharpen, SSAO2 (WebGL2 only: under WebGPU this Babylon build fails to bind its noise sampler), volumetric sun shafts (Ultra), damage chromatic aberration.
- Lighting moods per round (time of day), PBR + IBL from a reflection probe of the procedural sky.

## Multiplayer (`src/net`, `server/`)
- **Delay-based lockstep.** Every client runs the same deterministic World; only humans' InputFrames travel. A client simulates tick t once it holds every active human's input for t; input sampled while simulating t is scheduled for t + delay and sent immediately (batched `sendEveryTicks` per packet). The camera look is applied locally at once, so only movement/firing feel the delay.
- **Delay** = ceil(worst conservative RTT / tick) + batching, clamped to `NET.minDelayTicks…maxDelayTicks`, fixed per match by the relay at start (clients report smoothed RTT + 2× deviation).
- **Relay**: a Cloudflare Worker with one Durable Object per 4-letter room code (`locationHint: 'apac'`). `RoomCore` (`src/net/room.ts`, pure, unit-tested) keeps the lobby and forwards input packets in arrival order, stamping the sender's slot. It never simulates.
- **Leaving**: the relay knows the last tick it relayed for a leaver and broadcasts `left(slot, tick)`; every client has all inputs before that tick and none after, so all convert the agent to a bot (`World.convertToBot`) right before the same tick. The InputLog records conversions so killcams and replays stay exact.
- **Stalls / catch-up**: a client missing input stops (flushing its partial batch so two stalled clients cannot wait on each other); a client that fell behind (inputs buffered beyond tick + delay) runs extra ticks per frame.
- **Desync detection**: state hashes every `hashEveryTicks` are exchanged and compared (HUD notice on mismatch). Rooms admit only the same build (`__BUILD_ID__`).
- **Sim features** (destructibles, seeded maps, utility AI) come from the host in the start message, not from each client's quality preset.
- Tested headlessly by `tests/unit/net.test.ts`: 3 clients with jittery frame rates and 15–70 ms latency stay bit-identical; a leaver becomes a bot at the same tick everywhere and the round replays exactly.

## Quality
- Presets in `config/quality.ts` (each also enables Tier 1/2 visual flags). Auto-detected (integrated → Medium, discrete → High, software → Low).
- `render/quality/adaptive.ts`: p95 frame time per 2 s window; steps down **resolution → effects → post**, steps back up after sustained headroom, never retries a failed upgrade for 60 s.

## Exhibition safety (`src/app/app.ts`)
- 60 s without input anywhere → title. 30 s idle on the title → full-screen bot demo.
- Any uncaught error → message → title after 3 s; repeated crashes progressively disable risky effects, force Low, then WebGL2.
- Pointer lock lost → pause overlay. Fullscreen + Keyboard Lock so Ctrl-crouch cannot close the tab.

## Feature flags
`config/features.ts`. URL: `?f=ssao,-bloom` to toggle, `?f=tier0` for everything off. Gameplay-affecting flags (`destructibles`, `seededMap`, `botUtilityAi`) are part of the world options, so replays stay exact.
