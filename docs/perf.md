# Performance report

Generated 2026-10-22T14:35:04.096Z by `tools/perf.mjs` (headed, real GPU).
GPU/renderer: `Google Inc. (AMD) ANGLE (AMD, AMD Radeon 680M (radeonsi rembrandt ACO), OpenGL ES 3.2)`. Scene: attract mode (6 bots fighting, smoke, effects), 1600×900, 8 s after 5 s warm-up.



| backend | preset | avg ms | p50 ms | p95 ms | p99 ms | ≈fps |
|---|---|---|---|---|---|---|
| webgl2 | low | 16.8 | 16.7 | 16.8 | 16.8 | 60 |
| webgl2 | medium | 16.7 | 16.7 | 16.8 | 16.8 | 60 |
| webgl2 | high | 24.5 | 16.8 | 33.4 | 33.5 | 41 |
| webgl2 | ultra | 28.4 | 32.0 | 41.5 | 60.2 | 35 |
| webgpu | low | 17.4 | 16.7 | 16.8 | 33.4 | 57 |
| webgpu | medium | 16.7 | 16.7 | 16.8 | 16.8 | 60 |
| webgpu | high | 28.5 | 21.6 | 50.1 | 116.7 | 35 |
| webgpu | ultra | 23.4 | 17.7 | 36.2 | 58.2 | 43 |

The in-game adaptive controller (render scale → effects → post) additionally lowers quality when p95 > 19 ms for 4 s.
