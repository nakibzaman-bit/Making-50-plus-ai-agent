import path from 'node:path';
import fs from 'node:fs';
import { DEFAULT_MODEL } from '../shared/roles.js';

/** Minimal .env loader (no dependency). Existing env vars win. */
export function loadDotEnv(file = path.resolve(process.cwd(), '.env')): void {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export interface NexusConfig {
  port: number;
  host: string;
  dataDir: string;
  dbPath: string;
  workspacesDir: string;
  executor: 'local' | 'docker';
  defaultModel: string;
  /** Read only by the server-side Claude runtime; never serialised. */
  anthropicApiKey: string | null;
  production: boolean;
  seedTestLab: boolean;
  tickMs: number;
}

export function loadConfig(overrides: Partial<NexusConfig> = {}): NexusConfig {
  const dataDir = path.resolve(overrides.dataDir ?? process.env.NEXUS_DATA_DIR ?? '.nexus');
  const cfg: NexusConfig = {
    port: Number(process.env.NEXUS_PORT ?? 4317),
    host: process.env.NEXUS_HOST ?? '127.0.0.1',
    dataDir,
    dbPath: path.join(dataDir, 'nexus.db'),
    workspacesDir: path.join(dataDir, 'workspaces'),
    executor: process.env.NEXUS_EXECUTOR === 'docker' ? 'docker' : 'local',
    defaultModel: process.env.NEXUS_DEFAULT_MODEL || DEFAULT_MODEL,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || null,
    production: process.env.NODE_ENV === 'production',
    seedTestLab: process.env.NEXUS_SEED_TEST_LAB !== '0',
    tickMs: Number(process.env.NEXUS_TICK_MS ?? 750),
    ...overrides,
  };
  if (overrides.dataDir) {
    cfg.dbPath = overrides.dbPath ?? path.join(dataDir, 'nexus.db');
    cfg.workspacesDir = overrides.workspacesDir ?? path.join(dataDir, 'workspaces');
  }
  return cfg;
}
