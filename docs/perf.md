# Performance report

Generated 2026-10-21T17:31:36.063Z by `tools/perf.mjs` (headed, real GPU).
GPU/renderer: `Google Inc. (AMD) ANGLE (AMD, AMD Radeon 680M (radeonsi rembrandt ACO), OpenGL ES 3.2)`. Scene: attract mode (6 bots fighting, smoke, effects), 1600×900, 8 s after 5 s warm-up.



| backend | preset | avg ms | p50 ms | p95 ms | p99 ms | ≈fps |
|---|---|---|---|---|---|---|
| webgl2 | low | 16.7 | 16.7 | 16.8 | 16.8 | 60 |
| webgl2 | medium | 16.9 | 16.7 | 16.8 | 33.3 | 59 |
| webgl2 | high | 28.6 | 16.8 | 50.4 | 66.7 | 35 |
| webgl2 | ultra | 38.5 | 41.7 | 66.6 | 66.7 | 26 |
| webgpu | low | 16.7 | 16.7 | 16.8 | 16.8 | 60 |
| webgpu | medium | 16.8 | 16.7 | 16.8 | 16.8 | 60 |
| webgpu | high | 25.9 | 20.4 | 44.5 | 50.1 | 39 |
| webgpu | ultra | 34.2 | 33.3 | 51.4 | 74.4 | 29 |

The in-game adaptive controller (render scale → effects → post) additionally lowers quality when p95 > 19 ms for 4 s.
