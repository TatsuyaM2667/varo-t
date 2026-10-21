/**
 * Analytic two-bone IK (hip → knee → foot). Returns the knee position that
 * keeps both bone lengths, bending toward `pole`. If the target is out of
 * reach the chain straightens toward it. Pure math, unit-tested.
 */
export interface V3 {
  x: number;
  y: number;
  z: number;
}

export function solveTwoBone(hip: V3, foot: V3, l1: number, l2: number, pole: V3): { knee: V3; foot: V3 } {
  let dx = foot.x - hip.x;
  let dy = foot.y - hip.y;
  let dz = foot.z - hip.z;
  let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const maxReach = (l1 + l2) * 0.9999;
  const minReach = Math.abs(l1 - l2) + 1e-4;
  if (d < 1e-6) {
    dx = 0;
    dy = -1;
    dz = 0;
    d = 1e-6;
  }
  const ux = dx / d;
  const uy = dy / d;
  const uz = dz / d;
  const reach = Math.min(maxReach, Math.max(minReach, d));
  const endFoot = { x: hip.x + ux * reach, y: hip.y + uy * reach, z: hip.z + uz * reach };
  // distance from hip to the knee's projection on the hip-foot line
  const a = (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  // bend direction: pole projected onto the plane perpendicular to the chain
  let px = pole.x - hip.x;
  let py = pole.y - hip.y;
  let pz = pole.z - hip.z;
  const pd = px * ux + py * uy + pz * uz;
  px -= ux * pd;
  py -= uy * pd;
  pz -= uz * pd;
  let pl = Math.sqrt(px * px + py * py + pz * pz);
  if (pl < 1e-6) {
    // pick any perpendicular
    px = -uz;
    py = 0;
    pz = ux;
    pl = Math.sqrt(px * px + pz * pz) || 1;
  }
  px /= pl;
  py /= pl;
  pz /= pl;
  return {
    knee: { x: hip.x + ux * a + px * h, y: hip.y + uy * a + py * h, z: hip.z + uz * a + pz * h },
    foot: endFoot,
  };
}
