import { z } from 'zod';
import type { RuntimeContext } from './runtime.js';
import { truncate } from '../util.js';

/** JSON-schema tool definitions exposed to LLM agents (filtered per role permissions). */
export const TOOL_DEFS: Record<string, { description: string; input_schema: Record<string, unknown>; schema: z.ZodTypeAny }> = {
  list_files: {
    description: 'List files tracked or created in your workspace (git-aware). Optionally restrict to a sub-directory.',
    input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Sub-directory, relative to the workspace root.' } } },
    schema: z.object({ path: z.string().optional() }),
  },
  read_file: {
    description: 'Read a UTF-8 text file from your workspace. Large files are paginated by line.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, offset: { type: 'integer', description: '1-based start line' }, limit: { type: 'integer' } },
      required: ['path'],
    },
    schema: z.object({ path: z.string(), offset: z.number().int().positive().optional(), limit: z.number().int().positive().optional() }),
  },
  write_file: {
    description: 'Create or overwrite a file in your workspace with the full content given.',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    schema: z.object({ path: z.string(), content: z.string() }),
  },
  edit_file: {
    description: 'Replace one exact, unique occurrence of old_string with new_string in a file.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } },
      required: ['path', 'old_string', 'new_string'],
    },
    schema: z.object({ path: z.string(), old_string: z.string().min(1), new_string: z.string() }),
  },
  run_command: {
    description:
      'Run ONE command in your workspace (no shell: no pipes, redirects, &&, $()). Allowed: node/npm/npx/tsc/vitest/jest/eslint/python/pytest/git (local subcommands)/ls/cat/grep/find/mkdir/cp/mv/rm. Destructive commands require human approval. Network access only if your role permits.',
    input_schema: {
      type: 'object',
      properties: { command: { type: 'string' }, timeout_sec: { type: 'integer', description: 'Optional, capped by your role limit.' } },
      required: ['command'],
    },
    schema: z.object({ command: z.string().min(1), timeout_sec: z.number().int().positive().optional() }),
  },
  git_status: {
    description: 'Show uncommitted changes in your worktree and commits on your branch.',
    input_schema: { type: 'object', properties: {} },
    schema: z.object({}).passthrough(),
  },
  git_commit: {
    description: 'Stage all changes in your worktree and commit them to your branch.',
    input_schema: { type: 'object', properties: { message: { type: 'string', description: 'Conventional commit message.' } }, required: ['message'] },
    schema: z.object({ message: z.string().min(3) }),
  },
  send_message: {
    description: 'Message a teammate (by agent name or id), a role, your team, or everyone. Use it for interface changes, blockers and hand-offs.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Agent name or id' },
        to_role: { type: 'string', description: 'Role id, e.g. "backend"' },
        team: { type: 'boolean' },
        broadcast: { type: 'boolean' },
        body: { type: 'string' },
      },
      required: ['body'],
    },
    schema: z.object({ to: z.string().optional(), to_role: z.string().optional(), team: z.boolean().optional(), broadcast: z.boolean().optional(), body: z.string().min(1) }),
  },
  spawn_agent: {
    description: 'Spawn a sub-agent with a given role and optionally assign it a task. Use when work can be parallelised.',
    input_schema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'Role id (e.g. "frontend", "test", "debugger")' },
        name: { type: 'string' },
        task_title: { type: 'string' },
        task_description: { type: 'string' },
      },
      required: ['role'],
    },
    schema: z.object({ role: z.string(), name: z.string().optional(), task_title: z.string().optional(), task_description: z.string().optional() }),
  },
  create_task: {
    description: 'Create a task on the project board, optionally assigned to an agent and depending on other task ids.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        role: { type: 'string' },
        assign_to: { type: 'string', description: 'Agent name or id' },
        depends_on: { type: 'array', items: { type: 'string' } },
      },
      required: ['title'],
    },
    schema: z.object({ title: z.string(), description: z.string().optional(), role: z.string().optional(), assign_to: z.string().optional(), depends_on: z.array(z.string()).optional() }),
  },
  complete_task: {
    description: 'Finish your task. success=false if you could not complete it; give the reason in summary.',
    input_schema: { type: 'object', properties: { success: { type: 'boolean' }, summary: { type: 'string' } }, required: ['success', 'summary'] },
    schema: z.object({ success: z.boolean(), summary: z.string() }),
  },
};

export interface ToolOutcome {
  output: string;
  isError: boolean;
  complete?: { success: boolean; summary: string };
}

const MAX_RESULT = 30_000;

/** Execute one validated tool call against the runtime context. */
export async function executeTool(ctx: RuntimeContext, allowed: string[], name: string, rawInput: unknown): Promise<ToolOutcome> {
  if (!allowed.includes(name)) return { output: `Tool "${name}" is not available to your role.`, isError: true };
  const def = TOOL_DEFS[name];
  const parsed = def.schema.safeParse(rawInput);
  if (!parsed.success) return { output: `Invalid input for ${name}: ${parsed.error.message}`, isError: true };
  const input = parsed.data as Record<string, unknown>;
  try {
    switch (name) {
      case 'list_files': {
        const files = await ctx.listFiles(input.path as string | undefined);
        return { output: files.length ? truncate(files.join('\n'), MAX_RESULT) : '(no files)', isError: false };
      }
      case 'read_file': {
        const text = ctx.readFile(input.path as string);
        const lines = text.split('\n');
        const offset = (input.offset as number | undefined) ?? 1;
        const limit = (input.limit as number | undefined) ?? 2000;
        const slice = lines.slice(offset - 1, offset - 1 + limit);
        const more = offset - 1 + limit < lines.length ? `\n… (${lines.length} lines total; use offset to read more)` : '';
        return { output: truncate(slice.join('\n'), MAX_RESULT) + more, isError: false };
      }
      case 'write_file':
        ctx.writeFile(input.path as string, input.content as string);
        return { output: `Wrote ${input.path} (${(input.content as string).length} bytes)`, isError: false };
      case 'edit_file': {
        const p = input.path as string;
        const text = ctx.readFile(p);
        const oldS = input.old_string as string;
        const count = text.split(oldS).length - 1;
        if (count === 0) return { output: `old_string not found in ${p}`, isError: true };
        if (count > 1) return { output: `old_string occurs ${count} times in ${p}; include more context to make it unique`, isError: true };
        ctx.writeFile(p, text.replace(oldS, () => input.new_string as string));
        return { output: `Edited ${p}`, isError: false };
      }
      case 'run_command': {
        const r = await ctx.run(input.command as string, { timeoutSec: input.timeout_sec as number | undefined });
        if (r.denied) return { output: `Command not run: ${r.denied}`, isError: true };
        const out = [r.stdout && `stdout:\n${r.stdout}`, r.stderr && `stderr:\n${r.stderr}`].filter(Boolean).join('\n');
        const status = r.timedOut ? 'timed out' : r.killedForMemory ? 'killed (memory limit)' : `exit code ${r.code}`;
        return { output: truncate(`${status}\n${out}`, MAX_RESULT), isError: !r.ok };
      }
      case 'git_status':
        return { output: truncate(await ctx.gitStatus(), MAX_RESULT), isError: false };
      case 'git_commit': {
        const c = await ctx.commit(input.message as string);
        return { output: c ? `Committed ${c.shortHash}: ${c.message}` : 'Nothing to commit.', isError: false };
      }
      case 'send_message': {
        const m = ctx.sendMessage({
          to: input.to as string | undefined,
          toRole: input.to_role as string | undefined,
          team: input.team as boolean | undefined,
          broadcast: input.broadcast as boolean | undefined,
          body: input.body as string,
        });
        return { output: `Message ${m.id} sent (${m.kind}).`, isError: false };
      }
      case 'spawn_agent': {
        const { agent, task } = await ctx.spawnAgent({
          roleId: input.role as string,
          name: input.name as string | undefined,
          taskTitle: input.task_title as string | undefined,
          taskDescription: input.task_description as string | undefined,
        });
        return { output: `Spawned ${agent.name} (${agent.id}) on ${agent.branch ?? 'no branch'}${task ? `; assigned task ${task.id}` : ''}.`, isError: false };
      }
      case 'create_task': {
        const t = ctx.createTask({
          title: input.title as string,
          description: input.description as string | undefined,
          roleHint: input.role as string | undefined,
          assignTo: input.assign_to as string | undefined,
          dependsOn: input.depends_on as string[] | undefined,
        });
        return { output: `Created task ${t.id}: ${t.title}`, isError: false };
      }
      case 'complete_task':
        return { output: 'Task marked complete.', isError: false, complete: { success: input.success as boolean, summary: input.summary as string } };
      default:
        return { output: `Unknown tool ${name}`, isError: true };
    }
  } catch (e) {
    return { output: `Error: ${(e as Error).message}`, isError: true };
  }
}
