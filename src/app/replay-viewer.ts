import { MOVEMENT } from '../config/movement';
import { LIGHTING_MOODS } from '../config/visuals';
import { GameRenderer } from '../render/game-renderer';
import { InputLog, RoundReplay } from '../sim/replay/input-log';
import { t } from '../ui/i18n';
import { SmoothCam, shoulderCam } from './cameras';
import type { ModeContext } from './match';
import { WorldView } from './world-view';

const TICK = MOVEMENT.tickRate;

/**
 * Post-match round replay: re-simulates a recorded round from its input log
 * (bit-exact), following the player (or their killer once they are down).
 */
export class ReplayViewer {
  private replay: RoundReplay;
  readonly renderer: GameRenderer;
  private readonly view: WorldView;
  private readonly cam = new SmoothCam();
  private acc = 0;
  private speed = 1;
  private paused = false;
  private readonly bar: HTMLDivElement;
  private readonly total: number;

  constructor(
    ctx: ModeContext,
    private readonly log: InputLog,
    private readonly round: number,
    private readonly onExit: () => void,
  ) {
    this.replay = new RoundReplay(log, round);
    this.total = log.ticks(round);
    this.renderer = new GameRenderer(ctx.gfx.engine, this.replay.world.map, this.replay.world.agents, ctx.quality, ctx.features);
    this.renderer.setMood(ctx.features.timeOfDay ? LIGHTING_MOODS[round % LIGHTING_MOODS.length] : LIGHTING_MOODS[0]);
    this.view = new WorldView(this.renderer, ctx.features.proceduralAudio ? ctx.audio : null, this.replay.world);
    this.bar = document.createElement('div');
    this.bar.className = 'replay-bar';
    ctx.ui.append(this.bar);
    window.addEventListener('keydown', this.onKey);
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.code === 'Escape' || e.code === 'Enter') this.onExit();
    else if (e.code === 'Space') this.paused = !this.paused;
    else if (e.code === 'Digit1') this.speed = 1;
    else if (e.code === 'Digit2') this.speed = 2;
    else if (e.code === 'Digit3') this.speed = 4;
    else if (e.code === 'ArrowRight') this.seekTo(this.replay.tick + 5 * TICK);
    else if (e.code === 'ArrowLeft') this.seekTo(this.replay.tick - 5 * TICK);
    e.preventDefault();
  };

  /** Seeking backwards re-simulates from the round start (cheap: ~50× real time). */
  private seekTo(tick: number): void {
    const target = Math.max(0, Math.min(this.total - 1, tick));
    if (target < this.replay.tick) {
      this.replay = new RoundReplay(this.log, this.round);
    }
    this.replay.seek(target);
    this.view.attach(this.replay.world);
    this.cam.pose = null;
  }

  frame(realDt: number): void {
    const dt = Math.min(0.1, realDt);
    if (!this.paused) {
      this.acc += dt * this.speed;
      while (this.acc >= 1 / TICK) {
        this.acc -= 1 / TICK;
        if (!this.replay.step()) {
          this.paused = true;
          this.acc = 0;
          break;
        }
        this.view.afterTick();
      }
    }
    const w = this.replay.world;
    const me = w.agents[0];
    const focus = me.alive ? 0 : me.lastAttacker >= 0 ? me.lastAttacker : 0;
    const alpha = this.paused ? 1 : Math.min(1, this.acc * TICK);
    const target = shoulderCam(this.view.eye(focus, alpha), w.bvh, 2.6, 0.6, 0.4);
    this.view.render(alpha, this.cam.follow(target, dt, 8), -1, dt);
    const p = this.total > 0 ? this.replay.tick / this.total : 0;
    this.bar.innerHTML = `<b>${t('replay')} R${this.round + 1}</b><div class="prog"><i style="width:${(p * 100).toFixed(1)}%"></i></div><span>${this.speed}× ${this.paused ? '❚❚' : '▶'}</span><span>${t('replayHelp')}</span>`;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    this.bar.remove();
    this.renderer.dispose();
  }
}
