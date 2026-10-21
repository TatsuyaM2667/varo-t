import { INPUT } from '../../config/input';
import { MOVEMENT } from '../../config/movement';
import { approach, clamp, cos, sin, unitsToRad, wrapYaw } from '../core/fmath';
import { Btn, type InputFrame, has } from '../input-frame';
import type { Body } from '../physics/body';
import { bodyOverlaps, moveBody, sweepAxis } from '../physics/body';
import type { Bvh } from '../physics/bvh';

export type Team = 0 | 1; // 0 = attackers, 1 = defenders

/** Everything about one combatant that the sim owns. Plain data for snapshots. */
export interface Agent {
  id: number;
  team: Team;
  isBot: boolean;
  name: string;

  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** angle units */
  yaw: number;
  pitch: number;

  grounded: boolean;
  /** ticks since last grounded (for coyote time) */
  airTicks: number;
  /** 0 = standing, 1 = fully crouched */
  crouch: number;
  height: number;
  prevButtons: number;

  /** remaining dash ticks and its direction */
  dashTicks: number;
  dashDx: number;
  dashDz: number;

  alive: boolean;
  /** true when the agent produced footstep noise this tick */
  noisy: boolean;
}

export function createAgent(id: number, team: Team, isBot: boolean, name: string): Agent {
  return {
    id,
    team,
    isBot,
    name,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
    grounded: false,
    airTicks: 0,
    crouch: 0,
    height: MOVEMENT.standHeight,
    prevButtons: 0,
    dashTicks: 0,
    dashDx: 0,
    dashDz: 0,
    alive: true,
    noisy: false,
  };
}

export function eyeHeight(a: Agent): number {
  return a.height - MOVEMENT.eyeOffsetFromTop;
}

export function horizontalSpeed(a: Agent): number {
  return Math.sqrt(a.vx * a.vx + a.vz * a.vz);
}

const PITCH_LIMIT_UNITS = Math.round((INPUT.pitchLimit / 360) * 65536);
const DT = 1 / MOVEMENT.tickRate;
// Symplectic Euler apex is v²/2g − v·dt/2; solve for v so the apex equals jumpHeight.
const JUMP_V = (MOVEMENT.gravity * DT) / 2 + Math.sqrt((MOVEMENT.gravity * DT) ** 2 / 4 + 2 * MOVEMENT.gravity * MOVEMENT.jumpHeight);
const COYOTE_TICKS = Math.round(MOVEMENT.coyoteTime * MOVEMENT.tickRate);

/** Optional modifiers supplied by weapon state (ADS slows you). */
export interface MoveModifiers {
  speedMul: number;
}

const body: Body = { x: 0, y: 0, z: 0, radius: MOVEMENT.bodyRadius, height: MOVEMENT.standHeight };

/** Start a dash in the current wish direction (or forward if none). */
export function startDash(a: Agent, input: InputFrame): void {
  const yaw = unitsToRad(a.yaw);
  let fx = 0;
  let fz = 0;
  if (has(input, Btn.Forward)) fz += 1;
  if (has(input, Btn.Back)) fz -= 1;
  if (has(input, Btn.Right)) fx += 1;
  if (has(input, Btn.Left)) fx -= 1;
  if (fx === 0 && fz === 0) fz = 1;
  const len = Math.sqrt(fx * fx + fz * fz);
  fx /= len;
  fz /= len;
  const s = sin(yaw);
  const c = cos(yaw);
  a.dashDx = fx * c + fz * s;
  a.dashDz = -fx * s + fz * c;
  a.dashTicks = Math.max(1, Math.round(MOVEMENT.dash.duration * MOVEMENT.tickRate));
}

export function stepAgentMovement(a: Agent, input: InputFrame, world: Bvh, mods: MoveModifiers): void {
  a.yaw = wrapYaw(input.yaw | 0);
  a.pitch = clamp(input.pitch | 0, -PITCH_LIMIT_UNITS, PITCH_LIMIT_UNITS);
  const pressed = input.buttons & ~a.prevButtons;
  a.prevButtons = input.buttons;

  if (!a.alive) {
    a.vx = a.vy = a.vz = 0;
    return;
  }

  // --- crouch ---
  const wantCrouch = has(input, Btn.Crouch);
  const crouchTarget = wantCrouch ? 1 : 0;
  const nextCrouch = approach(a.crouch, crouchTarget, MOVEMENT.crouchRate * DT);
  const nextHeight = MOVEMENT.standHeight + (MOVEMENT.crouchHeight - MOVEMENT.standHeight) * nextCrouch;
  body.x = a.x;
  body.y = a.y;
  body.z = a.z;
  body.height = nextHeight;
  if (nextHeight > a.height && bodyOverlaps(world, body)) {
    // ceiling above: stay as we are
  } else {
    // crouching mid-air pulls the legs up, keeping the head in place
    if (!a.grounded && nextHeight < a.height) {
      body.height = nextHeight;
      a.y += sweepAxis(world, body, 1, a.height - nextHeight);
    }
    a.crouch = nextCrouch;
    a.height = nextHeight;
  }

  // --- wish velocity ---
  const yaw = unitsToRad(a.yaw);
  let fx = 0;
  let fz = 0;
  if (has(input, Btn.Forward)) fz += 1;
  if (has(input, Btn.Back)) fz -= 1;
  if (has(input, Btn.Right)) fx += 1;
  if (has(input, Btn.Left)) fx -= 1;
  const s = sin(yaw);
  const c = cos(yaw);
  let wx = fx * c + fz * s;
  let wz = -fx * s + fz * c;
  const wl = Math.sqrt(wx * wx + wz * wz);
  if (wl > 0) {
    wx /= wl;
    wz /= wl;
  }
  let speed: number = MOVEMENT.runSpeed;
  if (a.crouch > 0.5) speed = MOVEMENT.crouchSpeed;
  else if (has(input, Btn.Walk)) speed = MOVEMENT.walkSpeed;
  speed *= mods.speedMul;

  if (a.dashTicks > 0) {
    const v = MOVEMENT.dash.distance / MOVEMENT.dash.duration;
    a.vx = a.dashDx * v;
    a.vz = a.dashDz * v;
    a.vy = 0;
    a.dashTicks--;
    if (a.dashTicks === 0) {
      a.vx = a.dashDx * MOVEMENT.runSpeed;
      a.vz = a.dashDz * MOVEMENT.runSpeed;
    }
  } else if (a.grounded) {
    const tx = wx * speed;
    const tz = wz * speed;
    const dx = tx - a.vx;
    const dz = tz - a.vz;
    const dl = Math.sqrt(dx * dx + dz * dz);
    const rate = (wl > 0 ? MOVEMENT.groundAccel : MOVEMENT.groundDecel) * DT;
    if (dl <= rate) {
      a.vx = tx;
      a.vz = tz;
    } else {
      a.vx += (dx / dl) * rate;
      a.vz += (dz / dl) * rate;
    }
  } else if (wl > 0) {
    // Air control: accelerate along wish dir without exceeding airMaxSpeed along it.
    const cur = a.vx * wx + a.vz * wz;
    const add = Math.min(MOVEMENT.airAccel * DT, Math.max(0, MOVEMENT.airMaxSpeed - cur));
    a.vx += wx * add;
    a.vz += wz * add;
  }

  // --- jump & gravity ---
  if ((pressed & Btn.Jump) !== 0 && a.dashTicks === 0 && (a.grounded || a.airTicks <= COYOTE_TICKS) && a.vy <= 0) {
    a.vy = JUMP_V;
    a.grounded = false;
    a.airTicks = COYOTE_TICKS + 1;
  }
  if (a.dashTicks === 0) a.vy -= MOVEMENT.gravity * DT;

  // --- integrate with collision ---
  body.x = a.x;
  body.y = a.y;
  body.z = a.z;
  body.height = a.height;
  const wasGrounded = a.grounded;
  const res = moveBody(world, body, a.vx * DT, a.vy * DT, a.vz * DT, wasGrounded, MOVEMENT.stepHeight);
  if (res.hitX) a.vx = 0;
  if (res.hitZ) a.vz = 0;
  let grounded = false;
  if (res.hitY) {
    if (a.vy < 0) grounded = true;
    a.vy = 0;
  }
  // Snap down to stay on stairs / slopes when walking off small ledges.
  if (!grounded && wasGrounded && a.vy <= 0) {
    const sy = body.y;
    const moved = sweepAxis(world, body, 1, -MOVEMENT.groundSnap);
    if (moved > -MOVEMENT.groundSnap + 1e-9) {
      grounded = true;
      a.vy = 0;
    } else {
      body.y = sy;
    }
  }
  a.x = body.x;
  a.y = body.y;
  a.z = body.z;
  a.grounded = grounded;
  a.airTicks = grounded ? 0 : a.airTicks + 1;
  a.noisy = grounded && !has(input, Btn.Walk) && a.crouch < 0.5 && horizontalSpeed(a) > MOVEMENT.walkSpeed + 0.3;
}
