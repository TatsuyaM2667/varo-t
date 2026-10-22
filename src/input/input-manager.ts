import { INPUT } from '../config/input';
import { ANGLE_UNITS, wrapYaw } from '../sim/core/fmath';
import { Btn, type InputFrame } from '../sim/input-frame';

type Action = keyof typeof INPUT.keys;

const ACTION_BUTTON: Partial<Record<Action, number>> = {
  forward: Btn.Forward,
  back: Btn.Back,
  left: Btn.Left,
  right: Btn.Right,
  walk: Btn.Walk,
  jump: Btn.Jump,
  crouch: Btn.Crouch,
  reload: Btn.Reload,
  weapon1: Btn.Weapon1,
  weapon2: Btn.Weapon2,
  weapon3: Btn.Weapon3,
  ability1: Btn.Ability1,
  ability2: Btn.Ability2,
};

const PITCH_LIMIT = (INPUT.pitchLimit / 360) * ANGLE_UNITS;

/**
 * Collects keyboard/mouse state and turns it into one quantised InputFrame
 * per sim tick. Presses shorter than a tick are latched so they are never
 * lost, and look angles are accumulated in fractional units then rounded,
 * so no sub-unit motion is dropped over time.
 */
export class InputManager {
  private readonly codeToButton = new Map<string, number>();
  private held = 0;
  private latched = 0;
  private yaw = 0;
  private pitch = 0;
  sensitivity: number = INPUT.defaultSensitivity;
  /** extra multiplier from ADS / scope, set by the game each frame */
  lookScale = 1;
  enabled = false;
  /** wall-clock ms of the last user activity (for the idle watchdog) */
  lastActivity = performance.now();
  readonly heldCodes = new Set<string>();
  /** set when navigator.keyboard.lock() succeeded (Ctrl+W etc. are then captured) */
  keyboardLocked = false;

  constructor(private readonly target: HTMLElement) {
    for (const [action, codes] of Object.entries(INPUT.keys) as [Action, readonly string[]][]) {
      const btn = ACTION_BUTTON[action];
      if (btn === undefined) continue;
      for (const c of codes) this.codeToButton.set(c, btn);
    }
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('blur', this.clear);
    window.addEventListener('contextmenu', this.preventContext);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('blur', this.clear);
    window.removeEventListener('contextmenu', this.preventContext);
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.target;
  }

  async lockPointer(): Promise<void> {
    if (this.pointerLocked) return;
    // Chrome rejects lock requests during a fullscreen transition and for ~1 s after the
    // user pressed Esc; retry once after that window (activation is still valid).
    const retry = (): void => {
      document.removeEventListener('pointerlockerror', retry);
      setTimeout(() => {
        if (!this.pointerLocked) void this.lockOnce();
      }, 1100);
    };
    document.addEventListener('pointerlockerror', retry, { once: true });
    await this.lockOnce();
    setTimeout(() => document.removeEventListener('pointerlockerror', retry), 2000);
  }

  private async lockOnce(): Promise<void> {
    if (this.pointerLocked) return;
    try {
      // Raw (unaccelerated) mouse where supported.
      await (this.target.requestPointerLock as (o?: unknown) => Promise<void>).call(this.target, { unadjustedMovement: true });
    } catch {
      try {
        await this.target.requestPointerLock();
      } catch {
        /* user gesture missing; the click handler will retry */
      }
    }
  }

  setLook(yawUnits: number, pitchUnits: number): void {
    this.yaw = yawUnits;
    this.pitch = pitchUnits;
  }

  /** Fractional look angles for the camera (no tick quantisation lag). */
  get lookYaw(): number {
    return this.yaw;
  }

  get lookPitch(): number {
    return this.pitch;
  }

  /** Build the InputFrame for the next tick and clear latched presses. */
  sample(extraButtons = 0): InputFrame {
    const buttons = this.enabled ? this.held | this.latched | extraButtons : 0;
    this.latched = 0;
    return { buttons, yaw: wrapYaw(Math.round(this.yaw)), pitch: Math.round(this.pitch) };
  }

  private markActivity(): void {
    this.lastActivity = performance.now();
  }

  /**
   * Ctrl only crouches when Keyboard Lock is active in fullscreen: otherwise
   * Ctrl+W (crouch + forward) would close the browser tab. C always works.
   */
  private ctrlUsable(): boolean {
    return this.keyboardLocked && !!document.fullscreenElement;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.markActivity();
    this.heldCodes.add(e.code);
    // block browser shortcuts (Ctrl+S save, Ctrl+D bookmark, …) while playing
    if (this.enabled && (e.ctrlKey || e.altKey || e.metaKey)) e.preventDefault();
    const isCtrl = e.code === 'ControlLeft' || e.code === 'ControlRight';
    if (isCtrl && !this.ctrlUsable()) return;
    const btn = this.codeToButton.get(e.code);
    if (btn !== undefined && this.enabled) {
      e.preventDefault();
      this.held |= btn;
      this.latched |= btn;
    } else if (e.code === 'Tab' || e.code === 'Space') {
      e.preventDefault();
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.heldCodes.delete(e.code);
    const btn = this.codeToButton.get(e.code);
    if (btn !== undefined) this.held &= ~btn;
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    this.markActivity();
    if (!this.enabled || !this.pointerLocked) return;
    if (e.button === 0) {
      this.held |= Btn.Fire;
      this.latched |= Btn.Fire;
    } else if (e.button === 2) {
      this.held |= Btn.Ads;
      this.latched |= Btn.Ads;
    }
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.held &= ~Btn.Fire;
    else if (e.button === 2) this.held &= ~Btn.Ads;
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    this.markActivity();
    if (!this.enabled || !this.pointerLocked) return;
    const unitsPerCount = ((INPUT.degreesPerCount * this.sensitivity * this.lookScale) / 360) * ANGLE_UNITS;
    this.yaw += e.movementX * unitsPerCount;
    this.pitch -= e.movementY * unitsPerCount * (INPUT.invertY ? -1 : 1);
    if (this.pitch > PITCH_LIMIT) this.pitch = PITCH_LIMIT;
    if (this.pitch < -PITCH_LIMIT) this.pitch = -PITCH_LIMIT;
  };

  private readonly clear = (): void => {
    this.held = 0;
    this.latched = 0;
    this.heldCodes.clear();
  };

  private readonly preventContext = (e: Event): void => e.preventDefault();
}
