import type { Settings } from '../app/settings';
import type { HighScore, ScoreBreakdown, MatchSummary } from '../app/highscore';
import { BRAND } from '../config/brand';
import { INPUT } from '../config/input';
import { t } from './i18n';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export interface TitleHandlers {
  play(): void;
  howto(): void;
  settings(): void;
  difficulty(d: Settings['difficulty']): void;
  hover(): void;
}

export function titleScreen(settings: Settings, scores: readonly HighScore[], h: TitleHandlers): HTMLDivElement {
  const s = el('div', 'screen glass');
  const [a, b] = BRAND.gameTitle.split(' ');
  s.innerHTML = `
    <h1 class="logo">${a} <span>${b ?? ''}</span></h1>
    <p class="tagline">${BRAND.tagline[settings.lang]}</p>
    <div class="menu">
      <button class="primary" data-a="play">${t('play')}</button>
      <button data-a="howto">${t('howto')}</button>
      <button data-a="settings">${t('settings')}</button>
    </div>
    <div class="diff">${(['easy', 'normal', 'hard'] as const)
      .map((d) => `<button data-d="${d}" class="${settings.difficulty === d ? 'on' : ''}">${t(d)}</button>`)
      .join('')}</div>
    <div class="title-board"><h3>${t('ranking')}</h3>${
      scores.length
        ? scores
            .map((e, i) => `<div class="board-row"><span>${i + 1}</span><span>${esc(e.name)} <small style="color:var(--dim)">${t(e.difficulty as 'easy')}</small></span><span>${e.score.toLocaleString()}</span></div>`)
            .join('')
        : `<div style="color:var(--dim)">${t('noScores')}</div>`
    }</div>
    <div class="title-foot">${BRAND.mapName} · WebGPU / WebGL2 · Babylon.js</div>`;
  s.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest('button');
    if (!btn) return;
    if (btn.dataset.a === 'play') h.play();
    else if (btn.dataset.a === 'howto') h.howto();
    else if (btn.dataset.a === 'settings') h.settings();
    else if (btn.dataset.d) {
      h.difficulty(btn.dataset.d as Settings['difficulty']);
      s.querySelectorAll('[data-d]').forEach((x) => x.classList.toggle('on', x === btn));
    }
  });
  s.addEventListener('mouseover', (ev) => {
    if ((ev.target as HTMLElement).tagName === 'BUTTON') h.hover();
  });
  return s;
}

const key = (k: string) => `<span class="key">${k}</span>`;

/** The one-page controls card, shown before every match ("クリックして開始"). */
export function howtoScreen(startable: boolean, onStart: () => void, onBack: () => void): HTMLDivElement {
  const s = el('div', 'screen dim');
  s.innerHTML = `<div class="card">
    <h2>${t('howto')}</h2>
    <div class="howto-grid">
      <div class="key-row">${key('W')}${key('A')}${key('S')}${key('D')} 移動 / Move</div>
      <div class="key-row">${key('マウス')} 視点 / Look</div>
      <div class="key-row">${key('Shift')} 歩き（足音なし）/ Walk</div>
      <div class="key-row">${key('左クリック')} 射撃 / Fire</div>
      <div class="key-row">${key('Space')} ジャンプ / Jump</div>
      <div class="key-row">${key('右クリック')} 覗き込み / Aim</div>
      <div class="key-row">${key('Ctrl')} or ${key('C')} しゃがみ / Crouch</div>
      <div class="key-row">${key('R')} リロード / Reload</div>
      <div class="key-row">${key('Q')} ${BRAND.abilities.smoke}: スモーク / Smoke</div>
      <div class="key-row">${key('1')}${key('2')}${key('3')} ${BRAND.weapons.rifle} / ${BRAND.weapons.sidearm} / ${BRAND.weapons.sniper}</div>
      <div class="key-row">${key('E')} ${BRAND.abilities.dash}: ダッシュ / Dash</div>
      <div class="key-row">${key('Esc')} 一時停止 / Pause</div>
    </div>
    <div class="objective">🎯 ${t('objective')}<br><small style="color:var(--dim)">止まって撃つと当たりやすい・連射は反動で上に跳ねるのでマウスを下に引く</small></div>
    ${startable ? `<div class="howto-start">${t('clickToStart')}</div>` : `<div class="actions"><button data-a="back">${t('close')}</button></div>`}
  </div>`;
  s.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest('button');
    if (btn?.dataset.a === 'back') onBack();
    else if (startable) onStart();
  });
  return s;
}

export function settingsScreen(settings: Settings, onChange: (s: Settings) => void, onClose: () => void): HTMLDivElement {
  const s = el('div', 'screen dim');
  const seg = (name: keyof Settings, opts: [string, string][]) =>
    `<div class="seg" data-seg="${name}">${opts.map(([v, label]) => `<button data-v="${v}" class="${String(settings[name]) === v ? 'on' : ''}">${label}</button>`).join('')}</div>`;
  s.innerHTML = `<div class="card">
    <h2>${t('settings')}</h2>
    <div class="settings-row"><span>${t('sensitivity')}</span><input type="range" min="${INPUT.minSensitivity}" max="${INPUT.maxSensitivity}" step="0.01" value="${settings.sensitivity}" data-r="sensitivity"><b data-o="sensitivity">${settings.sensitivity.toFixed(2)}</b></div>
    <div class="settings-row"><span>${t('volume')}</span><input type="range" min="0" max="1" step="0.01" value="${settings.volume}" data-r="volume"><b data-o="volume">${Math.round(settings.volume * 100)}</b></div>
    <div class="settings-row"><span>${t('quality')}</span>${seg('quality', [['auto', t('auto')], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']])}<span></span></div>
    <div class="settings-row"><span>${t('difficulty')}</span>${seg('difficulty', [['easy', t('easy')], ['normal', t('normal')], ['hard', t('hard')]])}<span></span></div>
    <div class="settings-row"><span>${t('language')}</span>${seg('lang', [['ja', '日本語'], ['en', 'English']])}<span></span></div>
    <div class="actions"><button class="primary" data-a="close">${t('close')}</button></div>
  </div>`;
  const cur = { ...settings };
  s.addEventListener('input', (ev) => {
    const inp = ev.target as HTMLInputElement;
    const k = inp.dataset.r as 'sensitivity' | 'volume' | undefined;
    if (!k) return;
    cur[k] = Number(inp.value);
    const out = s.querySelector(`[data-o="${k}"]`)!;
    out.textContent = k === 'volume' ? String(Math.round(cur.volume * 100)) : cur.sensitivity.toFixed(2);
    onChange({ ...cur });
  });
  s.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest('button');
    if (!btn) return;
    if (btn.dataset.a === 'close') return onClose();
    const g = btn.closest('[data-seg]') as HTMLElement | null;
    if (g && btn.dataset.v) {
      (cur as unknown as Record<string, string>)[g.dataset.seg!] = btn.dataset.v;
      g.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
      onChange({ ...cur });
    }
  });
  return s;
}

export interface ResultsHandlers {
  again(): void;
  title(): void;
  replay(round: number): void;
  submitName(name: string): void;
}

export function resultsScreen(
  m: MatchSummary,
  score: ScoreBreakdown,
  rank: number,
  history: readonly { winner: 0 | 1; reason: string; duration: number }[],
  replays: boolean,
  h: ResultsHandlers,
): HTMLDivElement {
  const s = el('div', 'screen dim results');
  const acc = m.stats.shots > 0 ? Math.round((m.stats.hits / m.stats.shots) * 100) : 0;
  s.innerHTML = `<div class="card" style="min-width:640px">
    <p class="verdict ${m.won ? 'win' : 'lose'}">${m.won ? t('victory') : t('defeat')}</p>
    <div style="text-align:center;color:var(--dim);letter-spacing:.3em">${m.roundsWon} - ${m.roundsLost}</div>
    <div class="total">${score.total.toLocaleString()}</div>
    ${rank >= 0 ? `<div class="newrec">${t('newRecord')} #${rank + 1}</div><div class="name-entry"><span>_</span><span>_</span><span>_</span></div><div style="text-align:center;color:var(--dim);font-size:13px">${t('enterName')}</div>` : ''}
    <div class="stat-grid">
      <div class="stat"><b>${m.stats.kills}</b><span>${t('kills')}</span></div>
      <div class="stat"><b>${m.stats.deaths}</b><span>${t('deaths')}</span></div>
      <div class="stat"><b>${m.stats.headshots}</b><span>${t('headshots')}</span></div>
      <div class="stat"><b>${acc}%</b><span>${t('accuracy')}</span></div>
      <div class="stat"><b>${m.stats.damage}</b><span>${t('damage')}</span></div>
    </div>
    <div class="breakdown">kills ${score.kills} · HS ${score.headshots} · dmg ${score.damage} · rounds ${score.rounds} · win ${score.match} · time ${score.time} · ×${score.difficultyMul}</div>
    ${replays ? `<div class="rounds">${history.map((r, i) => `<button class="${r.winner === 0 ? 'w' : 'l'}" data-r="${i}">${t('replay')} R${i + 1} · ${r.winner === 0 ? 'W' : 'L'} · ${Math.round(r.duration)}s</button>`).join('')}</div>` : ''}
    <div class="actions"><button data-a="title">${t('backToTitle')}</button><button class="primary" data-a="again">${t('playAgain')}</button></div>
  </div>`;
  let name = '';
  let named = rank < 0;
  const slots = s.querySelectorAll<HTMLSpanElement>('.name-entry span');
  const render = () => slots.forEach((sl, i) => (sl.textContent = name[i] ?? '_'));
  const onKey = (e: KeyboardEvent) => {
    if (named) return;
    if (/^Key[A-Z]$|^Digit[0-9]$/.test(e.code) && name.length < 3) name += e.code.slice(-1);
    else if (e.code === 'Backspace') name = name.slice(0, -1);
    else if (e.code === 'Enter') {
      named = true;
      h.submitName(name);
    }
    render();
  };
  window.addEventListener('keydown', onKey);
  (s as HTMLDivElement & { cleanup?: () => void }).cleanup = () => {
    window.removeEventListener('keydown', onKey);
    if (!named) {
      named = true;
      h.submitName(name);
    }
  };
  s.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest('button');
    if (!btn) return;
    if (btn.dataset.r) return h.replay(Number(btn.dataset.r));
    if (btn.dataset.a === 'again') h.again();
    else if (btn.dataset.a === 'title') h.title();
  });
  return s;
}
