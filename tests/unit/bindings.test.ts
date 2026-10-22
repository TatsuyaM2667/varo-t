import { describe, expect, it } from 'vitest';
import { ACTIONS, assignKey, bindingLabel, clearKey, defaultBindings, keyLabel, resolveBindings, unboundActions } from '../../src/input/bindings';

describe('key bindings', () => {
  it('defaults bind every action', () => {
    expect(unboundActions(defaultBindings())).toEqual([]);
    expect(defaultBindings().fire).toEqual(['Mouse0']);
  });

  it('assigning a key used elsewhere moves it (no double bindings)', () => {
    const b = defaultBindings();
    const lost = assignKey(b, 'jump', 0, 'KeyQ'); // Q was smoke
    expect(lost).toBe('ability1');
    expect(b.jump[0]).toBe('KeyQ');
    expect(b.ability1).not.toContain('KeyQ');
    const all = ACTIONS.flatMap((a) => b[a]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('second slot and clearing', () => {
    const b = defaultBindings();
    assignKey(b, 'fire', 1, 'KeyF');
    expect(b.fire).toEqual(['Mouse0', 'KeyF']);
    clearKey(b, 'fire', 0);
    expect(b.fire).toEqual(['KeyF']);
  });

  it('refuses reserved keys and survives garbage from storage', () => {
    const b = defaultBindings();
    expect(assignKey(b, 'jump', 0, 'Escape')).toBeNull();
    expect(b.jump).toEqual(['Space']);
    const r = resolveBindings({ jump: ['KeyJ', 42, 'Escape'], fire: 'nope', bogus: ['KeyZ'] });
    expect(r.jump).toEqual(['KeyJ']);
    expect(r.fire).toEqual(['Mouse0']);
    expect(resolveBindings(null)).toEqual(defaultBindings());
  });

  it('labels keys readably', () => {
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('Digit3')).toBe('3');
    expect(keyLabel('Mouse2')).toBe('右クリック');
    expect(bindingLabel(defaultBindings(), 'crouch')).toBe('L-Ctrl / C');
  });
});
