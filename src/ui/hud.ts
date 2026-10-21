import { BRAND } from '../config/brand';
import { PALETTE } from '../config/visuals';
import type { WeaponId } from '../config/weapons';
import type { MapData } from '../sim/map/map-def';
import { t } from './i18n';

export interface HudModel {
  hp: number;
  maxHp: number;
  weapon: WeaponId;
  mag: number;
  reserve: number;
  reloading: number; // 0..1 progress, 0 = not reloading
  smokeCharges: number;
  smokeMax: number;
  dashCharges: number;
  dashRecharge: number; // 0..1
  score: [number, number];
  timeLeft: number;
  phase: string;
  round: number;
  capture: number;
  alive: [number, number];
  total: [number, number];
  callout: string;
  /** crosshair gap in px */
  spreadPx: number;
  scoped: boolean;
  /** 0..1 screen fog from standing inside smoke */
  smokeFog: number;
  /** 0..1 red edge flash after taking damage */
  hurt: number;
  dead: boolean;
}

export interface MinimapAgent {
  x: number;
  z: number;
  yaw: number;
  team: 0 | 1;
  self: boolean;
}

const WEAPON_NAMES: Record<WeaponId, string> = {
  rifle: BRAND.weapons.rifle,
  sidearm: BRAND.weapons.sidearm,
  sniper: BRAND.weapons.sniper,
};

/** DOM heads-up display. Updated from the match each frame (cheaply diffed). */
export class Hud {
  readonly root: HTMLDivElement;
  private readonly els: Record<string, HTMLElement> = {};
  private readonly feed: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private bannerTimer = 0;
  private hitTimer = 0;
  private readonly dmgArcs: HTMLDivElement[] = [];
  private last: Record<string, string> = {};
  private minimap: Minimap | null = null;

  constructor(parent: HTMLElement) {
    const r = document.createElement('div');
    r.className = 'hud';
    r.innerHTML = `
      <div class="hud-top">
        <div class="team atk"><span class="sc" data-k="scA">0</span><span class="pips" data-k="pipsA"></span></div>
        <div class="clock"><div class="time" data-k="time">1:40</div><div class="phase" data-k="phase"></div></div>
        <div class="team def"><span class="pips" data-k="pipsD"></span><span class="sc" data-k="scD">0</span></div>
      </div>
      <div class="capture" data-k="capWrap"><div class="cap-label">${t('capture')}</div><div class="cap-bar"><i data-k="cap"></i></div></div>
      <div class="callout" data-k="callout"></div>
      <div class="feed"></div>
      <div class="minimap-wrap" data-k="mmWrap"><canvas width="200" height="260"></canvas></div>
      <div class="xhair" data-k="xhair"><i class="h l"></i><i class="h r"></i><i class="v t"></i><i class="v b"></i><i class="dot"></i></div>
      <div class="hitmark" data-k="hit"><i></i><i></i><i></i><i></i></div>
      <div class="dmg"></div>
      <div class="scope" data-k="scope"><div class="scope-ring"></div></div>
      <div class="smokefog" data-k="fog"></div>
      <div class="hurt" data-k="hurt"></div>
      <div class="banner"></div>
      <div class="hud-bl">
        <div class="hp"><span data-k="hp">100</span><div class="hp-bar"><i data-k="hpBar"></i></div></div>
        <div class="abil">
          <div class="ab" data-k="abQ"><b>Q</b><span>${BRAND.abilities.smoke}</span><em data-k="qDots"></em></div>
          <div class="ab" data-k="abE"><b>E</b><span>${BRAND.abilities.dash}</span><em data-k="eCd"></em></div>
        </div>
      </div>
      <div class="hud-br">
        <div class="ammo"><span class="mag" data-k="mag">25</span><span class="res" data-k="res">/ 75</span></div>
        <div class="wname" data-k="wname"></div>
        <div class="slots"><span data-s="rifle">1 ${BRAND.weapons.rifle}</span><span data-s="sidearm">2 ${BRAND.weapons.sidearm}</span><span data-s="sniper">3 ${BRAND.weapons.sniper}</span></div>
        <div class="reload" data-k="reloadWrap"><i data-k="reload"></i></div>
      </div>`;
    parent.append(r);
    this.root = r;
    r.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => (this.els[e.dataset.k!] = e));
    this.feed = r.querySelector('.feed') as HTMLDivElement;
    this.banner = r.querySelector('.banner') as HTMLDivElement;
    const dmg = r.querySelector('.dmg') as HTMLDivElement;
    for (let i = 0; i < 4; i++) {
      const a = document.createElement('div');
      a.className = 'arc';
      dmg.append(a);
      this.dmgArcs.push(a);
    }
  }

  setMinimap(map: MapData | null): void {
    const wrap = this.els.mmWrap;
    if (!map) {
      wrap.hidden = true;
      this.minimap = null;
      return;
    }
    wrap.hidden = false;
    this.minimap = new Minimap(wrap.querySelector('canvas') as HTMLCanvasElement, map);
  }

  drawMinimap(agents: readonly MinimapAgent[], smokes: readonly { x: number; z: number; r: number }[]): void {
    this.minimap?.draw(agents, smokes);
  }

  private set(k: string, v: string): void {
    if (this.last[k] === v) return;
    this.last[k] = v;
    this.els[k].textContent = v;
  }

  private style(k: string, prop: string, v: string): void {
    const key = `${k}.${prop}`;
    if (this.last[key] === v) return;
    this.last[key] = v;
    this.els[k].style.setProperty(prop, v);
  }

  private toggle(k: string, show: boolean): void {
    const key = `${k}.hidden`;
    const v = show ? '0' : '1';
    if (this.last[key] === v) return;
    this.last[key] = v;
    this.els[k].hidden = !show;
  }

  update(m: HudModel, dt: number): void {
    this.set('scA', String(m.score[0]));
    this.set('scD', String(m.score[1]));
    const tl = Math.ceil(m.timeLeft);
    this.set('time', `${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, '0')}`);
    this.style('time', 'color', m.phase === 'live' && m.timeLeft < 15 ? '#ff6b6b' : '');
    this.set('phase', m.phase === 'prep' ? t('prep') : `${t('round')} ${m.round + 1}`);
    this.set('pipsA', '●'.repeat(m.alive[0]) + '○'.repeat(Math.max(0, m.total[0] - m.alive[0])));
    this.set('pipsD', '○'.repeat(Math.max(0, m.total[1] - m.alive[1])) + '●'.repeat(m.alive[1]));
    this.toggle('capWrap', m.capture > 0.001 && m.phase === 'live');
    this.style('cap', 'width', `${(m.capture * 100).toFixed(1)}%`);
    this.set('callout', m.callout);
    this.set('hp', String(Math.max(0, Math.ceil(m.hp))));
    this.style('hpBar', 'width', `${((m.hp / m.maxHp) * 100).toFixed(1)}%`);
    this.style('hp', 'color', m.hp < 35 ? '#ff6b6b' : '');
    this.set('mag', String(m.mag));
    this.set('res', `/ ${m.reserve}`);
    this.set('wname', WEAPON_NAMES[m.weapon]);
    this.style('mag', 'color', m.mag === 0 ? '#ff6b6b' : '');
    this.toggle('reloadWrap', m.reloading > 0);
    this.style('reload', 'width', `${(m.reloading * 100).toFixed(0)}%`);
    this.set('qDots', '◆'.repeat(m.smokeCharges) + '◇'.repeat(Math.max(0, m.smokeMax - m.smokeCharges)));
    this.set('eCd', m.dashCharges > 0 ? 'READY' : `${Math.round(m.dashRecharge * 100)}%`);
    this.style('abE', 'opacity', m.dashCharges > 0 ? '1' : '0.5');
    this.style('abQ', 'opacity', m.smokeCharges > 0 ? '1' : '0.5');
    for (const s of this.root.querySelectorAll<HTMLElement>('[data-s]')) s.classList.toggle('on', s.dataset.s === m.weapon);

    // crosshair
    const gap = Math.max(3, Math.min(60, m.spreadPx));
    this.style('xhair', '--gap', `${gap.toFixed(1)}px`);
    this.toggle('xhair', !m.scoped && !m.dead);
    this.toggle('scope', m.scoped && !m.dead);
    this.style('fog', 'opacity', m.smokeFog.toFixed(2));
    this.style('hurt', 'opacity', Math.min(1, m.hurt + (m.hp < 30 && !m.dead ? 0.35 : 0)).toFixed(2));

    this.hitTimer = Math.max(0, this.hitTimer - dt);
    this.style('hit', 'opacity', (this.hitTimer / 0.25).toFixed(2));
    for (const a of this.dmgArcs) {
      const o = Math.max(0, Number(a.dataset.o ?? 0) - dt * 0.8);
      a.dataset.o = String(o);
      a.style.opacity = o.toFixed(2);
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('show');
    }
  }

  hitmarker(head: boolean, kill: boolean): void {
    this.hitTimer = kill ? 0.45 : 0.25;
    this.els.hit.className = `hitmark${head ? ' head' : ''}${kill ? ' kill' : ''}`;
  }

  /** `angle` = direction to the attacker relative to view yaw (radians, + = right). */
  damageFrom(angle: number): void {
    const a = this.dmgArcs.find((x) => Number(x.dataset.o ?? 0) <= 0.05) ?? this.dmgArcs[0];
    a.dataset.o = '1';
    a.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
  }

  kill(killer: string, victim: string, kt: 0 | 1, vt: 0 | 1, weapon: WeaponId, headshot: boolean, local: boolean): void {
    const row = document.createElement('div');
    row.className = `kf${local ? ' me' : ''}`;
    const c = (team: 0 | 1) => (team === 0 ? PALETTE.teams.attackers : PALETTE.teams.defenders);
    row.innerHTML = `<b style="color:${c(kt)}">${esc(killer)}</b><span class="w">${WEAPON_NAMES[weapon]}${headshot ? ' ◎' : ''}</span><b style="color:${c(vt)}">${esc(victim)}</b>`;
    this.feed.prepend(row);
    while (this.feed.children.length > 5) this.feed.lastChild!.remove();
    setTimeout(() => row.classList.add('fade'), 5000);
    setTimeout(() => row.remove(), 6000);
  }

  showBanner(title: string, sub: string, color: string, seconds: number): void {
    this.banner.innerHTML = `<div class="b-title" style="color:${color}">${esc(title)}</div><div class="b-sub">${esc(sub)}</div>`;
    this.banner.classList.add('show');
    this.bannerTimer = seconds;
  }

  setVisible(v: boolean): void {
    this.root.hidden = !v;
  }

  setLite(lite: boolean): void {
    this.root.classList.toggle('lite', lite);
  }

  dispose(): void {
    this.root.remove();
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Top-down map: walls pre-rendered once, agents drawn per frame. */
class Minimap {
  private readonly bg: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sx: number;
  private readonly sz: number;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly map: MapData,
  ) {
    this.ctx = canvas.getContext('2d')!;
    const b = map.bounds;
    this.sx = canvas.width / (b.maxX - b.minX);
    this.sz = canvas.height / (b.maxZ - b.minZ);
    this.bg = document.createElement('canvas');
    this.bg.width = canvas.width;
    this.bg.height = canvas.height;
    const g = this.bg.getContext('2d')!;
    g.fillStyle = 'rgba(12,16,24,0.75)';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = 'rgba(200,210,225,0.5)';
    for (const c of map.colliders) {
      if (c.material === 'floor') continue;
      const [x0, y0] = this.toPx(c.minX, c.maxZ);
      const [x1, y1] = this.toPx(c.maxX, c.minZ);
      g.fillStyle = c.material === 'wall' ? 'rgba(70,80,96,0.95)' : c.material === 'site' ? 'rgba(79,209,255,0.35)' : 'rgba(200,170,120,0.8)';
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    const s = map.siteZone;
    const [ax, ay] = this.toPx(s.minX, s.maxZ);
    const [bx, by] = this.toPx(s.maxX, s.minZ);
    g.strokeStyle = 'rgba(79,209,255,0.9)';
    g.setLineDash([4, 3]);
    g.strokeRect(ax, ay, bx - ax, by - ay);
    g.fillStyle = 'rgba(79,209,255,0.95)';
    g.font = 'bold 14px sans-serif';
    g.fillText('A', (ax + bx) / 2 - 5, (ay + by) / 2 + 5);
  }

  private toPx(x: number, z: number): [number, number] {
    const b = this.map.bounds;
    return [(x - b.minX) * this.sx, (b.maxZ - z) * this.sz];
  }

  draw(agents: readonly MinimapAgent[], smokes: readonly { x: number; z: number; r: number }[]): void {
    const g = this.ctx;
    g.drawImage(this.bg, 0, 0);
    g.fillStyle = 'rgba(220,215,235,0.55)';
    for (const s of smokes) {
      const [x, y] = this.toPx(s.x, s.z);
      g.beginPath();
      g.arc(x, y, s.r * this.sx, 0, Math.PI * 2);
      g.fill();
    }
    for (const a of agents) {
      const [x, y] = this.toPx(a.x, a.z);
      g.save();
      g.translate(x, y);
      g.rotate(a.yaw);
      g.fillStyle = a.self ? '#ffffff' : a.team === 0 ? PALETTE.teams.attackers : PALETTE.teams.defenders;
      g.beginPath();
      g.moveTo(0, -6);
      g.lineTo(4, 4);
      g.lineTo(-4, 4);
      g.closePath();
      g.fill();
      g.restore();
    }
  }
}
