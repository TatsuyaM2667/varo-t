// Minimal Cloudflare Workers declarations used by relay.ts (avoids a types dependency).
interface DurableObjectId {}
interface DurableObjectStub {
  fetch(req: Request): Promise<Response>;
}
interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId, opts?: { locationHint?: string }): DurableObjectStub;
}
interface DurableObject {
  fetch(req: Request): Promise<Response>;
}
interface WebSocket {
  accept(): void;
}
declare class WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}
interface ResponseInit {
  webSocket?: WebSocket;
}
