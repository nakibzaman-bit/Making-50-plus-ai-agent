import type { ServerEvent } from '../../shared/events';
import { getToken } from './client';

type Status = 'connecting' | 'open' | 'closed';

/** Auto-reconnecting WebSocket with per-project subscription. */
export class LiveSocket {
  private ws: WebSocket | null = null;
  private projectId: string | null = null;
  private retry = 0;
  private stopped = false;
  private timer: number | null = null;

  constructor(
    private onEvent: (e: ServerEvent) => void,
    private onStatus: (s: Status) => void,
    private onReconnect: () => void,
  ) {}

  connect() {
    this.stopped = false;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const token = getToken();
    const url = `${proto}://${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    this.onStatus('connecting');
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      const reconnected = this.retry > 0;
      this.retry = 0;
      this.onStatus('open');
      this.subscribe(this.projectId);
      if (reconnected) this.onReconnect();
    };
    ws.onmessage = (m) => {
      try {
        const e = JSON.parse(m.data as string);
        if (e && typeof e.type === 'string' && e.type.includes('.')) this.onEvent(e as ServerEvent);
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      this.onStatus('closed');
      if (this.stopped) return;
      const delay = Math.min(10000, 500 * 2 ** this.retry++);
      this.timer = window.setTimeout(() => this.connect(), delay);
    };
  }

  subscribe(projectId: string | null) {
    this.projectId = projectId;
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'subscribe', projectId }));
  }

  close() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.onopen = null;
      this.ws.close();
    }
  }
}
