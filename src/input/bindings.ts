import { INPUT } from '../config/input';
import { Btn } from '../sim/input-frame';

/**
 * Rebindable actions. Each action has up to two slots holding a
 * KeyboardEvent.code (e.g. "KeyW") or a mouse button as "Mouse0".."Mouse4".
 * Pure data + functions so it can be unit-tested and stored as JSON.
 */
export const ACTIONS = [
  'forward',
  'back',
  'left',
  'right',
  'walk',
  'jump',
  'crouch',
  'fire',
  'ads',
  'reload',
  'weapon1',
  'weapon2',
  'weapon3',
  'ability1',
  'ability2',
  'help',
] as const;

export type Action = (typeof ACTIONS)[number];
export type Bindings = Record<Action, string[]>;

export const SLOTS = 2;

/** Sim button each action drives ('help' is UI-only). */
export const ACTION_BUTTON: Partial<Record<Action, number>> = {
  forward: Btn.Forward,
  back: Btn.Back,
  left: Btn.Left,
  right: Btn.Right,
  walk: Btn.Walk,
  jump: Btn.Jump,
  crouch: Btn.Crouch,
  fire: Btn.Fire,
  ads: Btn.Ads,
  reload: Btn.Reload,
  weapon1: Btn.Weapon1,
  weapon2: Btn.Weapon2,
  weapon3: Btn.Weapon3,
  ability1: Btn.Ability1,
  ability2: Btn.Ability2,
};

export const ACTION_LABELS: Record<Action, { ja: string; en: string }> = {
  forward: { ja: '前進', en: 'Forward' },
  back: { ja: '後退', en: 'Back' },
  left: { ja: '左移動', en: 'Strafe left' },
  right: { ja: '右移動', en: 'Strafe right' },
  walk: { ja: '歩き（足音なし）', en: 'Walk (silent)' },
  jump: { ja: 'ジャンプ', en: 'Jump' },
  crouch: { ja: 'しゃがみ', en: 'Crouch' },
  fire: { ja: '射撃', en: 'Fire' },
  ads: { ja: '覗き込み', en: 'Aim down sights' },
  reload: { ja: 'リロード', en: 'Reload' },
  weapon1: { ja: '武器1（ライフル）', en: 'Weapon 1 (rifle)' },
  weapon2: { ja: '武器2（ピストル）', en: 'Weapon 2 (sidearm)' },
  weapon3: { ja: '武器3（スナイパー）', en: 'Weapon 3 (sniper)' },
  ability1: { ja: 'スモーク', en: 'Smoke' },
  ability2: { ja: 'ダッシュ', en: 'Dash' },
  help: { ja: '操作確認（押している間）', en: 'Show controls (hold)' },
};

/** Keys that can never be bound (pause / browser / OS). */
export const RESERVED = new Set(['Escape', 'F11', 'F12', 'MetaLeft', 'MetaRight', 'ContextMenu']);

export function defaultBindings(): Bindings {
  const k = INPUT.keys;
  const b: Bindings = {
    forward: [...k.forward],
    back: [...k.back],
    left: [...k.left],
    right: [...k.right],
    walk: [...k.walk],
    jump: [...k.jump],
    crouch: [...k.crouch],
    fire: ['Mouse0'],
    ads: ['Mouse2'],
    reload: [...k.reload],
    weapon1: [...k.weapon1],
    weapon2: [...k.weapon2],
    weapon3: [...k.weapon3],
    ability1: [...k.ability1],
    ability2: [...k.ability2],
    help: ['Tab', 'F1'],
  };
  for (const a of ACTIONS) b[a] = b[a].slice(0, SLOTS);
  return b;
}

/** Merge stored overrides over the defaults, dropping anything malformed. */
export function resolveBindings(stored: unknown): Bindings {
  const b = defaultBindings();
  if (!stored || typeof stored !== 'object') return b;
  for (const a of ACTIONS) {
    const v = (stored as Record<string, unknown>)[a];
    if (!Array.isArray(v)) continue;
    const codes = v.filter((c): c is string => typeof c === 'string' && c.length > 0 && c.length < 32 && !RESERVED.has(c)).slice(0, SLOTS);
    b[a] = codes;
  }
  return b;
}

/**
 * Put `code` in `action`'s `slot`. A code can only drive one action, so it
 * is removed from wherever else it was bound (the old owner loses it).
 * Returns the action that lost the key, if any.
 */
export function assignKey(b: Bindings, action: Action, slot: number, code: string): Action | null {
  if (RESERVED.has(code) || slot < 0 || slot >= SLOTS) return null;
  let stolenFrom: Action | null = null;
  for (const a of ACTIONS) {
    const i = b[a].indexOf(code);
    if (i >= 0 && !(a === action && i === slot)) {
      b[a].splice(i, 1);
      if (a !== action) stolenFrom = a;
    }
  }
  const list = b[action];
  if (slot < list.length) list[slot] = code;
  else list.push(code);
  b[action] = list.slice(0, SLOTS);
  return stolenFrom;
}

export function clearKey(b: Bindings, action: Action, slot: number): void {
  b[action].splice(slot, 1);
}

/** Actions with no key at all (shown as a warning in the settings screen). */
export function unboundActions(b: Bindings): Action[] {
  return ACTIONS.filter((a) => b[a].length === 0);
}

const NAMED: Record<string, string> = {
  Space: 'Space',
  ShiftLeft: 'L-Shift',
  ShiftRight: 'R-Shift',
  ControlLeft: 'L-Ctrl',
  ControlRight: 'R-Ctrl',
  AltLeft: 'L-Alt',
  AltRight: 'R-Alt',
  Tab: 'Tab',
  CapsLock: 'Caps',
  Enter: 'Enter',
  Backspace: 'BS',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Mouse0: '左クリック',
  Mouse1: 'ホイール押込',
  Mouse2: '右クリック',
  Mouse3: 'マウス4',
  Mouse4: 'マウス5',
};

/** Short human label for a code ("KeyW" → "W", "Mouse0" → "左クリック"). */
export function keyLabel(code: string): string {
  if (NAMED[code]) return NAMED[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num${code.slice(6)}`;
  return code;
}

/** Label of an action's bindings, e.g. "Q" or "C / L-Ctrl", "—" when unbound. */
export function bindingLabel(b: Bindings, action: Action): string {
  return b[action].length ? b[action].map(keyLabel).join(' / ') : '—';
}

export function isCtrlCode(code: string): boolean {
  return code === 'ControlLeft' || code === 'ControlRight';
}
