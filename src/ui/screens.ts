import type { Settings } from '../app/settings';
import type { HighScore, ScoreBreakdown, MatchSummary } from '../app/highscore';
import { BRAND } from '../config/brand';
import { INPUT } from '../config/input';
import type { InputManager } from '../input/input-manager';
import {
  ACTIONS,
  ACTION_LABELS,
  type Action,
  type Bindings,
  RESERVED,
  SLOTS,
  assignKey,
  clearKey,
  defaultBindings,
  isCtrlCode,
  keyLabel,
  unboundActions,
} from '../input/bindings';
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

const key = (k: string) => `<span class="key">${esc(k)}</span>`;

/** Keys for an action as key caps ("—" when unbound); Ctrl gets a fullscreen note. */
function keysFor(b: Bindings, a: Action): string {
  if (!b[a].length) return key('—');
  return b[a]
    .map((c) => key(keyLabel(c)) + (isCtrlCode(c) ? '<small style="color:var(--dim)">(全画面時)</small>' : ''))
    .join(' ');
}

/** Key reference grid (from the live bindings), shared by the controls card, pause screen and in-game overlay. */
export function controlsGridHtml(b: Bindings): string {
  const L = (a: Action): string => ACTION_LABELS[a].ja + ' / ' + ACTION_LABELS[a].en;
  const first = (a: Action): string => key(b[a][0] ? keyLabel(b[a][0]) : '—');
  return `<div class="howto-grid">
      <div class="key-row">${first('forward')}${first('left')}${first('back')}${first('right')} 移動 / Move</div>
      <div class="key-row">${key('マウス')} 視点 / Look</div>
      <div class="key-row">${keysFor(b, 'walk')} ${L('walk')}</div>
      <div class="key-row">${keysFor(b, 'fire')} ${L('fire')}</div>
      <div class="key-row">${keysFor(b, 'jump')} ${L('jump')}</div>
      <div class="key-row">${keysFor(b, 'ads')} ${L('ads')}</div>
      <div class="key-row">${keysFor(b, 'crouch')} ${L('crouch')}</div>
      <div class="key-row">${keysFor(b, 'reload')} ${L('reload')}</div>
      <div class="key-row">${keysFor(b, 'ability1')} ${BRAND.abilities.smoke}: ${L('ability1')}</div>
      <div class="key-row">${first('weapon1')}${first('weapon2')}${first('weapon3')} ${BRAND.weapons.rifle} / ${BRAND.weapons.sidearm} / ${BRAND.weapons.sniper}</div>
      <div class="key-row">${keysFor(b, 'ability2')} ${BRAND.abilities.dash}: ${L('ability2')}</div>
      <div class="key-row">${keysFor(b, 'help')} ${L('help')}</div>
      <div class="key-row">${key('Esc')} 一時停止 / Pause</div>
    </div>`;
}

/** The one-page controls card, shown before every match ("クリックして開始"). */
export function howtoScreen(bindings: Bindings, startable: boolean, onStart: () => void, onBack: () => void): HTMLDivElement {
  const s = el('div', 'screen dim');
  s.innerHTML = `<div class="card">
    <h2>${t('howto')}</h2>
    ${controlsGridHtml(bindings)}
    <div style="margin-top:12px;font-size:13px;color:var(--warn)">🖱 ${t('touchpadHint')}</div>
    <div class="objective">🎯 ${t('objective')}<br><small style="color:var(--dim)">止まって撃つと当たりやすい・連射は反動で上に跳ねるのでマウスを下に引く・キーは「設定」で変更できます</small></div>
    ${startable ? `<div class="howto-start">${t('clickToStart')}</div>` : `<div class="actions"><button data-a="back">${t('close')}</button></div>`}
  </div>`;
  s.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest('button');
    if (btn?.dataset.a === 'back') onBack();
    else if (startable) onStart();
  });
  return s;
}

export function settingsScreen(settings: Settings, input: InputManager, onChange: (s: Settings) => void, onClose: () => void): HTMLDivElement {
  const s = el('div', 'screen dim');
  const lang = settings.lang;
  const seg = (name: keyof Settings, opts: [string, string][]) =>
    `<div class="seg" data-seg="${name}">${opts.map(([v, label]) => `<button data-v="${v}" class="${String(settings[name]) === v ? 'on' : ''}">${label}</button>`).join('')}</div>`;
  s.innerHTML = `<div class="card settings-card">
    <h2>${t('settings')}</h2>
    <div class="settings-row"><span>${t('sensitivity')}</span><input type="range" min="${INPUT.minSensitivity}" max="${INPUT.maxSensitivity}" step="0.01" value="${settings.sensitivity}" data-r="sensitivity"><b data-o="sensitivity">${settings.sensitivity.toFixed(2)}</b></div>
    <div class="settings-row"><span>${t('volume')}</span><input type="range" min="0" max="1" step="0.01" value="${settings.volume}" data-r="volume"><b data-o="volume">${Math.round(settings.volume * 100)}</b></div>
    <div class="settings-row"><span>${t('quality')}</span>${seg('quality', [['auto', t('auto')], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']])}<span></span></div>
    <div class="settings-row"><span>${t('difficulty')}</span>${seg('difficulty', [['easy', t('easy')], ['normal', t('normal')], ['hard', t('hard')]])}<span></span></div>
    <div class="settings-row"><span>${t('language')}</span>${seg('lang', [['ja', '日本語'], ['en', 'English']])}<span></span></div>
    <h3 class="kb-title">${t('keyBindings')}</h3>
    <div class="kb-help">${t('keyBindHelp')}</div>
    <div class="kb-grid" data-kb></div>
    <div class="kb-msg" data-kbmsg></div>
    <div class="actions"><button data-a="resetKeys">${t('resetKeys')}</button><button class="primary" data-a="close">${t('close')}</button></div>
  </div>`;
  const cur: Settings = { ...settings, bindings: structuredClone(settings.bindings) };
  const grid = s.querySelector('[data-kb]') as HTMLDivElement;
  const msg = s.querySelector('[data-kbmsg]') as HTMLDivElement;
  let capturing: { action: Action; slot: number } | null = null;
  let ignoreClicksUntil = 0;

  const renderKeys = (): void => {
    grid.innerHTML = ACTIONS.map((a) => {
      const slots = Array.from({ length: SLOTS }, (_, i) => {
        const code = cur.bindings[a][i];
        const active = capturing && capturing.action === a && capturing.slot === i;
        return `<button class="kb-slot${active ? ' capturing' : ''}${code ? '' : ' empty'}" data-ka="${a}" data-ks="${i}">${active ? t('pressKey') : code ? esc(keyLabel(code)) : '＋'}</button>`;
      }).join('');
      return `<div class="kb-row${cur.bindings[a].length ? '' : ' unbound'}"><span>${ACTION_LABELS[a][lang]}</span>${slots}</div>`;
    }).join('');
  };

  const stopCapture = (viaMouse = false): void => {
    capturing = null;
    input.capture = null;
    // a captured mouse button is followed by a click event: don't treat it as a new UI click
    if (viaMouse) ignoreClicksUntil = performance.now() + 300;
    renderKeys();
  };

  const startCapture = (action: Action, slot: number): void => {
    capturing = { action, slot };
    msg.textContent = '';
    input.capture = (code) => {
      if (code === 'Escape') return stopCapture(false);
      if (code === 'Delete' || code === 'Backspace') {
        clearKey(cur.bindings, action, slot);
      } else if (RESERVED.has(code)) {
        msg.textContent = `${keyLabel(code)} ${t('keyReserved')}`;
        return stopCapture(false);
      } else {
        const lost = assignKey(cur.bindings, action, Math.min(slot, cur.bindings[action].length), code);
        if (lost) msg.textContent = `${keyLabel(code)}: ${ACTION_LABELS[lost][lang]} → ${ACTION_LABELS[action][lang]}`;
      }
      const unbound = unboundActions(cur.bindings);
      if (unbound.length) msg.textContent += ` ⚠ ${t('unbound')}: ${unbound.map((u) => ACTION_LABELS[u][lang]).join(', ')}`;
      onChange({ ...cur, bindings: structuredClone(cur.bindings) });
      stopCapture(code.startsWith('Mouse'));
    };
    renderKeys();
  };
  renderKeys();

  s.addEventListener('input', (ev) => {
    const inp = ev.target as HTMLInputElement;
    const k = inp.dataset.r as 'sensitivity' | 'volume' | undefined;
    if (!k) return;
    cur[k] = Number(inp.value);
    const out = s.querySelector(`[data-o="${k}"]`)!;
    out.textContent = k === 'volume' ? String(Math.round(cur.volume * 100)) : cur.sensitivity.toFixed(2);
    onChange({ ...cur, bindings: structuredClone(cur.bindings) });
  });
  s.addEventListener('click', (ev) => {
    if (performance.now() < ignoreClicksUntil) return;
    const btn = (ev.target as HTMLElement).closest('button');
    if (!btn) return;
    if (btn.dataset.ka) return startCapture(btn.dataset.ka as Action, Number(btn.dataset.ks));
    if (capturing) return stopCapture(false);
    if (btn.dataset.a === 'close') {
      input.capture = null;
      return onClose();
    }
    if (btn.dataset.a === 'resetKeys') {
      cur.bindings = defaultBindings();
      msg.textContent = '';
      renderKeys();
      onChange({ ...cur, bindings: structuredClone(cur.bindings) });
      return;
    }
    const g = btn.closest('[data-seg]') as HTMLElement | null;
    if (g && btn.dataset.v) {
      (cur as unknown as Record<string, string>)[g.dataset.seg!] = btn.dataset.v;
      g.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
      onChange({ ...cur, bindings: structuredClone(cur.bindings) });
    }
  });
  (s as HTMLDivElement & { cleanup?: () => void }).cleanup = () => {
    input.capture = null;
  };
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
