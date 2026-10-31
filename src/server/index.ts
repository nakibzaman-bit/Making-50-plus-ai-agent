import { loadDotEnv } from './config.js';

loadDotEnv();

const { startApp } = await import('./app.js');

const app = await startApp();
const sys = app.services;
const key = sys.config.anthropicApiKey ? 'configured' : 'NOT configured (Claude runtime + LLM planner disabled; scripted agents and heuristic planner available)';
console.log(`
  ███╗   ██╗███████╗██╗  ██╗██╗   ██╗███████╗
  ████╗  ██║██╔════╝╚██╗██╔╝██║   ██║██╔════╝
  ██╔██╗ ██║█████╗   ╚███╔╝ ██║   ██║███████╗
  ██║╚██╗██║██╔══╝   ██╔██╗ ██║   ██║╚════██║
  ██║ ╚████║███████╗██╔╝ ██╗╚██████╔╝███████║
  ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝  AI Development Command Center

  API + WebSocket : ${app.url}  (ws: /ws)
  Data directory  : ${sys.config.dataDir}
  Executor        : ${sys.core.pm.executorKind}
  Anthropic key   : ${key}
  Projects        : ${sys.projects.list().map((p) => p.name).join(', ') || '(none)'}
`);

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  console.log(`\n${signal} received — stopping agents and closing…`);
  const force = setTimeout(() => process.exit(1), 15000);
  force.unref();
  await app.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
