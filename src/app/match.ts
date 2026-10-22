import type { AudioEngine } from '../audio/audio-engine';
import { ABILITIES } from '../config/abilities';
import { BOT_NAMES } from '../config/bots';
import type { StageDef } from '../sim/map/registry';
import { CAMERA_FEEL } from '../config/feel';
import type { Features } from '../config/features';
import { INPUT } from '../config/input';
import { MOVEMENT } from '../config/movement';
import type { QualityPreset } from '../config/quality';
import { RULES } from '../config/rules';
import { PALETTE } from '../config/visuals';
import type { InputManager } from '../input/input-manager';
import type { EngineHandle } from '../render/engine';
import { GameRenderer } from '../render/game-renderer';
import { AdaptiveQuality } from '../render/quality/adaptive';
import { Viewmodel } from '../render/viewmodel';
import { FixedStep } from '../sim/core/fixed-step';
import { RAD_PER_UNIT } from '../sim/core/fmath';
import { horizontalSpeed } from '../sim/entities/agent';
import { smokeStrength } from '../sim/entities/smoke';
import { currentSpreadDeg, def } from '../sim/entities/weapon';
import type { SimEvent } from '../sim/events';
import { Btn } from '../sim/input-frame';
import { zoneAt } from '../sim/map/map-def';
import { InputLog, RoundReplay } from '../sim/replay/input-log';
import { type AgentSpec, World, type WorldOptions } from '../sim/world';
import { Hud } from '../ui/hud';
import { t } from '../ui/i18n';
import { controlsGridHtml } from '../ui/screens';
import { SmoothCam, shoulderCam } from './cameras';
import type { MatchSummary } from './highscore';
import { WorldView } from './world-view';

export interface ModeContext {
  gfx: EngineHandle;
  input: InputManager;
  audio: AudioEngine | null;
  ui: HTMLElement;
  features: Features;
  quality: QualityPreset;
  /** called whenever the adaptive controller changes the effective preset */
  onQualityChange?: (q: QualityPreset, reason: string) => void;
}

export interface MatchResult {
  summary: MatchSummary;
  log: InputLog;
  history: { winner: 0 | 1; reason: string; duration: number }[];
  playerName: string;
}

const TICK = MOVEMENT.tickRate;

/** One human (attacker) vs bots (defenders). */
export class MatchMode {
  readonly world: World;
  readonly renderer: GameRenderer;
  readonly view: WorldView;
  readonly hud: Hud;
  private readonly viewmodel: Viewmodel;
  private readonly log: InputLog;
  private readonly options: WorldOptions;
  private readonly step = new FixedStep(1 / TICK);
  private readonly adaptive: AdaptiveQuality;
  private paused = false;
  private readonly pauseEl: HTMLDivElement;
  private killcam: { replay: RoundReplay; endTick: number; acc: number; killer: number; tag: HTMLDivElement } | null = null;
  private pendingKillcam: { at: number; deathTick: number; round: number; killer: number } | null = null;
  private slowmo = 0;
  private time = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private landDip = 0;
  private dashKick = 0;
  private bob = 0;
  private readonly spectate = new SmoothCam();
  private timeLeftOnWins = 0;
  private finished = false;

  constructor(
    private readonly ctx: ModeContext,
    private readonly stage: StageDef,
    enemies: number,
    private readonly onFinish: (r: MatchResult) => void,
    private readonly onQuit: () => void,
    private readonly onSettings: () => void = () => {},
  ) {
    const f = ctx.features;
    const roster: AgentSpec[] = [{ team: 0, isBot: false, name: 'YOU', hpBonus: RULES.playerHpBonus }];
    const difficulty = stage.difficulty;
    for (let i = 0; i < enemies; i++) roster.push({ team: 1, isBot: true, name: BOT_NAMES[i % BOT_NAMES.length], difficulty });
    this.options = {
      seed: (Date.now() ^ (performance.now() * 1000)) >>> 0,
      mapId: stage.map,
      roster,
      features: { destructibles: f.destructibles, seededMap: f.seededMap, utilityAi: f.botUtilityAi },
    };
    this.world = new World(this.options);
    this.world.startMatch();
    this.log = new InputLog(this.options, [0]);

    this.renderer = new GameRenderer(ctx.gfx.engine, this.world.map, this.world.agents, ctx.quality, f, 0);
    this.view = new WorldView(this.renderer, f.proceduralAudio ? ctx.audio : null, this.world);
    this.view.localId = 0;
    this.viewmodel = new Viewmodel(this.renderer.scene, this.renderer.camera, 0);
    this.view.viewmodel = this.viewmodel;
    this.view.onEvent = (e, w) => this.onEvent(e, w);
    if (ctx.audio) ctx.audio.spatialReverb = f.spatialReverb;

    this.hud = new Hud(ctx.ui, ctx.input.bindings);
    this.hud.setMinimap(f.minimap ? this.world.map : null);
    this.adaptive = new AdaptiveQuality(ctx.quality, (q, _lvl, reason) => {
      this.renderer.applyQuality(q, f);
      ctx.onQualityChange?.(q, reason);
    });

    this.pauseEl = document.createElement('div');
    this.pauseEl.className = 'screen dim';
    this.renderPause();
    this.pauseEl.hidden = true;
    this.pauseEl.addEventListener('click', (ev) => {
      const a = (ev.target as HTMLElement).closest('button')?.dataset.a;
      if (a === 'quit') this.onQuit();
      else if (a === 'settings') this.onSettings();
      else void ctx.input.lockPointer();
    });
    ctx.ui.append(this.pauseEl);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    ctx.input.setLook(this.world.agents[0].yaw, 0);
    this.lastYaw = ctx.input.lookYaw;
    this.applyMood(0);
    this.hud.showBanner(`${t('round')} 1`, t('objective'), PALETTE.teams.attackers, 3.5);
  }

  private renderPause(): void {
    this.pauseEl.innerHTML = `<div class="card" style="min-width:360px;text-align:center"><h2>${t('paused')}</h2><div style="text-align:left;margin-bottom:12px">${controlsGridHtml(this.ctx.input.bindings)}</div>
      <div class="menu" style="margin-top:10px"><button class="primary" data-a="resume">${t('clickToResume')}</button><button data-a="settings">${t('settings')}</button><button data-a="quit">${t('backToTitle')}</button></div></div>`;
  }

  /** Called after the settings screen closed (bindings may have changed). */
  refreshBindings(): void {
    this.hud.setBindings(this.ctx.input.bindings);
    this.renderPause();
  }

  /** Hide the pause card while the settings screen is open over the match. */
  setOverlayHidden(hidden: boolean): void {
    this.pauseEl.style.visibility = hidden ? 'hidden' : '';
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.ctx.input.actionOf(e.code) === 'help') {
      e.preventDefault();
      this.hud.showControls(true);
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (this.ctx.input.actionOf(e.code) === 'help') this.hud.showControls(false);
  };

  private applyMood(round: number): void {
    const moods = this.renderer.moods;
    this.renderer.setMood(this.ctx.features.timeOfDay ? moods[round % moods.length] : moods[0]);
  }

  setPaused(p: boolean): void {
    this.paused = p && !this.finished;
    this.pauseEl.hidden = !this.paused;
  }

  private onEvent(e: SimEvent, w: World): void {
    const me = w.agents[0];
    const au = this.view.audio;
    switch (e.type) {
      case 'damage':
        if (e.attacker === 0) {
          this.hud.hitmarker(e.zone === 'head', e.killed);
          au?.hitmarker(e.zone === 'head', e.killed);
        }
        if (e.victim === 0) {
          const att = w.agents[e.attacker];
          const ang = Math.atan2(att.x - me.x, att.z - me.z) - me.yaw * RAD_PER_UNIT;
          this.hud.damageFrom(ang);
          this.renderer.post.hurt(e.amount);
          au?.hurt();
        }
        break;
      case 'kill': {
        const k = w.agents[e.killer];
        const v = w.agents[e.victim];
        if (w === this.world) this.hud.kill(k.name, v.name, k.team, v.team, e.weapon, e.headshot, e.killer === 0 || e.victim === 0);
        if (w !== this.world) break;
        if (e.victim === 0 && this.ctx.features.killcam) {
          this.pendingKillcam = { at: this.time + 1.1, deathTick: w.round.tick, round: w.round.index, killer: e.killer };
        }
        if (e.killer === 0 && w.aliveCount(1) === 0 && this.ctx.features.killSlowmo) this.slowmo = 0.9;
        break;
      }
      case 'roundEnd': {
        if (w !== this.world) break;
        const won = e.winner === 0;
        if (won) {
          const h = w.match.history[w.match.history.length - 1];
          this.timeLeftOnWins += Math.max(0, w.roundTime - (h.duration - RULES.prepTime));
        }
        const reason = e.reason === 'elimination' ? t('elimination') : e.reason === 'capture' ? t('captureReason') : t('timeReason');
        this.hud.showBanner(won ? t('roundWon') : t('roundLost'), reason, won ? PALETTE.teams.attackers : '#ff5c6c', 3);
        au?.ui(won ? 'win' : 'lose');
        break;
      }
      case 'phase':
        if (w !== this.world) break;
        if (e.phase === 'prep') {
          this.applyMood(e.round);
          this.hud.showBanner(`${t('round')} ${e.round + 1}`, t('objective'), PALETTE.teams.attackers, 3);
          this.ctx.input.setLook(w.agents[0].yaw, 0);
          this.lastYaw = this.ctx.input.lookYaw;
          this.stopKillcam();
        } else if (e.phase === 'live') au?.ui('roundStart');
        break;
      case 'fireBlocked':
        if (e.agent === 0 && w === this.world)
          this.hud.notice(e.reason === 'prep' ? t('blockedPrep') : e.reason === 'reload' ? t('blockedReload') : t('blockedEquip'));
        break;
      case 'dry':
        if (e.agent === 0 && w === this.world) this.hud.notice(t('emptyMag'));
        break;
      case 'captureStart':
        au?.ui('capture');
        break;
      case 'dash':
        if (e.agent === 0) this.dashKick = 1;
        break;
      case 'land':
        if (e.agent === 0) this.landDip = Math.min(0.12, e.speed * CAMERA_FEEL.landDip);
        break;
      default:
        break;
    }
  }

  private startKillcam(): void {
    const pk = this.pendingKillcam!;
    this.pendingKillcam = null;
    if (pk.round !== this.world.round.index) return;
    const replay = new RoundReplay(this.log, pk.round);
    const start = Math.max(0, pk.deathTick - 5 * TICK);
    replay.seek(start);
    const tag = document.createElement('div');
    tag.className = 'killcam-tag';
    tag.textContent = `${t('killcam')} — ${this.world.agents[pk.killer].name}`;
    this.ctx.ui.append(tag);
    this.killcam = { replay, endTick: pk.deathTick + 30, acc: 0, killer: pk.killer, tag };
    this.view.attach(replay.world);
    this.view.localId = -1;
  }

  private stopKillcam(): void {
    if (!this.killcam) return;
    this.killcam.tag.remove();
    this.killcam = null;
    this.view.attach(this.world);
    this.view.localId = 0;
  }

  frame(realDt: number): void {
    const dt = Math.min(0.1, realDt);
    this.time += dt;
    this.adaptive.sample(realDt * 1000, this.time);
    const input = this.ctx.input;
    const w = this.world;
    const me = w.agents[0];

    // scoped sensitivity: slower look while zoomed
    const wdef = def(me.weapon);
    const zoom = 1 + (wdef.ads.zoom - 1) * me.weapon.ads;
    input.lookScale = zoom > 1.01 ? INPUT.adsSensitivityMul / zoom : 1;

    // --- simulation ---
    const scale = this.slowmo > 0 ? 0.3 : 1;
    this.slowmo = Math.max(0, this.slowmo - dt);
    if (!this.paused) {
      const steps = this.step.advance(dt * scale);
      for (let i = 0; i < steps; i++) {
        const f = input.sample();
        this.log.record(w.round.index, [f]);
        w.step([f]);
        if (!this.killcam) this.view.afterTick();
      }
    }
    if (this.pendingKillcam && this.time >= this.pendingKillcam.at && !this.killcam) this.startKillcam();
    if (this.killcam) {
      const kc = this.killcam;
      kc.acc += dt;
      while (kc.acc >= 1 / TICK) {
        kc.acc -= 1 / TICK;
        if (kc.replay.tick >= kc.endTick || !kc.replay.step()) {
          this.stopKillcam();
          break;
        }
        this.view.afterTick();
      }
    }

    // --- camera ---
    const alpha = this.killcam ? Math.min(1, this.killcam?.acc * TICK) : this.step.alpha;
    let cam;
    let hide = 0;
    if (this.killcam) {
      const eye = this.view.eye(this.killcam.killer, alpha);
      cam = shoulderCam(eye, this.view.world.bvh, 2.2, 0.6, 0.3);
      hide = -1;
    } else if (me.alive) {
      const eye = this.view.eye(0, alpha);
      const lookYaw = input.lookYaw * RAD_PER_UNIT;
      const lookPitch = input.lookPitch * RAD_PER_UNIT;
      const proc = this.ctx.features.proceduralAnimation;
      const sp = horizontalSpeed(me);
      if (me.grounded && proc) this.bob += dt * sp * 1.9;
      this.landDip = Math.max(0, this.landDip - dt * 0.6);
      this.dashKick = Math.max(0, this.dashKick - dt * 4);
      const bobY = proc ? Math.sin(this.bob * 2) * CAMERA_FEEL.headBob * Math.min(1, sp / 6) * (1 - me.weapon.ads) : 0;
      cam = {
        x: eye.x,
        y: eye.y + bobY - this.landDip,
        z: eye.z,
        yaw: lookYaw + me.weapon.recoilYaw * wdef.recoil.viewFollow,
        pitch: lookPitch + me.weapon.recoilPitch * wdef.recoil.viewFollow,
        zoom,
        fovKickDeg: this.dashKick * CAMERA_FEEL.dashFovKick,
      };
    } else {
      // spectate whoever killed us from behind
      const target = me.lastAttacker >= 0 && w.agents[me.lastAttacker].alive ? me.lastAttacker : w.agents.find((a) => a.alive)?.id ?? 0;
      cam = this.spectate.follow(shoulderCam(this.view.eye(target, alpha), w.bvh), dt, 5);
      hide = -1;
    }

    // viewmodel
    const lookVelYaw = (input.lookYaw - this.lastYaw) * RAD_PER_UNIT / Math.max(1e-3, dt);
    const lookVelPitch = (input.lookPitch - this.lastPitch) * RAD_PER_UNIT / Math.max(1e-3, dt);
    this.lastYaw = input.lookYaw;
    this.lastPitch = input.lookPitch;
    this.viewmodel.update(
      {
        weapon: me.weapon.current,
        ads: me.weapon.ads,
        reload: me.weapon.reload,
        reloadTotal: wdef.reloadTime,
        equip: me.weapon.equip,
        equipTotal: wdef.equipTime,
        speed: horizontalSpeed(me),
        grounded: me.grounded,
        lookVelYaw,
        lookVelPitch,
        visible: me.alive && !this.killcam,
        procedural: this.ctx.features.proceduralAnimation,
      },
      dt,
    );

    this.view.render(alpha, cam, hide, dt);
    this.updateHud(dt, cam);

    if (w.round.phase === 'matchOver' && !this.finished) this.finish();
  }

  private updateHud(dt: number, cam: { x: number; y: number; z: number; yaw: number }): void {
    const w = this.world;
    const me = w.agents[0];
    const wd = def(me.weapon);
    const ammo = me.weapon.ammo[me.weapon.current];
    const spread = currentSpreadDeg(me.weapon, {
      speed: horizontalSpeed(me),
      grounded: me.grounded,
      crouched: me.crouch > 0.5,
      walking: (me.prevButtons & Btn.Walk) !== 0,
    });
    const canvasW = this.ctx.gfx.engine.getRenderingCanvas()?.clientWidth ?? 1280;
    const hfov = (INPUT.fovHorizontal * Math.PI) / 180;
    const spreadPx = (Math.tan((spread * Math.PI) / 180) / Math.tan(hfov / 2)) * (canvasW / 2);

    // standing inside smoke whites out the screen
    let dens = 0;
    for (const s of this.view.world.smokes) {
      const k = smokeStrength(s);
      for (const p of s.puffs) {
        const d2 = (cam.x - p.x) ** 2 + (cam.y - p.y) ** 2 + (cam.z - p.z) ** 2;
        if (d2 < p.r * p.r) dens += (1 - d2 / (p.r * p.r)) * k;
      }
    }

    this.hud.update(
      {
        hp: me.hp,
        maxHp: me.maxHp,
        weapon: me.weapon.current,
        mag: ammo.mag,
        reserve: ammo.reserve,
        reloading: me.weapon.reload > 0 ? 1 - me.weapon.reload / wd.reloadTime : 0,
        smokeCharges: me.smokeCharges,
        smokeMax: ABILITIES.smoke.charges,
        dashCharges: me.dashCharges,
        dashRecharge: me.dashRecharge / (ABILITIES.dash.rechargeTime * TICK),
        score: w.match.score,
        timeLeft: w.phaseTimeLeft(),
        phase: w.round.phase,
        round: w.round.index,
        capture: w.round.captureProgress,
        alive: [w.aliveCount(0), w.aliveCount(1)],
        total: [w.agents.filter((a) => a.team === 0).length, w.agents.filter((a) => a.team === 1).length],
        callout: zoneAt(w.map, me.x, me.z),
        spreadPx: spreadPx + 4,
        scoped: wd.ads.scoped && me.weapon.ads > 0.85 && me.alive && !this.killcam,
        smokeFog: Math.min(0.94, dens * 1.4),
        hurt: this.renderer.post.hurtPulse,
        dead: !me.alive || !!this.killcam,
      },
      dt,
    );
    if (this.ctx.features.minimap) {
      const eyeY = me.y + me.height - 0.15;
      const agents = w.agents
        .filter((a) => a.alive && (a.id === 0 || a.team === 0 || w.canSee(me.x, eyeY, me.z, a.x, a.y + 1.4, a.z)))
        .map((a) => ({ x: a.x, z: a.z, yaw: a.yaw * RAD_PER_UNIT, team: a.team, self: a.id === 0 }));
      this.hud.drawMinimap(
        agents,
        w.smokes.map((s) => ({ x: s.x, z: s.z, r: 4.4 * smokeStrength(s) })),
      );
    }
  }

  private finish(): void {
    this.finished = true;
    const w = this.world;
    const me = w.agents[0];
    const summary: MatchSummary = {
      stats: { ...me.stats },
      roundsWon: w.match.score[0],
      roundsLost: w.match.score[1],
      won: w.match.winner === 0,
      timeLeftOnWins: this.timeLeftOnWins,
      difficulty: this.stage.difficulty,
      enemies: this.options.roster.length - 1,
      stage: this.stage.map,
    };
    this.onFinish({ summary, log: this.log, history: w.match.history.map((h) => ({ ...h })), playerName: me.name });
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.stopKillcam();
    this.hud.dispose();
    this.pauseEl.remove();
    this.viewmodel.dispose();
    this.renderer.dispose();
  }
}

