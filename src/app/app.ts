import { AudioEngine } from "../audio/audio-engine";
import { type Features, resolveFeatures } from "../config/features";
import {
  QUALITY_PRESETS,
  type QualityName,
  type QualityPreset,
} from "../config/quality";
import type { InputManager } from "../input/input-manager";
import type { EngineHandle } from "../render/engine";
import { setLang, t } from "../ui/i18n";
import {
  howtoScreen,
  lobbyScreen,
  multiplayerScreen,
  resultsScreen,
  settingsScreen,
  titleScreen,
} from "../ui/screens";
import { Lockstep } from "../net/lockstep";
import {
  type ErrorCode,
  type MatchSetup,
  ROOM_CODE_RE,
  buildMatch,
  randomRoomCode,
} from "../net/protocol";
import { RelayClient, relayUrl } from "../net/relay-client";
import { STAGES } from "../sim/map/registry";
import { AttractMode } from "./attract";
import {
  computeScore,
  insertHighScore,
  loadHighScores,
  rankFor,
} from "./highscore";
import { IdleWatchdog } from "./idle-watchdog";
import {
  type MatchPlan,
  type MatchResult,
  MatchMode,
  type ModeContext,
  soloPlan,
} from "./match";
import { ReplayViewer } from "./replay-viewer";
import { type Settings, loadSettings, saveSettings } from "./settings";
import { type KV, browserKV } from "./storage";

/** Exhibition timings. ★ 展示用の時間設定 */
export const EXHIBIT = {
  /** no input for this long anywhere but the title → back to title */
  idleToTitleSec: 60,
  /** title untouched for this long → full-screen bot demo */
  titleToAttractSec: 30,
  /** seconds the error screen stays before recovering */
  crashRecoverSec: 3,
  /** this many crashes within a minute → full page reload */
  crashReloadCount: 3,
};

type State =
  | "title"
  | "howto"
  | "settings"
  | "match"
  | "results"
  | "replay"
  | "mp"
  | "lobby";

export function detectQuality(gfx: EngineHandle): QualityName {
  let renderer = "";
  try {
    const info = (
      gfx.engine as unknown as {
        getGlInfo?: () => { renderer?: string; vendor?: string };
      }
    ).getGlInfo?.();
    renderer = `${info?.vendor ?? ""} ${info?.renderer ?? ""}`;
  } catch {
    /* ignore */
  }
  if (/swiftshader|llvmpipe|software/i.test(renderer)) return "low";
  // Only clearly discrete GPUs start on High; integrated ones (Intel UHD/Iris,
  // Radeon 680M/780M, Apple…) start on Medium, which measured 60 fps on a 680M.
  if (/nvidia|geforce|rtx|gtx|radeon rx|radeon pro|arc a\d/i.test(renderer))
    return "high";
  return "medium";
}

export class App {
  private state: State = "title";
  private readonly kv: KV = browserKV();
  settings: Settings;
  private audio: AudioEngine | null = null;
  private attract: AttractMode | null = null;
  private match: MatchMode | null = null;
  private replay: ReplayViewer | null = null;
  /** relay connection while in a multiplayer room */
  private net: RelayClient | null = null;
  private lastResult: MatchResult | null = null;
  private submitted = false;
  private screen: HTMLElement | null = null;
  private readonly overlay: HTMLDivElement;
  private readonly fps: HTMLDivElement;
  private readonly idle: IdleWatchdog;
  private readonly titleIdle: IdleWatchdog;
  private crashes: number[] = [];
  private recovering = false;
  private last = performance.now();
  private showDebug: boolean;
  qualityName: QualityName;
  features: Features;
  quality: QualityPreset;

  constructor(
    readonly gfx: EngineHandle,
    readonly input: InputManager,
    readonly ui: HTMLElement,
    private readonly params: URLSearchParams,
  ) {
    this.settings = loadSettings(this.kv);
    setLang(this.settings.lang);
    this.qualityName = this.resolveQualityName();
    this.quality = QUALITY_PRESETS[this.qualityName];
    this.features = this.withSafeMode(
      resolveFeatures(this.quality.features, params.get("f")),
    );
    this.input.sensitivity = this.settings.sensitivity;
    this.input.setBindings(this.settings.bindings);
    this.overlay = document.createElement("div");
    ui.append(this.overlay);
    this.fps = document.createElement("div");
    this.fps.className = "fps";
    ui.append(this.fps);
    this.showDebug = params.has("debug");
    const now = performance.now() / 1000;
    // ?idle=N&attract=N shorten the exhibition timers (for tests / rehearsals)
    const num = (k: string, d: number): number =>
      params.has(k) && Number(params.get(k)) > 0 ? Number(params.get(k)) : d;
    this.idle = new IdleWatchdog(
      num("idle", EXHIBIT.idleToTitleSec),
      () => this.onIdle(),
      now,
    );
    this.titleIdle = new IdleWatchdog(
      num("attract", EXHIBIT.titleToAttractSec),
      () => this.enterShowcase(),
      now,
    );

    const poke = (): void => {
      const n = performance.now() / 1000;
      this.idle.poke(n);
      this.titleIdle.poke(n);
      this.audio?.resume();
      if (this.attract?.showcase) this.exitShowcase();
    };
    for (const ev of ["keydown", "mousedown", "mousemove", "wheel"])
      window.addEventListener(ev, poke, { passive: true });
    window.addEventListener("keydown", (e) => {
      if (e.code === "F3") {
        this.showDebug = !this.showDebug;
        e.preventDefault();
      }
    });
    document.addEventListener("pointerlockchange", () => this.onPointerLock());
  }

  /** Crashes earlier in this browser session progressively disable risky features. */
  static safeLevel(): number {
    try {
      const raw = sessionStorage.getItem("halcyon.crash");
      if (!raw) return 0;
      const { n, t: at } = JSON.parse(raw) as { n: number; t: number };
      return Date.now() - at < 5 * 60_000 ? n : 0;
    } catch {
      return 0;
    }
  }

  private withSafeMode(f: Features): Features {
    const lvl = App.safeLevel();
    if (lvl >= 1) {
      f.ssao = false;
      f.volumetricLight = false;
      f.gpuParticles = false;
    }
    if (lvl >= 2) {
      f.pbrLighting = false;
      f.destructibles = false;
    }
    return f;
  }

  private resolveQualityName(): QualityName {
    if (App.safeLevel() >= 2) return "low";
    const q = this.params.get("q") as QualityName | null;
    if (q && q in QUALITY_PRESETS) return q;
    if (this.settings.quality !== "auto") return this.settings.quality;
    return detectQuality(this.gfx);
  }

  private ctx(): ModeContext {
    return {
      gfx: this.gfx,
      input: this.input,
      audio: this.ensureAudio(),
      ui: this.ui,
      features: this.features,
      quality: this.quality,
      onQualityChange: (q, reason) =>
        console.info(`[quality] → scale ${q.renderScale} (${reason})`),
    };
  }

  private ensureAudio(): AudioEngine | null {
    if (!this.features.proceduralAudio) return null;
    if (!this.audio) {
      try {
        this.audio = new AudioEngine();
        this.audio.setVolume(this.settings.volume);
      } catch (err) {
        console.warn("[audio] unavailable", err);
      }
    }
    return this.audio;
  }

  // ------------------------------------------------------------- states

  private setScreen(s: HTMLElement | null): void {
    const old = this.screen as (HTMLElement & { cleanup?: () => void }) | null;
    old?.cleanup?.();
    old?.remove();
    this.screen = s;
    if (s) this.overlay.append(s);
  }

  private ensureAttract(): void {
    if (this.attract) return;
    this.attract = new AttractMode(this.ctx(), this.features.attractMode);
  }

  /**
   * Dispose the title demo after the current frame has been submitted: under
   * WebGPU, destroying its render targets mid-frame invalidates that frame.
   */
  private retireAttract(): void {
    const old = this.attract;
    this.attract = null;
    if (old) this.gfx.engine.onEndFrameObservable.addOnce(() => old.dispose());
  }

  private disposeModes(): void {
    this.match?.dispose();
    this.match = null;
    this.replay?.dispose();
    this.replay = null;
  }

  goTitle(): void {
    this.leaveRoom();
    this.disposeModes();
    if (document.pointerLockElement) document.exitPointerLock();
    this.input.enabled = false;
    this.state = "title";
    this.ensureAttract();
    this.attract!.setShowcase(false);
    this.titleIdle.poke(performance.now() / 1000);
    this.setScreen(
      titleScreen(this.settings, loadHighScores(this.kv), {
        play: () => this.goHowto(true),
        multiplayer: () => {
          this.audio?.ui("click");
          this.goMultiplayer();
        },
        howto: () => this.goHowto(false),
        settings: () => this.goSettings(),
        stage: (i) => {
          this.settings.stage = i;
          this.settings.difficulty = STAGES[i].difficulty;
          saveSettings(this.kv, this.settings);
          this.audio?.ui("click");
        },
        hover: () => this.audio?.ui("hover"),
      }),
    );
  }

  private enterShowcase(): void {
    if (this.state !== "title" || !this.attract) return;
    this.attract.setShowcase(true);
    if (this.screen) this.screen.hidden = true;
    const banner = document.createElement("div");
    banner.className = "attract-banner";
    banner.textContent = t("attractBanner");
    banner.dataset.attract = "1";
    const tag = document.createElement("div");
    tag.className = "attract-tag";
    tag.textContent = t("demo");
    tag.dataset.attract = "1";
    this.overlay.append(banner, tag);
  }

  private exitShowcase(): void {
    this.attract?.setShowcase(false);
    this.overlay.querySelectorAll("[data-attract]").forEach((e) => e.remove());
    if (this.screen) this.screen.hidden = false;
  }

  private goHowto(startable: boolean): void {
    this.state = "howto";
    this.ensureAudio();
    this.audio?.ui("click");
    this.setScreen(
      howtoScreen(
        this.settings.bindings,
        startable,
        () => this.startMatch(),
        () => this.goTitle(),
      ),
    );
  }

  /** Settings screen; `fromMatch` = opened from the pause menu over a running match. */
  private goSettings(fromMatch = false): void {
    if (!fromMatch) this.state = "settings";
    else this.match?.setOverlayHidden(true);
    this.setScreen(
      settingsScreen(
        this.settings,
        this.input,
        (s: Settings) => {
          const langChanged = s.lang !== this.settings.lang;
          const qualityChanged = s.quality !== this.settings.quality;
          this.settings = s;
          saveSettings(this.kv, s);
          this.input.sensitivity = s.sensitivity;
          this.input.setBindings(s.bindings);
          this.audio?.setVolume(s.volume);
          setLang(s.lang);
          if (qualityChanged && !fromMatch) {
            this.qualityName = this.resolveQualityName();
            this.quality = QUALITY_PRESETS[this.qualityName];
            this.features = this.withSafeMode(
              resolveFeatures(this.quality.features, this.params.get("f")),
            );
            this.retireAttract();
            this.ensureAttract();
          }
          if (qualityChanged && fromMatch) {
            // applied when the next match starts
            this.qualityName = this.resolveQualityName();
            this.quality = QUALITY_PRESETS[this.qualityName];
            this.features = this.withSafeMode(
              resolveFeatures(this.quality.features, this.params.get("f")),
            );
          }
          if (langChanged) this.goSettings(fromMatch);
        },
        () => {
          if (!fromMatch) return this.goTitle();
          this.setScreen(null);
          this.match?.refreshBindings();
          this.match?.setOverlayHidden(false);
        },
      ),
    );
  }

  private startMatch(): void {
    const stage = STAGES[this.settings.stage] ?? STAGES[0];
    this.launch(
      soloPlan(stage, this.settings.enemies || stage.enemies, this.features),
    );
  }

  private launch(plan: MatchPlan): void {
    this.disposeModes();
    this.setScreen(null);
    this.retireAttract();
    this.state = "match";
    // Fullscreen first, pointer lock after it settles: requesting both at once
    // makes Chrome reject the lock mid-transition (game stuck on "paused").
    void this.enterFullscreen().then(() => this.input.lockPointer());
    this.match = new MatchMode(
      this.ctx(),
      plan,
      (r) => this.onMatchEnd(r),
      () => this.goTitle(),
      () => this.goSettings(true),
    );
    this.input.enabled = this.input.pointerLocked;
    this.match.setPaused(
      !this.input.pointerLocked && !this.params.has("autostart"),
    );
  }

  /** Best-effort fullscreen + Keyboard Lock; resolves when settled (never rejects). */
  private async enterFullscreen(): Promise<void> {
    if (this.params.get("fs") === "0") return;
    try {
      if (!document.fullscreenElement)
        await document.documentElement.requestFullscreen();
    } catch {
      /* not allowed (no user gesture, iframe…): play windowed */
    }
    try {
      await (
        navigator as Navigator & { keyboard?: { lock?: () => Promise<void> } }
      ).keyboard?.lock?.();
      this.input.keyboardLocked = true;
    } catch {
      this.input.keyboardLocked = false;
    }
  }

  // ------------------------------------------------------- multiplayer

  /** Name entry + create/join. `status` shows progress or the last error. */
  private goMultiplayer(status = "", isError = false, busy = false): void {
    this.disposeModes();
    if (document.pointerLockElement) document.exitPointerLock();
    this.input.enabled = false;
    this.state = "mp";
    this.ensureAttract();
    this.attract!.setShowcase(false);
    this.setScreen(
      multiplayerScreen(
        this.settings.name,
        status,
        busy,
        {
          create: (name) => {
            const rand = () =>
              crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000;
            this.joinRoom(name, randomRoomCode(rand));
          },
          join: (name, code) =>
            ROOM_CODE_RE.test(code)
              ? this.joinRoom(name, code)
              : this.goMultiplayer(t("errCode"), true),
          back: () => this.goTitle(),
        },
        isError,
      ),
    );
  }

  private joinRoom(name: string, code: string): void {
    this.settings.name = name.slice(0, 12);
    saveSettings(this.kv, this.settings);
    this.leaveRoom();
    this.goMultiplayer(t("connecting"), false, true);
    const c = new RelayClient(
      relayUrl(this.params),
      code,
      name || "PLAYER",
      __BUILD_ID__,
    );
    this.net = c;
    c.onLobby = () => {
      if (this.state === "lobby") this.renderLobby();
    };
    c.onStart = (setup) => this.startOnline(setup);
    c.onClose = (err) => {
      if (this.net !== c) return;
      this.net = null;
      if (this.state === "match") this.match?.netClosed();
      else if (this.state === "lobby" || this.state === "mp")
        this.goMultiplayer(netError(err), true);
    };
    c.joined().then(
      () => {
        if (this.net === c) this.goLobby();
      },
      (err: ErrorCode | null) => {
        if (this.net !== c) return;
        this.net = null;
        this.goMultiplayer(netError(err), true);
      },
    );
  }

  private leaveRoom(): void {
    const c = this.net;
    this.net = null;
    c?.close();
  }

  private goLobby(): void {
    if (!this.net) return this.goMultiplayer(t("disconnected"), true);
    this.disposeModes();
    if (document.pointerLockElement) document.exitPointerLock();
    this.input.enabled = false;
    this.state = "lobby";
    this.ensureAttract();
    this.attract!.setShowcase(false);
    this.renderLobby();
  }

  private renderLobby(): void {
    const c = this.net;
    if (!c?.lobby) return;
    this.setScreen(
      lobbyScreen(c.lobby, c.slot, this.settings.lang, {
        config: (config) => {
          this.audio?.ui("click");
          c.send({ t: "config", config });
        },
        team: (team) => {
          this.audio?.ui("click");
          c.send({ t: "team", team });
        },
        start: () => {
          const f = this.features;
          c.send({
            t: "start",
            features: {
              destructibles: f.destructibles,
              seededMap: f.seededMap,
              utilityAi: f.botUtilityAi,
            },
          });
        },
        leave: () => {
          this.leaveRoom();
          this.goMultiplayer();
        },
      }),
    );
  }

  /** The host started: every client builds the same world from the setup. */
  private startOnline(setup: MatchSetup): void {
    const c = this.net;
    if (!c) return;
    const built = buildMatch(setup);
    const lockstep = new Lockstep({
      setup,
      localSlot: c.slot,
      send: (d) => c.raw(d),
      onDesync: (tick) => {
        console.warn(`[net] state hash mismatch at tick ${tick}`);
        this.match?.hud.notice(t("desync"));
      },
    });
    this.launch({
      stage: STAGES[setup.config.stage] ?? STAGES[0],
      options: built.options,
      localId: lockstep.localAgent,
      humanIds: built.humanIds,
      mode: setup.config.mode,
      net: { lockstep, client: c },
    });
  }

  private onMatchEnd(r: MatchResult): void {
    this.lastResult = r;
    this.submitted = false;
    // the room returns to its lobby once the host's match is over
    if (r.multiplayer && this.net?.isHost) this.net.send({ t: "reset" });
    // let the final banner play for a moment
    setTimeout(() => this.showResults(), 400);
  }

  private showResults(): void {
    const r = this.lastResult;
    if (!r) return;
    this.disposeModes();
    if (document.pointerLockElement) document.exitPointerLock();
    this.input.enabled = false;
    this.state = "results";
    this.ensureAttract();
    const score = computeScore(r.summary);
    // only offer name entry once per match (the screen is rebuilt after replays)
    const rank =
      this.submitted || r.multiplayer
        ? -1
        : rankFor(loadHighScores(this.kv), score.total);
    this.audio?.ui(r.summary.won ? "win" : "lose");
    this.setScreen(
      resultsScreen(
        r.summary,
        score,
        rank,
        r.history,
        this.features.roundReplay,
        {
          again: () =>
            r.multiplayer ? this.goLobby() : this.goHowto(true),
          title: () => this.goTitle(),
          replay: (round) => this.startReplay(round),
          submitName: (name) => {
            if (rank >= 0 && !this.submitted) {
              this.submitted = true;
              insertHighScore(this.kv, {
                name,
                score: score.total,
                kills: r.summary.stats.kills,
                won: r.summary.won,
                difficulty: r.summary.difficulty,
                stage: r.summary.stage,
                date: localDate(),
              });
            }
          },
        },
        r.multiplayer ? t("backToLobby") : t("playAgain"),
      ),
    );
  }

  private startReplay(round: number): void {
    const r = this.lastResult;
    if (!r) return;
    this.retireAttract();
    this.state = "replay";
    this.setScreen(null);
    this.replay = new ReplayViewer(
      this.ctx(),
      r.log,
      round,
      () => this.showResults(),
      r.localId,
    );
  }

  private onPointerLock(): void {
    const locked = this.input.pointerLocked;
    this.input.enabled = locked && this.state === "match";
    if (this.match) this.match.setPaused(!locked);
  }

  private onIdle(): void {
    // waiting in a room for friends is not "abandoned"
    if (this.state === "title" || this.state === "lobby") return;
    console.info("[exhibit] idle → title");
    this.goTitle();
  }

  // -------------------------------------------------------- frame / errors

  frame(): void {
    if (this.recovering) return;
    const now = performance.now();
    const dt = (now - this.last) / 1000;
    this.last = now;
    const ns = now / 1000;
    if (this.state !== "title") this.idle.update(ns);
    else this.titleIdle.update(ns);
    if (this.match) this.match.frame(dt);
    else if (this.replay) this.replay.frame(dt);
    else this.attract?.frame(dt);
    if (this.showDebug) {
      const r =
        this.match?.renderer ?? this.replay?.renderer ?? this.attract?.renderer;
      this.fps.textContent = `${this.gfx.kind} ${this.gfx.engine.getFps().toFixed(0)}fps  q=${this.qualityName} scale=${(1 / this.gfx.engine.getHardwareScalingLevel()).toFixed(2)}  meshes=${r?.scene.getActiveMeshes().length ?? 0}`;
    } else if (this.fps.textContent) this.fps.textContent = "";
  }

  /** Called on any uncaught error: show a message, tear down, return to title. */
  recover(err: unknown): void {
    console.error("[exhibit] recovering from", err);
    if (this.recovering) return;
    const now = Date.now();
    this.crashes = this.crashes.filter((t0) => now - t0 < 60_000);
    this.crashes.push(now);
    const lvl = App.safeLevel() + 1;
    try {
      sessionStorage.setItem(
        "halcyon.crash",
        JSON.stringify({ n: lvl, t: now }),
      );
    } catch {
      /* ignore */
    }
    if (this.crashes.length >= EXHIBIT.crashReloadCount || lvl >= 2) {
      // reload with safer settings (WebGL2 after repeated failures)
      const url = new URL(location.href);
      if (lvl >= 3) url.searchParams.set("engine", "webgl");
      location.replace(url.toString());
      return;
    }
    // drop the risky effects for the rest of this session
    this.features = this.withSafeMode(this.features);
    this.recovering = true;
    const box = document.createElement("div");
    box.className = "crash";
    box.textContent = t("errorRecover");
    this.ui.append(box);
    setTimeout(() => {
      try {
        this.disposeModes();
        this.retireAttract();
      } catch (e) {
        console.error(e);
      }
      box.remove();
      this.recovering = false;
      this.last = performance.now();
      try {
        this.goTitle();
      } catch {
        location.reload();
      }
    }, EXHIBIT.crashRecoverSec * 1000);
  }

  /** Test hook: current state and a few internals. */
  debugState() {
    return {
      state: this.state,
      match: this.match,
      attract: this.attract,
      replay: this.replay,
      quality: this.qualityName,
      features: this.features,
    };
  }
}

function netError(code: ErrorCode | null): string {
  if (code === "full") return t("errFull");
  if (code === "inGame") return t("errInGame");
  if (code === "version") return t("errVersion");
  return t("errNetwork");
}

function localDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
