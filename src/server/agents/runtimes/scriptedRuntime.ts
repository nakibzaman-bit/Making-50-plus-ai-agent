import type { ScriptStep } from '../../../shared/types.js';
import type { AgentRuntime, RunOutcome, RuntimeContext } from '../runtime.js';
import { sleep } from '../../util.js';

export function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (m, k: string) => vars[k] ?? m);
}

/**
 * Deterministic, LLM-free runtime. Executes a task's declared steps for real:
 * files are written to the agent's worktree, commands run as real processes through
 * the security policy, commits land on the agent's branch, messages go on the bus.
 */
export class ScriptedRuntime implements AgentRuntime {
  readonly kind = 'scripted' as const;

  available() {
    return { ok: true };
  }

  async run(ctx: RuntimeContext): Promise<RunOutcome> {
    const steps: ScriptStep[] | null = ctx.task.script;
    if (!steps?.length) {
      return { success: false, summary: '', error: 'Scripted runtime requires a task script (this task has none). Assign it to a Claude-runtime agent.' };
    }
    let i = 0;
    for (const step of steps) {
      i++;
      await ctx.control.checkpoint();
      switch (step.type) {
        case 'write':
          ctx.writeFile(step.path, interpolate(step.content, ctx.vars));
          ctx.log(`✎ wrote ${step.path}`);
          break;
        case 'append':
          ctx.appendFile(step.path, interpolate(step.content, ctx.vars));
          ctx.log(`✎ appended ${step.path}`);
          break;
        case 'run': {
          const r = await ctx.run(interpolate(step.command, ctx.vars));
          if (!r.ok && !step.allowFailure) {
            const tail = (r.stderr || r.stdout).trim().split('\n').slice(-12).join('\n');
            return { success: false, summary: '', error: `Step ${i}/${steps.length} failed: ${step.command}${r.denied ? ` — ${r.denied}` : ` (exit ${r.code ?? r.signal})`}\n${tail}` };
          }
          break;
        }
        case 'commit': {
          const c = await ctx.commit(interpolate(step.message, ctx.vars));
          if (c) ctx.log(`● committed ${c.shortHash} ${c.message}`);
          break;
        }
        case 'message':
          ctx.sendMessage({ to: step.to, toRole: step.toRole, team: step.team, body: interpolate(step.body, ctx.vars) });
          break;
        case 'sleep':
          await sleep(Math.min(step.ms, 10_000));
          break;
      }
    }
    return { success: true, summary: `Completed ${steps.length} scripted steps.` };
  }
}
