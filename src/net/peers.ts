/**
 * Direct browser-to-browser channels (WebRTC data channels) between the
 * players of a room. The relay only carries the offer/answer/candidates.
 * Input packets sent this way cost nothing on the relay's free plan and
 * skip the relay hop (on the same Wi-Fi they arrive in a few ms).
 */
import { NET } from '../config/net';
import { type InputPacket, decodeInputs } from './protocol';

interface Peer {
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  /** remote candidates that arrived before the remote description */
  queued: RTCIceCandidateInit[];
  srtt: number;
  rttVar: number;
}

type Signal = { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

export class PeerMesh {
  private readonly peers = new Map<number, Peer>();
  private pinger = 0;
  private lastLinks = '';
  onInputs: (p: InputPacket) => void = () => {};
  /** the set of open channels changed */
  onLinks: (open: number[]) => void = () => {};

  constructor(
    private readonly mySlot: number,
    private readonly signal: (to: number, data: Signal) => void,
  ) {
    this.pinger = window.setInterval(() => this.ping(), NET.pingIntervalMs);
  }

  /** Keep one connection per other player in the room. The lower slot makes the offer. */
  sync(slots: readonly number[]): void {
    for (const s of slots) if (s !== this.mySlot && !this.peers.has(s) && this.mySlot < s) this.connect(s);
    for (const s of [...this.peers.keys()]) if (!slots.includes(s)) this.drop(s);
  }

  open(): number[] {
    return [...this.peers.entries()].filter(([, p]) => p.dc?.readyState === 'open').map(([s]) => s);
  }

  /** Round trip to `slot` over the direct channel, or null if there is none. */
  rttTo(slot: number): number | null {
    const p = this.peers.get(slot);
    return p && p.dc?.readyState === 'open' && p.srtt ? p.srtt + 2 * p.rttVar : null;
  }

  /** Send to every target over direct channels; false if some target has none (use the relay too). */
  sendInputs(buf: ArrayBuffer, targets: readonly number[]): boolean {
    let all = true;
    for (const s of targets) {
      const dc = this.peers.get(s)?.dc;
      if (dc?.readyState === 'open') {
        try {
          dc.send(buf);
          continue;
        } catch {
          /* fall through to the relay */
        }
      }
      all = false;
    }
    return all;
  }

  async handleSignal(from: number, data: Signal): Promise<void> {
    let peer = this.peers.get(from);
    try {
      if (data.sdp) {
        if (data.sdp.type === 'offer') {
          // the other side restarted: start over
          if (peer && peer.pc.signalingState !== 'stable') this.drop(from);
          peer = this.peers.get(from) ?? this.create(from);
          await peer.pc.setRemoteDescription(data.sdp);
          await peer.pc.setLocalDescription(await peer.pc.createAnswer());
          this.signal(from, { sdp: peer.pc.localDescription!.toJSON() });
        } else if (peer) await peer.pc.setRemoteDescription(data.sdp);
        if (peer) for (const c of peer.queued.splice(0)) await peer.pc.addIceCandidate(c);
      } else if (data.candidate && peer) {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate);
        else peer.queued.push(data.candidate);
      }
    } catch (e) {
      console.warn('[p2p] signaling failed with', from, e);
    }
  }

  close(): void {
    window.clearInterval(this.pinger);
    for (const s of [...this.peers.keys()]) this.drop(s);
  }

  private create(slot: number): Peer {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: [...NET.stunUrls] }] });
    const peer: Peer = { pc, dc: null, queued: [], srtt: 0, rttVar: 0 };
    this.peers.set(slot, peer);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal(slot, { candidate: e.candidate.toJSON() });
    };
    pc.ondatachannel = (e) => this.attach(slot, peer, e.channel);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.reportLinks();
    };
    return peer;
  }

  private async connect(slot: number): Promise<void> {
    const peer = this.create(slot);
    this.attach(slot, peer, peer.pc.createDataChannel('inputs', { ordered: true }));
    try {
      await peer.pc.setLocalDescription(await peer.pc.createOffer());
      this.signal(slot, { sdp: peer.pc.localDescription!.toJSON() });
    } catch (e) {
      console.warn('[p2p] offer failed', e);
    }
  }

  private attach(slot: number, peer: Peer, dc: RTCDataChannel): void {
    peer.dc = dc;
    dc.binaryType = 'arraybuffer';
    dc.onopen = () => this.reportLinks();
    dc.onclose = () => this.reportLinks();
    dc.onmessage = (e) => {
      if (typeof e.data !== 'string') {
        const p = decodeInputs(e.data as ArrayBuffer);
        if (p) this.onInputs({ ...p, slot });
        return;
      }
      // tiny ping/pong for the round trip on this path
      const m = JSON.parse(e.data) as { p?: number; q?: number };
      if (m.p !== undefined) dc.send(JSON.stringify({ q: m.p }));
      else if (m.q !== undefined) {
        const r = performance.now() - m.q;
        if (!peer.srtt) {
          peer.srtt = r;
          peer.rttVar = r / 2;
        } else {
          peer.rttVar = peer.rttVar * 0.75 + Math.abs(peer.srtt - r) * 0.25;
          peer.srtt = peer.srtt * 0.875 + r * 0.125;
        }
      }
    };
  }

  private ping(): void {
    for (const p of this.peers.values()) if (p.dc?.readyState === 'open') p.dc.send(JSON.stringify({ p: performance.now() }));
  }

  private drop(slot: number): void {
    const p = this.peers.get(slot);
    if (!p) return;
    this.peers.delete(slot);
    try {
      p.dc?.close();
      p.pc.close();
    } catch {
      /* ignore */
    }
    this.reportLinks();
  }

  private reportLinks(): void {
    const open = this.open().sort((a, b) => a - b);
    const key = open.join();
    if (key === this.lastLinks) return;
    this.lastLinks = key;
    this.onLinks(open);
  }
}
