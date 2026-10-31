import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMessage, ServerEvent } from '../../shared/events.js';
import type { EventBus } from './eventBus.js';

const GLOBAL_EVENTS = new Set<ServerEvent['type']>(['project.updated', 'project.deleted']);

interface Client {
  ws: WebSocket;
  projectId: string | null;
  alive: boolean;
}

/** Fans domain events out to browser clients subscribed to a project. */
export class WsHub {
  private wss: WebSocketServer;
  private clients = new Set<Client>();
  private heartbeat: NodeJS.Timeout;
  private unsub: () => void;

  constructor(server: Server, bus: EventBus, authToken: string | null = null) {
    this.wss = new WebSocketServer({
      server,
      path: '/ws',
      maxPayload: 64 * 1024,
      verifyClient: ({ req, origin }: { req: import('node:http').IncomingMessage; origin?: string }) => {
        // Same-origin browsers only (prevents cross-site WebSocket hijacking).
        if (origin) {
          try {
            if (new URL(origin).host !== req.headers.host) return false;
          } catch {
            return false;
          }
        }
        if (!authToken) return true;
        const token = new URL(req.url ?? '/', 'http://x').searchParams.get('token');
        return token === authToken;
      },
    });
    this.wss.on('connection', (ws) => {
      const client: Client = { ws, projectId: null, alive: true };
      this.clients.add(client);
      ws.on('pong', () => (client.alive = true));
      ws.on('message', (raw) => {
        let msg: ClientMessage;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (msg.type === 'subscribe') client.projectId = typeof msg.projectId === 'string' ? msg.projectId : null;
        if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
      });
      ws.on('close', () => this.clients.delete(client));
      ws.on('error', () => this.clients.delete(client));
      ws.send(JSON.stringify({ type: 'hello', at: Date.now() }));
    });
    this.unsub = bus.on((e) => this.broadcast(e));
    this.heartbeat = setInterval(() => {
      for (const c of this.clients) {
        if (!c.alive) {
          c.ws.terminate();
          this.clients.delete(c);
          continue;
        }
        c.alive = false;
        c.ws.ping();
      }
    }, 15000);
  }

  get size() {
    return this.clients.size;
  }

  private broadcast(e: ServerEvent) {
    const payload = JSON.stringify(e);
    for (const c of this.clients) {
      if (c.ws.readyState !== WebSocket.OPEN) continue;
      if (GLOBAL_EVENTS.has(e.type) || c.projectId === e.projectId) {
        // Drop frames for slow consumers rather than buffering unboundedly.
        if (c.ws.bufferedAmount > 8 * 1024 * 1024) continue;
        c.ws.send(payload);
      }
    }
  }

  close() {
    clearInterval(this.heartbeat);
    this.unsub();
    for (const c of this.clients) c.ws.terminate();
    this.wss.close();
  }
}
