import type { Settings } from "../app/settings";
import type { HighScore, ScoreBreakdown, MatchSummary } from "../app/highscore";
import { BRAND } from "../config/brand";
import { STAGES } from "../sim/map/registry";
import { INPUT } from "../config/input";
import type { InputManager } from "../input/input-manager";
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
} from "../input/bindings";
import { t } from "./i18n";
import { NET } from "../config/net";
import { type RoomConfig, computeDelay } from "../net/protocol";
import { MOVEMENT } from "../config/movement";
import type { LobbyState } from "../net/relay-client";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = "",
  html = "",
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

export interface TitleHandlers {
  play(): void;
  multiplayer(): void;
  howto(): void;
  settings(): void;
  stage(index: number): void;
  hover(): void;
}

export function titleScreen(
  settings: Settings,
  scores: readonly HighScore[],
  h: TitleHandlers,
): HTMLDivElement {
  const s = el("div", "screen glass");
  const [a, b] = BRAND.gameTitle.split(" ");
  s.innerHTML = `
    <h1 class="logo">${a} <span>${b ?? ""}</span></h1>
    <p class="tagline">${BRAND.tagline[settings.lang]}</p>
    <div class="menu">
      <button class="primary" data-a="play">${t("play")}</button>
      <button data-a="mp">${t("multiplayer")}</button>
      <button data-a="howto">${t("howto")}</button>
      <button data-a="settings">${t("settings")}</button>
    </div>
    <div class="stages">${STAGES.map(
      (st, i) =>
        `<button data-st="${i}" class="stage${settings.stage === i ? " on" : ""}"><b>${esc(st.title[settings.lang])}</b><span class="stage-meta">${t(st.difficulty)} ・ ${t("enemiesShort")} ${settings.enemies || st.enemies}</span><small>${esc(st.blurb[settings.lang])}</small></button>`,
    ).join("")}</div>
    <div class="title-board"><h3>${t("ranking")}</h3>${
      scores.length
        ? scores
            .map(
              (e, i) =>
                `<div class="board-row"><span>${i + 1}</span><span>${esc(e.name)} <small style="color:var(--dim)">${t(e.difficulty as "easy")}</small></span><span>${e.score.toLocaleString()}</span></div>`,
            )
            .join("")
        : `<div style="color:var(--dim)">${t("noScores")}</div>`
    }</div>
    <div class="title-foot">WebGPU / WebGL2 · Babylon.js</div>`;
  s.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest("button");
    if (!btn) return;
    if (btn.dataset.a === "play") h.play();
    else if (btn.dataset.a === "mp") h.multiplayer();
    else if (btn.dataset.a === "howto") h.howto();
    else if (btn.dataset.a === "settings") h.settings();
    else if (btn.dataset.st) {
      h.stage(Number(btn.dataset.st));
      s.querySelectorAll("[data-st]").forEach((x) =>
        x.classList.toggle("on", x === btn),
      );
    }
  });
  s.addEventListener("mouseover", (ev) => {
    if ((ev.target as HTMLElement).tagName === "BUTTON") h.hover();
  });
  return s;
}

const key = (k: string) => `<span class="key">${esc(k)}</span>`;

/** Keys for an action as key caps ("—" when unbound); Ctrl gets a fullscreen note. */
function keysFor(b: Bindings, a: Action): string {
  if (!b[a].length) return key("—");
  return b[a]
    .map(
      (c) =>
        key(keyLabel(c)) +
        (isCtrlCode(c)
          ? '<small style="color:var(--dim)">(全画面時)</small>'
          : ""),
    )
    .join(" ");
}

/** Key reference grid (from the live bindings), shared by the controls card, pause screen and in-game overlay. */
export function controlsGridHtml(b: Bindings): string {
  const L = (a: Action): string =>
    ACTION_LABELS[a].ja + " / " + ACTION_LABELS[a].en;
  const first = (a: Action): string => key(b[a][0] ? keyLabel(b[a][0]) : "—");
  return `<div class="howto-grid">
      <div class="key-row">${first("forward")}${first("left")}${first("back")}${first("right")} 移動 / Move</div>
      <div class="key-row">${key("マウス")} 視点 / Look</div>
      <div class="key-row">${keysFor(b, "walk")} ${L("walk")}</div>
      <div class="key-row">${keysFor(b, "fire")} ${L("fire")}</div>
      <div class="key-row">${keysFor(b, "jump")} ${L("jump")}</div>
      <div class="key-row">${keysFor(b, "ads")} ${L("ads")}</div>
      <div class="key-row">${keysFor(b, "crouch")} ${L("crouch")}</div>
      <div class="key-row">${keysFor(b, "reload")} ${L("reload")}</div>
      <div class="key-row">${keysFor(b, "ability1")} ${BRAND.abilities.smoke}: ${L("ability1")}</div>
      <div class="key-row">${first("weapon1")}${first("weapon2")}${first("weapon3")} ${BRAND.weapons.rifle} / ${BRAND.weapons.sidearm} / ${BRAND.weapons.sniper}</div>
      <div class="key-row">${keysFor(b, "ability2")} ${BRAND.abilities.dash}: ${L("ability2")}</div>
      <div class="key-row">${keysFor(b, "help")} ${L("help")}</div>
      <div class="key-row">${key("Esc")} 一時停止 / Pause</div>
    </div>`;
}

/** The one-page controls card, shown before every match ("クリックして開始"). */
export function howtoScreen(
  bindings: Bindings,
  startable: boolean,
  onStart: () => void,
  onBack: () => void,
): HTMLDivElement {
  const s = el("div", "screen dim");
  s.innerHTML = `<div class="card">
    <h2>${t("howto")}</h2>
    ${controlsGridHtml(bindings)}
    <div style="margin-top:12px;font-size:13px;color:var(--warn)">🖱 ${t("touchpadHint")}</div>
    <div class="objective">🎯 ${t("objective")}<br><small style="color:var(--dim)">止まって撃つと当たりやすい・連射は反動で上に跳ねるのでマウスを下に引く・キーは「設定」で変更できます</small></div>
    ${startable ? `<div class="howto-start">${t("clickToStart")}</div>` : `<div class="actions"><button data-a="back">${t("close")}</button></div>`}
  </div>`;
  s.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest("button");
    if (btn?.dataset.a === "back") onBack();
    else if (startable) onStart();
  });
  return s;
}

export function settingsScreen(
  settings: Settings,
  input: InputManager,
  onChange: (s: Settings) => void,
  onClose: () => void,
): HTMLDivElement {
  const s = el("div", "screen dim");
  const lang = settings.lang;
  const seg = (name: keyof Settings, opts: [string, string][]) =>
    `<div class="seg" data-seg="${name}">${opts.map(([v, label]) => `<button data-v="${v}" class="${String(settings[name]) === v ? "on" : ""}">${label}</button>`).join("")}</div>`;
  s.innerHTML = `<div class="card settings-card">
    <h2>${t("settings")}</h2>
    <div class="settings-row"><span>${t("sensitivity")}</span><input type="range" min="${INPUT.minSensitivity}" max="${INPUT.maxSensitivity}" step="0.01" value="${settings.sensitivity}" data-r="sensitivity"><b data-o="sensitivity">${settings.sensitivity.toFixed(2)}</b></div>
    <div class="settings-row"><span>${t("volume")}</span><input type="range" min="0" max="1" step="0.01" value="${settings.volume}" data-r="volume"><b data-o="volume">${Math.round(settings.volume * 100)}</b></div>
    <div class="settings-row"><span>${t("quality")}</span>${seg("quality", [
      ["auto", t("auto")],
      ["low", "Low"],
      ["medium", "Medium"],
      ["high", "High"],
      ["ultra", "Ultra"],
    ])}<span></span></div>
    <div class="settings-row"><span>${t("enemies")}</span>${seg("enemies", [
      ["0", t("stageDefault")],
      ...[3, 4, 5, 6, 7, 8].map((n): [string, string] => [String(n), String(n)]),
    ])}<span></span></div>
    <div class="settings-row"><span>${t("language")}</span>${seg("lang", [
      ["ja", "日本語"],
      ["en", "English"],
    ])}<span></span></div>
    <h3 class="kb-title">${t("keyBindings")}</h3>
    <div class="kb-help">${t("keyBindHelp")}</div>
    <div class="kb-grid" data-kb></div>
    <div class="kb-msg" data-kbmsg></div>
    <div class="actions"><button data-a="resetKeys">${t("resetKeys")}</button><button class="primary" data-a="close">${t("close")}</button></div>
  </div>`;
  const cur: Settings = {
    ...settings,
    bindings: structuredClone(settings.bindings),
  };
  const grid = s.querySelector("[data-kb]") as HTMLDivElement;
  const msg = s.querySelector("[data-kbmsg]") as HTMLDivElement;
  let capturing: { action: Action; slot: number } | null = null;
  let ignoreClicksUntil = 0;

  const renderKeys = (): void => {
    grid.innerHTML = ACTIONS.map((a) => {
      const slots = Array.from({ length: SLOTS }, (_, i) => {
        const code = cur.bindings[a][i];
        const active =
          capturing && capturing.action === a && capturing.slot === i;
        return `<button class="kb-slot${active ? " capturing" : ""}${code ? "" : " empty"}" data-ka="${a}" data-ks="${i}">${active ? t("pressKey") : code ? esc(keyLabel(code)) : "＋"}</button>`;
      }).join("");
      return `<div class="kb-row${cur.bindings[a].length ? "" : " unbound"}"><span>${ACTION_LABELS[a][lang]}</span>${slots}</div>`;
    }).join("");
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
    msg.textContent = "";
    input.capture = (code) => {
      if (code === "Escape") return stopCapture(false);
      if (code === "Delete" || code === "Backspace") {
        clearKey(cur.bindings, action, slot);
      } else if (RESERVED.has(code)) {
        msg.textContent = `${keyLabel(code)} ${t("keyReserved")}`;
        return stopCapture(false);
      } else {
        const lost = assignKey(
          cur.bindings,
          action,
          Math.min(slot, cur.bindings[action].length),
          code,
        );
        if (lost)
          msg.textContent = `${keyLabel(code)}: ${ACTION_LABELS[lost][lang]} → ${ACTION_LABELS[action][lang]}`;
      }
      const unbound = unboundActions(cur.bindings);
      if (unbound.length)
        msg.textContent += ` ⚠ ${t("unbound")}: ${unbound.map((u) => ACTION_LABELS[u][lang]).join(", ")}`;
      onChange({ ...cur, bindings: structuredClone(cur.bindings) });
      stopCapture(code.startsWith("Mouse"));
    };
    renderKeys();
  };
  renderKeys();

  s.addEventListener("input", (ev) => {
    const inp = ev.target as HTMLInputElement;
    const k = inp.dataset.r as "sensitivity" | "volume" | undefined;
    if (!k) return;
    cur[k] = Number(inp.value);
    const out = s.querySelector(`[data-o="${k}"]`)!;
    out.textContent =
      k === "volume"
        ? String(Math.round(cur.volume * 100))
        : cur.sensitivity.toFixed(2);
    onChange({ ...cur, bindings: structuredClone(cur.bindings) });
  });
  s.addEventListener("click", (ev) => {
    if (performance.now() < ignoreClicksUntil) return;
    const btn = (ev.target as HTMLElement).closest("button");
    if (!btn) return;
    if (btn.dataset.ka)
      return startCapture(btn.dataset.ka as Action, Number(btn.dataset.ks));
    if (capturing) return stopCapture(false);
    if (btn.dataset.a === "close") {
      input.capture = null;
      return onClose();
    }
    if (btn.dataset.a === "resetKeys") {
      cur.bindings = defaultBindings();
      msg.textContent = "";
      renderKeys();
      onChange({ ...cur, bindings: structuredClone(cur.bindings) });
      return;
    }
    const g = btn.closest("[data-seg]") as HTMLElement | null;
    if (g && btn.dataset.v) {
      (cur as unknown as Record<string, string>)[g.dataset.seg!] =
        btn.dataset.v;
      g.querySelectorAll("button").forEach((b) =>
        b.classList.toggle("on", b === btn),
      );
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
  againLabel = t("playAgain"),
): HTMLDivElement {
  const s = el("div", "screen dim results");
  const acc =
    m.stats.shots > 0 ? Math.round((m.stats.hits / m.stats.shots) * 100) : 0;
  s.innerHTML = `<div class="card" style="min-width:640px">
    <p class="verdict ${m.won ? "win" : "lose"}">${m.won ? t("victory") : t("defeat")}</p>
    <div style="text-align:center;color:var(--dim);letter-spacing:.3em">${m.roundsWon} - ${m.roundsLost}</div>
    <div class="total">${score.total.toLocaleString()}</div>
    ${rank >= 0 ? `<div class="newrec">${t("newRecord")} #${rank + 1}</div><div class="name-entry"><span>_</span><span>_</span><span>_</span></div><div style="text-align:center;color:var(--dim);font-size:13px">${t("enterName")}</div>` : ""}
    <div class="stat-grid">
      <div class="stat"><b>${m.stats.kills}</b><span>${t("kills")}</span></div>
      <div class="stat"><b>${m.stats.deaths}</b><span>${t("deaths")}</span></div>
      <div class="stat"><b>${m.stats.headshots}</b><span>${t("headshots")}</span></div>
      <div class="stat"><b>${acc}%</b><span>${t("accuracy")}</span></div>
      <div class="stat"><b>${m.stats.damage}</b><span>${t("damage")}</span></div>
    </div>
    <div class="breakdown">kills ${score.kills} · HS ${score.headshots} · dmg ${score.damage} · rounds ${score.rounds} · win ${score.match} · time ${score.time} · ×${score.difficultyMul}</div>
    ${replays ? `<div class="rounds">${history.map((r, i) => `<button class="${r.winner === 0 ? "w" : "l"}" data-r="${i}">${t("replay")} R${i + 1} · ${r.winner === 0 ? "W" : "L"} · ${Math.round(r.duration)}s</button>`).join("")}</div>` : ""}
    <div class="actions"><button data-a="title">${t("backToTitle")}</button><button class="primary" data-a="again">${esc(againLabel)}</button></div>
  </div>`;
  let name = "";
  let named = rank < 0;
  const slots = s.querySelectorAll<HTMLSpanElement>(".name-entry span");
  const render = () =>
    slots.forEach((sl, i) => (sl.textContent = name[i] ?? "_"));
  const onKey = (e: KeyboardEvent) => {
    if (named) return;
    if (/^Key[A-Z]$|^Digit[0-9]$/.test(e.code) && name.length < 3)
      name += e.code.slice(-1);
    else if (e.code === "Backspace") name = name.slice(0, -1);
    else if (e.code === "Enter") {
      named = true;
      h.submitName(name);
    }
    render();
  };
  window.addEventListener("keydown", onKey);
  (s as HTMLDivElement & { cleanup?: () => void }).cleanup = () => {
    window.removeEventListener("keydown", onKey);
    if (!named) {
      named = true;
      h.submitName(name);
    }
  };
  s.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest("button");
    if (!btn) return;
    if (btn.dataset.r) return h.replay(Number(btn.dataset.r));
    if (btn.dataset.a === "again") h.again();
    else if (btn.dataset.a === "title") h.title();
  });
  return s;
}

export interface MultiplayerHandlers {
  create(name: string): void;
  join(name: string, code: string): void;
  back(): void;
}

/** Name entry + create / join a room. `status` is an error or progress line. */
export function multiplayerScreen(
  name: string,
  status: string,
  busy: boolean,
  h: MultiplayerHandlers,
  isError = false,
): HTMLDivElement {
  const s = el("div", "screen dim");
  s.innerHTML = `<div class="card mp-card">
    <h2>${t("multiplayer")}</h2>
    <label class="mp-field"><span>${t("playerName")}</span><input data-i="name" maxlength="12" autocomplete="off" spellcheck="false" value="${esc(name)}" placeholder="PLAYER"></label>
    <div class="mp-actions"><button class="primary" data-a="create" ${busy ? "disabled" : ""}>${t("createRoom")}</button></div>
    <div class="mp-or">${t("roomCodeHint")}</div>
    <div class="mp-join"><input data-i="code" class="mp-code" maxlength="4" autocomplete="off" spellcheck="false" placeholder="ABCD"><button data-a="join" ${busy ? "disabled" : ""}>${t("joinRoom")}</button></div>
    <div class="mp-status${isError ? " err" : ""}">${esc(status)}</div>
    <div class="actions"><button data-a="back">${t("backToTitle")}</button></div>
  </div>`;
  const nameEl = s.querySelector('[data-i="name"]') as HTMLInputElement;
  const codeEl = s.querySelector('[data-i="code"]') as HTMLInputElement;
  codeEl.addEventListener("input", () => {
    codeEl.value = codeEl.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });
  const join = () => h.join(nameEl.value.trim(), codeEl.value.trim());
  codeEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") join();
  });
  s.addEventListener("click", (ev) => {
    const a = (ev.target as HTMLElement).closest("button")?.dataset.a;
    if (a === "create") h.create(nameEl.value.trim());
    else if (a === "join") join();
    else if (a === "back") h.back();
  });
  return s;
}

export interface LobbyHandlers {
  config(c: RoomConfig): void;
  team(team: 0 | 1): void;
  start(): void;
  leave(): void;
}

/** Room lobby: code to share, players per side, host-only match settings. */
export function lobbyScreen(
  lobby: LobbyState,
  mySlot: number,
  lang: "ja" | "en",
  h: LobbyHandlers,
): HTMLDivElement {
  const s = el("div", "screen dim");
  const host = lobby.host === mySlot;
  const c = lobby.config;
  const me = lobby.players.find((p) => p.slot === mySlot);
  const versus = c.mode === "versus";
  const seg = (key: keyof RoomConfig, opts: [string | number, string][]) =>
    `<div class="seg" data-cfg="${key}">${opts
      .map(
        ([v, label]) =>
          `<button data-v="${v}" class="${String(c[key]) === String(v) ? "on" : ""}" ${host ? "" : "disabled"}>${label}</button>`,
      )
      .join("")}</div>`;
  const player = (p: LobbyState["players"][number]) =>
    `<div class="mp-player${p.slot === mySlot ? " me" : ""}"><b>${esc(p.name)}</b>${p.slot === lobby.host ? `<small class="tag">${t("hostTag")}</small>` : ""}${p.slot === mySlot ? `<small class="tag you">${t("youTag")}</small>` : ""}<span class="ping">${p.rtt ? `${p.rtt} ms` : "—"}</span></div>`;
  const column = (team: 0 | 1) => {
    const list = lobby.players.filter((p) => !versus || p.team === team);
    return `<div class="mp-team ${team === 0 ? "atk" : "def"}"><h4>${team === 0 ? t("attackersTeam") : t("defendersTeam")}</h4>${
      !versus && team === 1
        ? `<div class="mp-bots">BOT × ${c.enemies || STAGES[c.stage].enemies}</div>`
        : list.map(player).join("") || `<div class="mp-bots">BOT</div>`
    }</div>`;
  };
  s.innerHTML = `<div class="card mp-card lobby">
    <h2>${t("lobby")}</h2>
    <div class="mp-room"><span>${t("roomCode")}</span><b>${esc(lobby.code)}</b><small>${t("lobbyShare")}</small></div>
    <div class="mp-teams">${column(0)}${column(1)}</div>
    ${versus && me ? `<div class="mp-switch"><button data-a="switch">${t("switchTeam")}</button></div>` : ""}
    <div class="settings-row"><span>${t("mode")}</span>${seg("mode", [
      ["coop", t("modeCoop")],
      ["versus", t("modeVersus")],
    ])}<span></span></div>
    <div class="settings-row"><span>${t("stage")}</span>${seg(
      "stage",
      STAGES.map((st, i): [number, string] => [i, `${esc(st.title[lang])}`]),
    )}<span></span></div>
    ${
      versus
        ? `<div class="settings-row"><span>${t("teamSize")}</span>${seg(
            "teamSize",
            Array.from({ length: NET.maxTeamSize }, (_, i): [number, string] => [i + 1, String(i + 1)]),
          )}<small style="color:var(--dim)">${t("teamSizeHint")}</small></div>`
        : `<div class="settings-row"><span>${t("enemies")}</span>${seg("enemies", [
            [0, t("stageDefault")],
            ...[3, 4, 5, 6, 7, 8].map((n): [number, string] => [n, String(n)]),
          ])}<span></span></div>`
    }
    <div class="mp-delay">${t("inputDelay")}: ${Math.round((computeDelay(lobby.players.map((p) => p.rtt)) * 1000) / MOVEMENT.tickRate)} ms</div>
    <div class="mp-status">${lobby.state === "game" ? t("inGameNow") : host ? "" : t("waitHost")}</div>
    <div class="actions"><button data-a="leave">${t("leaveRoom")}</button>${host ? `<button class="primary" data-a="start" ${lobby.state === "game" ? "disabled" : ""}>${t("startMatch")}</button>` : ""}</div>
  </div>`;
  s.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest("button");
    if (!btn || btn.disabled) return;
    const a = btn.dataset.a;
    if (a === "leave") return h.leave();
    if (a === "start") return h.start();
    if (a === "switch" && me) return h.team(me.team === 0 ? 1 : 0);
    const key = (btn.parentElement as HTMLElement | null)?.dataset.cfg as keyof RoomConfig | undefined;
    if (key && host) {
      const v = btn.dataset.v!;
      h.config({ ...c, [key]: key === "mode" ? v : Number(v) } as RoomConfig);
    }
  });
  return s;
}
