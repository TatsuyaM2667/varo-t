import { AUDIO } from '../config/audio';
import type { WeaponId } from '../config/weapons';
import type { MaterialTag } from '../sim/physics/aabb';
import type { Bvh } from '../sim/physics/bvh';

export interface V3 {
  x: number;
  y: number;
  z: number;
}

interface PlayOpts {
  pos?: V3;
  gain?: number;
  /** extra delay (s), e.g. sound travel time */
  delay?: number;
}

/**
 * All sound effects are synthesised at runtime (no audio files). Spatial
 * voices use HRTF panners; the listener's surroundings are probed with ray
 * casts against the map to derive a reverb time and early reflections, which
 * are rendered into a generated impulse response.
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly sfx: GainNode;
  private readonly uiBus: GainNode;
  private readonly reverbSend: GainNode;
  private readonly convolvers: [ConvolverNode, ConvolverNode];
  private readonly convGains: [GainNode, GainNode];
  private activeConv = 0;
  private currentRt = 0;
  private noise: AudioBuffer;
  private listener: V3 = { x: 0, y: 0, z: 0 };
  private probeTimer = 0;
  spatialReverb = true;
  enabled = true;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.gain.value = AUDIO.master;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    this.sfx = this.ctx.createGain();
    this.sfx.gain.value = AUDIO.sfx;
    this.sfx.connect(this.master);
    this.uiBus = this.ctx.createGain();
    this.uiBus.gain.value = AUDIO.ui;
    this.uiBus.connect(this.master);
    this.reverbSend = this.ctx.createGain();
    this.reverbSend.gain.value = 0.2;
    this.convolvers = [this.ctx.createConvolver(), this.ctx.createConvolver()];
    this.convGains = [this.ctx.createGain(), this.ctx.createGain()];
    for (let i = 0; i < 2; i++) {
      this.reverbSend.connect(this.convolvers[i]);
      this.convolvers[i].connect(this.convGains[i]).connect(this.master);
      this.convGains[i].gain.value = i === 0 ? 1 : 0;
    }
    this.noise = this.makeNoise(2);
    this.setReverb(0.8, 0.2, []);
  }

  setVolume(v: number): void {
    this.master.gain.value = AUDIO.master * v;
  }

  resume(): void {
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  private makeNoise(seconds: number): AudioBuffer {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  // ---------------------------------------------------------------- spatial

  setListener(pos: V3, yaw: number, pitch: number): void {
    this.listener = pos;
    const l = this.ctx.listener;
    const fx = Math.sin(yaw) * Math.cos(pitch);
    const fy = Math.sin(pitch);
    const fz = Math.cos(yaw) * Math.cos(pitch);
    // Web Audio is right-handed; flip Z to map Babylon's left-handed frame
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(pos.x, t);
      l.positionY.setValueAtTime(pos.y, t);
      l.positionZ.setValueAtTime(-pos.z, t);
      l.forwardX.setValueAtTime(fx, t);
      l.forwardY.setValueAtTime(fy, t);
      l.forwardZ.setValueAtTime(-fz, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    }
  }

  /** Re-measure the acoustic environment periodically. */
  updateEnvironment(dt: number, bvh: Bvh): void {
    if (!this.spatialReverb) return;
    this.probeTimer -= dt;
    if (this.probeTimer > 0) return;
    this.probeTimer = AUDIO.reverb.probeInterval;
    const p = this.listener;
    const dists: number[] = [];
    let open = 0;
    const N = 12;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const up = i % 3 === 0 ? 0.45 : 0.05;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const l = Math.hypot(dx, up, dz);
      const hit = bvh.raycast(p.x, p.y, p.z, dx / l, up / l, dz / l, 60);
      if (hit) dists.push(hit.t);
      else open++;
    }
    const ceiling = bvh.raycast(p.x, p.y, p.z, 0, 1, 0, 40);
    if (!ceiling) open += 2;
    const openness = open / (N + 2);
    const mean = dists.length ? dists.reduce((s, d) => s + d, 0) / dists.length : 40;
    // Sabine-flavoured estimate: bigger enclosed spaces ring longer, open sky absorbs
    const rt = Math.max(AUDIO.reverb.minRt60, Math.min(AUDIO.reverb.maxRt60, (0.35 + mean * 0.05) * (1 - openness * 0.55)));
    const wet = AUDIO.reverb.wetMin + (AUDIO.reverb.wetMax - AUDIO.reverb.wetMin) * (1 - openness);
    const nearest = dists.sort((a, b) => a - b).slice(0, 4);
    if (Math.abs(rt - this.currentRt) / Math.max(0.1, this.currentRt) > 0.15) this.setReverb(rt, wet, nearest);
    else this.reverbSend.gain.setTargetAtTime(wet, this.ctx.currentTime, 0.3);
  }

  /** Generate an IR: early reflections from nearby walls + exponential diffuse tail. */
  private setReverb(rt60: number, wet: number, reflections: number[]): void {
    this.currentRt = rt60;
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * Math.min(3, rt60 * 1.1));
    const ir = this.ctx.createBuffer(2, len, sr);
    const decay = 6.91 / rt60; // -60 dB at rt60
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      const pre = Math.floor(sr * 0.012);
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / sr;
        d[i] = (Math.random() * 2 - 1) * Math.exp(-decay * t) * 0.6;
      }
      for (const dist of reflections) {
        const idx = Math.floor(((2 * dist) / AUDIO.speedOfSound) * sr) + ch * 7;
        if (idx < len) d[idx] += (ch ? -1 : 1) * Math.min(0.9, 2.5 / Math.max(1, dist));
      }
    }
    const next = 1 - this.activeConv;
    this.convolvers[next].buffer = ir;
    const t = this.ctx.currentTime;
    this.convGains[next].gain.setTargetAtTime(1, t, 0.15);
    this.convGains[this.activeConv].gain.setTargetAtTime(0, t, 0.15);
    this.activeConv = next;
    this.reverbSend.gain.setTargetAtTime(wet, t, 0.2);
  }

  /** Output node for a voice: panner (if positional) → sfx + reverb send. */
  private voiceOut(opts: PlayOpts, bvh: Bvh | null, ui = false): { input: AudioNode; t0: number } {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const g = ctx.createGain();
    g.gain.value = opts.gain ?? 1;
    if (ui || !opts.pos) {
      g.connect(ui ? this.uiBus : this.sfx);
      if (!ui) g.connect(this.reverbSend);
      return { input: g, t0 };
    }
    const p = opts.pos;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = AUDIO.refDistance;
    panner.maxDistance = AUDIO.maxDistance;
    panner.rolloffFactor = AUDIO.rolloff;
    panner.positionX.value = p.x;
    panner.positionY.value = p.y;
    panner.positionZ.value = -p.z;
    let node: AudioNode = g;
    // occlusion: walls between source and listener muffle the sound
    if (bvh) {
      const l = this.listener;
      const dx = p.x - l.x;
      const dy = p.y - l.y;
      const dz = p.z - l.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > 1 && bvh.raycast(l.x, l.y, l.z, dx / d, dy / d, dz / d, d - 0.3)) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = AUDIO.occludedLowpass;
        g.gain.value *= AUDIO.occludedGain;
        g.connect(lp);
        node = lp;
      }
      // air absorption for distant sounds
      if (d > 25) {
        const air = ctx.createBiquadFilter();
        air.type = 'lowpass';
        air.frequency.value = Math.max(1500, 16000 - d * 120);
        node.connect(air);
        node = air;
      }
    }
    node.connect(panner);
    panner.connect(this.sfx);
    panner.connect(this.reverbSend);
    return { input: g, t0 };
  }

  private noiseSrc(t0: number, dur: number): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.start(t0, Math.random() * 1.5, dur + 0.05);
    return s;
  }

  private env(g: GainNode, t0: number, attack: number, peak: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  private tone(out: AudioNode, t0: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number): void {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = this.ctx.createGain();
    this.env(g, t0, 0.003, peak, dur);
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private noiseBurst(out: AudioNode, t0: number, type: BiquadFilterType, f0: number, f1: number, q: number, dur: number, peak: number): void {
    const n = this.noiseSrc(t0, dur);
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
    const g = this.ctx.createGain();
    this.env(g, t0, 0.002, peak, dur);
    n.connect(f).connect(g).connect(out);
  }

  // --------------------------------------------------------------- recipes

  gunshot(weapon: WeaponId, pos: V3 | undefined, bvh: Bvh | null, local: boolean): void {
    if (!this.enabled) return;
    const w = AUDIO.weapon[weapon];
    const dist = pos ? Math.hypot(pos.x - this.listener.x, pos.y - this.listener.y, pos.z - this.listener.z) : 0;
    const { input, t0 } = this.voiceOut({ pos: local ? undefined : pos, gain: w.gain, delay: dist / AUDIO.speedOfSound }, bvh);
    this.noiseBurst(input, t0, 'bandpass', w.crack, w.crack * 0.4, 0.9, 0.06, 0.9);
    this.noiseBurst(input, t0, 'lowpass', 5000, 300, 0.7, w.tail, 0.55);
    this.tone(input, t0, 'sine', w.body * 1.6, w.body * 0.5, 0.16 + w.tail * 0.2, 0.8);
    if (weapon === 'sniper') this.tone(input, t0, 'triangle', 90, 35, 0.6, 0.5);
    // mechanical click for the shooter
    if (local) this.noiseBurst(input, t0 + 0.02, 'highpass', 6000, 4000, 1, 0.02, 0.25);
  }

  footstep(material: MaterialTag, pos: V3, bvh: Bvh | null, loud: boolean, local: boolean): void {
    if (!this.enabled) return;
    const { input, t0 } = this.voiceOut({ pos: local ? undefined : pos, gain: (loud ? 0.55 : 0.18) * (local ? 0.6 : 1) }, bvh);
    const f = material === 'metal' ? 2600 : material === 'wood' || material === 'crate' ? 900 : material === 'site' ? 1800 : 1300;
    const q = material === 'metal' ? 8 : 1.2;
    this.noiseBurst(input, t0, 'bandpass', f, f * 0.6, q, 0.07, 0.8);
    this.tone(input, t0, 'sine', material === 'wood' || material === 'crate' ? 160 : 110, 60, 0.07, 0.5);
  }

  land(pos: V3, bvh: Bvh | null, local: boolean): void {
    if (!this.enabled) return;
    const { input, t0 } = this.voiceOut({ pos: local ? undefined : pos, gain: 0.45 }, bvh);
    this.noiseBurst(input, t0, 'lowpass', 1200, 200, 0.8, 0.12, 0.9);
    this.tone(input, t0, 'sine', 90, 45, 0.12, 0.7);
  }

  reload(weapon: WeaponId, total: number, pos: V3 | undefined, bvh: Bvh | null): void {
    if (!this.enabled) return;
    const { input, t0 } = this.voiceOut({ pos, gain: 0.5 }, bvh);
    const clicks = weapon === 'sniper' ? [0.15, 0.5, total * 0.6, total * 0.85] : [0.1, total * 0.55, total * 0.85];
    clicks.forEach((t, i) => {
      this.noiseBurst(input, t0 + t, 'bandpass', 2500 + i * 700, 1800, 4, 0.04, 0.7);
      this.tone(input, t0 + t, 'square', 900 + i * 200, 600, 0.03, 0.12);
    });
  }

  equip(): void {
    if (!this.enabled) return;
    const { input, t0 } = this.voiceOut({ gain: 0.35 }, null);
    this.noiseBurst(input, t0, 'bandpass', 1200, 3000, 1, 0.15, 0.4);
    this.noiseBurst(input, t0 + 0.18, 'bandpass', 3500, 2500, 5, 0.03, 0.6);
  }

  dry(): void {
    if (!this.enabled) return;
    const { input, t0 } = this.voiceOut({ gain: 0.4 }, null);
    this.noiseBurst(input, t0, 'highpass', 5000, 3000, 2, 0.03, 0.7);
  }

  hitmarker(head: boolean, kill: boolean): void {
    if (!this.enabled) return;
    const { input, t0 } = this.voiceOut({ gain: 0.45 }, null, true);
    if (head) {
      this.tone(input, t0, 'sine', 2600, 2500, 0.18, 0.5);
      this.tone(input, t0, 'sine', 5200, 5100, 0.12, 0.15);
    } else this.tone(input, t0, 'triangle', 1500, 1300, 0.06, 0.4);
    if (kill) {
      [880, 1175, 1568].forEach((f, i) => this.tone(input, t0 + 0.05 + i * 0.06, 'sine', f, f, 0.18, 0.35));
    }
  }

  hurt(): void {
    if (!this.enabled) return;
    const { input, t0 } = this.voiceOut({ gain: 0.5 }, null, true);
    this.tone(input, t0, 'sine', 140, 50, 0.2, 0.8);
    this.noiseBurst(input, t0, 'lowpass', 1500, 200, 0.7, 0.15, 0.4);
  }

  whoosh(pos: V3 | undefined, bvh: Bvh | null, up = true): void {
    if (!this.enabled) return;
    const { input, t0 } = this.voiceOut({ pos, gain: 0.5 }, bvh);
    this.noiseBurst(input, t0, 'bandpass', up ? 400 : 2000, up ? 2400 : 300, 2, 0.28, 0.8);
  }

  smokeDeploy(pos: V3, bvh: Bvh | null): void {
    if (!this.enabled) return;
    const { input, t0 } = this.voiceOut({ pos, gain: 0.7 }, bvh);
    this.tone(input, t0, 'sine', 120, 50, 0.25, 0.7);
    this.noiseBurst(input, t0, 'highpass', 3000, 900, 0.6, 1.8, 0.6);
  }

  shatter(material: MaterialTag, pos: V3, bvh: Bvh | null): void {
    if (!this.enabled) return;
    const { input, t0 } = this.voiceOut({ pos, gain: 0.8 }, bvh);
    if (material === 'glass') {
      for (let i = 0; i < 14; i++) this.tone(input, t0 + Math.random() * 0.25, 'sine', 3000 + Math.random() * 4000, 2500, 0.08 + Math.random() * 0.1, 0.15);
      this.noiseBurst(input, t0, 'highpass', 4000, 2000, 0.8, 0.35, 0.7);
    } else {
      this.noiseBurst(input, t0, 'bandpass', 700, 200, 1.5, 0.35, 1);
      this.tone(input, t0, 'triangle', 180, 70, 0.3, 0.6);
    }
  }

  ui(kind: 'click' | 'hover' | 'roundStart' | 'win' | 'lose' | 'capture' | 'tick'): void {
    if (!this.enabled) return;
    const { input, t0 } = this.voiceOut({ gain: 0.5 }, null, true);
    switch (kind) {
      case 'click':
        this.tone(input, t0, 'triangle', 1200, 900, 0.05, 0.4);
        break;
      case 'hover':
        this.tone(input, t0, 'sine', 1800, 1700, 0.03, 0.15);
        break;
      case 'tick':
        this.tone(input, t0, 'square', 1400, 1400, 0.03, 0.12);
        break;
      case 'capture':
        this.tone(input, t0, 'sine', 660, 990, 0.15, 0.35);
        break;
      case 'roundStart':
        [440, 660].forEach((f, i) => this.tone(input, t0 + i * 0.16, 'sawtooth', f, f, 0.22, 0.18));
        break;
      case 'win':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(input, t0 + i * 0.1, 'triangle', f, f, 0.35, 0.3));
        break;
      case 'lose':
        [392, 330, 262].forEach((f, i) => this.tone(input, t0 + i * 0.14, 'triangle', f, f * 0.98, 0.4, 0.3));
        break;
    }
  }

  dispose(): void {
    void this.ctx.close();
  }
}
