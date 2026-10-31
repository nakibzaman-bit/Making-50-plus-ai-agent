import { EventEmitter } from 'node:events';
import type { ServerEvent } from '../../shared/events.js';

/** In-process pub/sub for domain events. The WebSocket hub is one subscriber. */
export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(1000);
  }

  emit(event: ServerEvent): void {
    this.emitter.emit('event', event);
  }

  on(listener: (event: ServerEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }
}
