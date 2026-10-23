/**
 * Multiplayer (lockstep over a Cloudflare relay). ★ 通信まわりの調整値はここ。
 *
 * Every client runs the same deterministic simulation; only the humans'
 * InputFrames travel over the network. A tick is simulated once every
 * human's input for it has arrived, so a player's input takes effect
 * `delay` ticks after it was made (the camera look is always immediate).
 */
export const NET = {
  /**
   * WebSocket endpoint of the relay Worker (server/). `?relay=wss://…` overrides it;
   * on localhost the dev relay (`npm run relay:dev`) is used.
   */
  relayUrl: 'wss://halcyon-relay.miuranosuketatsuya06.workers.dev',
  devRelayUrl: 'ws://localhost:8787',
  maxPlayers: 4,
  /** ticks of input delay = ceil((worst RTT + jitterMs) / tick) + (sendEveryTicks − 1), clamped */
  minDelayTicks: 3,
  maxDelayTicks: 12,
  jitterMs: 25,
  /**
   * Inputs are batched this many ticks per packet. 2 halves the messages the
   * relay is billed for (Cloudflare free plan: 100k requests/day, WebSocket
   * messages count 1/20) at the cost of +1 tick of delay.
   */
  sendEveryTicks: 2,
  /** clients compare state hashes this often (desync detection) */
  hashEveryTicks: 120,
  pingIntervalMs: 1000,
  /** when this many ticks behind the other players, simulate extra ticks per frame */
  catchUpTicks: 4,
  maxCatchUpPerFrame: 4,
  /** versus: humans + bots per team */
  defaultTeamSize: 3,
  maxTeamSize: 5,
} as const;
