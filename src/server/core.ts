import type { NexusConfig } from './config.js';
import type { Db } from './db/database.js';
import type { Repositories } from './db/repositories.js';
import type { EventBus } from './events/eventBus.js';
import type { LogSink } from './events/logSink.js';
import type { GitService } from './git/gitService.js';
import type { ProcessManager } from './process/processManager.js';

/** Infrastructure shared by every domain service. */
export interface Core {
  config: NexusConfig;
  db: Db;
  repos: Repositories;
  bus: EventBus;
  logs: LogSink;
  git: GitService;
  pm: ProcessManager;
}
