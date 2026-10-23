/**
 * Wire protocol shared by the game client and the relay Worker (server/).
 * Pure TS: no DOM, no Babylon, so the Worker bundle can import it.
 *
 * During a match, input packets go peer-to-peer over WebRTC data channels
 * where possible (free and fast); the relay carries the lobby, WebRTC
 * signaling, hashes, leave handling, and inputs for pairs that could not
 * connect directly.
 *
 * Control messages are JSON text frames. Inputs travel as binary frames:
 *   [u8 KIND_INPUTS][u8 slot][u32 firstTick][u8 count][u16 match] + count × [u32 packed, u32 yaw]
 * `match` (low bits of the match seed) keeps a late packet from the previous
 * match out of the next one.
 * The client writes slot 255; the relay stamps the sender's real slot.
 */
import { BOT_NAMES } from '../config/bots';
import { MOVEMENT } from '../config/movement';
import { NET } from '../config/net';
import { RULES } from '../config/rules';
import type { InputFrame } from '../sim/input-frame';
import { STAGES } from '../sim/map/registry';
import { packInput, unpackInput } from '../sim/replay/input-log';
import type { AgentSpec, SimFeatures, WorldOptions } from '../sim/world';

export type NetMode = 'coop' | 'versus';

export interface RoomConfig {
  mode: NetMode;
  /** index into STAGES */
  stage: number;
  /** coop: number of bot defenders (0 = the stage default) */
  enemies: number;
  /** versus: agents per team (humans + bots) */
  teamSize: number;
}

export const DEFAULT_ROOM_CONFIG: RoomConfig = { mode: 'coop', stage: 0, enemies: 0, teamSize: NET.defaultTeamSize };

export interface LobbyPlayer {
  slot: number;
  name: string;
  team: 0 | 1;
  /** conservative round trip on this player's slowest input path, ms */
  rtt: number;
  /** slots this player has an open peer-to-peer channel with */
  p2p: number[];
}

export interface MatchSetup {
  seed: number;
  config: RoomConfig;
  /** humans, sorted by slot */
  players: { slot: number; name: string; team: 0 | 1 }[];
  /** input delay in ticks, identical for everyone */
  delay: number;
  /** ticks per input packet (1 when every pair is peer-to-peer: those packets cost nothing) */
  batch?: number;
  features: SimFeatures;
}

export type ClientMsg =
  | { t: 'hello'; name: string; build: string }
  | { t: 'config'; config: RoomConfig }
  | { t: 'team'; team: 0 | 1 }
  | { t: 'start'; features: SimFeatures }
  | { t: 'reset' }
  | { t: 'ping'; c: number; rtt: number }
  | { t: 'hash'; tick: number; h: number }
  /** WebRTC offer/answer/candidate for one peer */
  | { t: 'signal'; to: number; data: unknown }
  | { t: 'links'; p2p: number[] }
  /** reply to `leaving`: we hold that player's inputs up to `next` − 1 */
  | { t: 'known'; slot: number; next: number }
  /** a leaver's frames (packed pairs, see packInput) re-sent to everyone */
  | { t: 'fill'; slot: number; first: number; data: number[] };

export type ErrorCode = 'full' | 'inGame' | 'version' | 'badRoom';

export type ServerMsg =
  | { t: 'welcome'; slot: number }
  | { t: 'lobby'; code: string; host: number; players: LobbyPlayer[]; config: RoomConfig; state: 'lobby' | 'game' }
  | { t: 'start'; setup: MatchSetup }
  | { t: 'pong'; c: number }
  | { t: 'hash'; slot: number; tick: number; h: number }
  | { t: 'signal'; from: number; data: unknown }
  | { t: 'leaving'; slot: number }
  | { t: 'left'; slot: number; tick: number; from: number; source: number }
  | { t: 'fill'; slot: number; first: number; data: number[] }
  | { t: 'error'; code: ErrorCode };

export const KIND_INPUTS = 1;
export const INPUT_HEADER = 9;
export const INPUT_STRIDE = 8;

/** Room codes: 4 characters without look-alikes (0/O, 1/I/L). */
export const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_RE = /^[A-HJKMNP-Z2-9]{4}$/;

export function randomRoomCode(rand: () => number): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += ROOM_ALPHABET[Math.floor(rand() * ROOM_ALPHABET.length)];
  return s;
}

/** The match tag carried by input packets. */
export const matchTag = (setup: MatchSetup): number => setup.seed & 0xffff;

export function encodeInputs(firstTick: number, frames: readonly InputFrame[], match = 0, slot = 255): ArrayBuffer {
  const buf = new ArrayBuffer(INPUT_HEADER + frames.length * INPUT_STRIDE);
  const v = new DataView(buf);
  v.setUint8(0, KIND_INPUTS);
  v.setUint8(1, slot);
  v.setUint32(2, firstTick);
  v.setUint8(6, frames.length);
  v.setUint16(7, match);
  frames.forEach((f, i) => {
    const [a, yaw] = packInput(f);
    v.setUint32(INPUT_HEADER + i * INPUT_STRIDE, a);
    v.setUint32(INPUT_HEADER + i * INPUT_STRIDE + 4, yaw);
  });
  return buf;
}

export interface InputPacket {
  slot: number;
  match: number;
  firstTick: number;
  frames: InputFrame[];
}

/** Returns null for anything that is not a well-formed input packet. */
export function decodeInputs(buf: ArrayBuffer): InputPacket | null {
  if (buf.byteLength < INPUT_HEADER) return null;
  const v = new DataView(buf);
  if (v.getUint8(0) !== KIND_INPUTS) return null;
  const count = v.getUint8(6);
  if (buf.byteLength !== INPUT_HEADER + count * INPUT_STRIDE) return null;
  const frames: InputFrame[] = [];
  for (let i = 0; i < count; i++) {
    const f = unpackInput(v.getUint32(INPUT_HEADER + i * INPUT_STRIDE), v.getUint32(INPUT_HEADER + i * INPUT_STRIDE + 4));
    if (f) frames.push(f);
  }
  return { slot: v.getUint8(1), firstTick: v.getUint32(2), match: v.getUint16(7), frames };
}

/** Input delay (ticks) that covers the worst player's input path and the batching. */
export function computeDelay(rtts: readonly number[], batch: number = NET.sendEveryTicks): number {
  const worst = Math.max(0, ...rtts);
  const tickMs = 1000 / MOVEMENT.tickRate;
  const d = Math.ceil((worst + NET.jitterMs) / tickMs) + batch - 1;
  return Math.min(NET.maxDelayTicks, Math.max(NET.minDelayTicks, d));
}

export function sanitizeConfig(c: Partial<RoomConfig> | undefined): RoomConfig {
  const int = (v: unknown, lo: number, hi: number, d: number): number =>
    typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : d;
  return {
    mode: c?.mode === 'versus' ? 'versus' : 'coop',
    stage: int(c?.stage, 0, STAGES.length - 1, 0),
    enemies: int(c?.enemies, 0, 8, 0),
    teamSize: int(c?.teamSize, 1, NET.maxTeamSize, NET.defaultTeamSize),
  };
}

export function sanitizeName(n: unknown): string {
  const s = typeof n === 'string' ? n.replace(/[\u0000-\u001f<>&"']/g, '').trim().slice(0, 12) : '';
  return s || 'PLAYER';
}

export interface BuiltMatch {
  options: WorldOptions;
  /** agent id of each human, by slot */
  agentOfSlot: Map<number, number>;
  /** agent ids of the humans, sorted by slot (the InputLog order) */
  humanIds: number[];
}

/**
 * The world every client builds from the start message. Must be a pure
 * function of the setup: all clients have to end up with identical worlds.
 *  - coop: every human attacks, bots defend (stage default count unless set)
 *  - versus: humans keep their chosen side; bots fill each side to teamSize
 */
export function buildMatch(setup: MatchSetup): BuiltMatch {
  const stage = STAGES[setup.config.stage] ?? STAGES[0];
  const roster: AgentSpec[] = [];
  const agentOfSlot = new Map<number, number>();
  const players = [...setup.players].sort((a, b) => a.slot - b.slot);
  let botName = 0;
  const addBots = (team: 0 | 1, n: number) => {
    for (let i = 0; i < n; i++)
      roster.push({ team, isBot: true, name: BOT_NAMES[botName++ % BOT_NAMES.length], difficulty: stage.difficulty });
  };
  const addHumans = (team: 0 | 1, list: typeof players, hpBonus: number) => {
    for (const p of list) {
      agentOfSlot.set(p.slot, roster.length);
      roster.push({ team, isBot: false, name: p.name, hpBonus });
    }
  };
  if (setup.config.mode === 'coop') {
    addHumans(0, players, RULES.playerHpBonus);
    addBots(1, setup.config.enemies || stage.enemies);
  } else {
    const side = (t: 0 | 1) => players.filter((p) => p.team === t);
    const size = Math.max(setup.config.teamSize, side(0).length, side(1).length);
    for (const t of [0, 1] as const) {
      addHumans(t, side(t), 0);
      addBots(t, size - side(t).length);
    }
  }
  return {
    options: { seed: setup.seed >>> 0, mapId: stage.map, roster, features: { ...setup.features } },
    agentOfSlot,
    humanIds: players.map((p) => agentOfSlot.get(p.slot)!),
  };
}
