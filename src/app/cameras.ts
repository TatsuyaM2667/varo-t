import type { CameraPose } from '../render/game-renderer';
import type { Bvh } from '../sim/physics/bvh';

/** Over-the-shoulder camera behind an eye pose, pulled in when a wall is in the way. */
export function shoulderCam(eye: { x: number; y: number; z: number; yaw: number; pitch: number }, bvh: Bvh, back = 2.4, side = 0.55, up = 0.35): CameraPose {
  const fx = Math.sin(eye.yaw) * Math.cos(eye.pitch);
  const fy = Math.sin(eye.pitch);
  const fz = Math.cos(eye.yaw) * Math.cos(eye.pitch);
  const rx = Math.cos(eye.yaw);
  const rz = -Math.sin(eye.yaw);
  let dx = -fx * back + rx * side;
  let dy = -fy * back + up;
  let dz = -fz * back + rz * side;
  const len = Math.hypot(dx, dy, dz);
  const hit = bvh.raycast(eye.x, eye.y, eye.z, dx / len, dy / len, dz / len, len);
  const k = hit ? Math.max(0.15, hit.t - 0.25) / len : 1;
  dx *= k;
  dy *= k;
  dz *= k;
  return { x: eye.x + dx, y: eye.y + dy, z: eye.z + dz, yaw: eye.yaw, pitch: eye.pitch };
}

/** Smoothly chase a target pose (for spectator/attract cameras). */
export class SmoothCam {
  pose: CameraPose | null = null;

  follow(target: CameraPose, dt: number, stiffness = 6): CameraPose {
    if (!this.pose) {
      this.pose = { ...target };
      return this.pose;
    }
    const k = 1 - Math.exp(-dt * stiffness);
    const p = this.pose;
    p.x += (target.x - p.x) * k;
    p.y += (target.y - p.y) * k;
    p.z += (target.z - p.z) * k;
    let dyaw = (target.yaw - p.yaw) % (Math.PI * 2);
    if (dyaw > Math.PI) dyaw -= Math.PI * 2;
    if (dyaw < -Math.PI) dyaw += Math.PI * 2;
    p.yaw += dyaw * k;
    p.pitch += (target.pitch - p.pitch) * k;
    return p;
  }

  snap(target: CameraPose): void {
    this.pose = { ...target };
  }
}
