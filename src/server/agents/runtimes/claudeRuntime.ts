import Anthropic from '@anthropic-ai/sdk';
import type { AgentRuntime, RunOutcome, RuntimeContext } from '../runtime.js';
import { BudgetExceededError, StopError } from '../runtime.js';
import { TOOL_DEFS, executeTool } from '../tools.js';
import { allowedTools } from '../../security/sandbox.js';

type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type BetaToolResultBlockParam = Anthropic.Beta.Messages.BetaToolResultBlockParam;
type BetaTool = Anthropic.Beta.Messages.BetaTool;
type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

/** The subset of the SDK client the runtime needs (lets tests inject a fake). */
export interface MessagesClient {
  beta: { messages: { create(params: CreateParams, opts?: { signal?: AbortSignal }): Promise<Anthropic.Beta.Messages.BetaMessage> } };
}

/** Models that accept server-side refusal fallbacks ("default" routing). */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5-5', 'claude-opus-5']);

/**
 * LLM-driven agent: a manual tool-use loop over the Anthropic Messages API.
 * The loop is ours (not the SDK runner) so every tool call goes through NEXUS permission
 * checks, pause/stop take effect between turns, teammates' messages are injected as they
 * arrive, and token usage/cost is accounted per turn.
 */
export class ClaudeRuntime implements AgentRuntime {
  readonly kind = 'claude' as const;
  private client: MessagesClient | null;

  constructor(apiKey: string | null, client?: MessagesClient) {
    this.client = client ?? (apiKey ? (new Anthropic({ apiKey, maxRetries: 3 }) as unknown as MessagesClient) : null);
  }

  available() {
    return this.client ? { ok: true } : { ok: false, reason: 'ANTHROPIC_API_KEY is not configured on the server' };
  }

  buildSystem(ctx: RuntimeContext): string {
    return [
      ctx.role.systemPrompt,
      '',
      `Project: ${ctx.project.name}`,
      ctx.project.objective ? `Project objective: ${ctx.project.objective}` : '',
      `Your name: ${ctx.agent.name}. Your branch: ${ctx.agent.branch ?? '(none)'}. Base branch: main.`,
      `Project test command: ${ctx.project.settings.testCommand || '(none)'}.`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  buildTask(ctx: RuntimeContext): string {
    return [
      `# Task: ${ctx.task.title}`,
      ctx.task.description,
      ctx.briefing ? `\n## Context\n${ctx.briefing}` : '',
      '\nWork in your workspace using the tools. Verify with tests, commit, then call complete_task.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  async run(ctx: RuntimeContext): Promise<RunOutcome> {
    if (!this.client) return { success: false, summary: '', error: this.available().reason };
    const toolNames = allowedTools(ctx.role).filter((t) => t in TOOL_DEFS);
    const tools: BetaTool[] = toolNames.map((name) => ({
      name,
      description: TOOL_DEFS[name].description,
      input_schema: TOOL_DEFS[name].input_schema as BetaTool['input_schema'],
    }));
    const model = ctx.agent.model;
    const system = this.buildSystem(ctx);
    const messages: BetaMessageParam[] = [{ role: 'user', content: this.buildTask(ctx) }];
    const maxIterations = ctx.role.limits.maxIterations;
    let nudged = false;
    let lastText = '';

    for (let iter = 1; iter <= maxIterations; iter++) {
      await ctx.control.checkpoint();
      const params: CreateParams = {
        model,
        max_tokens: 16000,
        system,
        tools,
        messages,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
        cache_control: { type: 'ephemeral' },
        ...(FALLBACK_MODELS.has(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      };
      let response: Anthropic.Beta.Messages.BetaMessage;
      try {
        response = await this.client.beta.messages.create(params, { signal: ctx.control.signal });
      } catch (e) {
        if (ctx.control.signal.aborted) throw new StopError();
        if (e instanceof Anthropic.AuthenticationError) return { success: false, summary: '', error: 'Anthropic API authentication failed — check ANTHROPIC_API_KEY.' };
        if (e instanceof Anthropic.RateLimitError) return { success: false, summary: '', error: 'Anthropic API rate limit hit; the task will be retried.' };
        if (e instanceof Anthropic.APIError) return { success: false, summary: '', error: `Anthropic API error ${e.status ?? ''}: ${e.message}` };
        throw e;
      }
      try {
        ctx.recordUsage(response.model ?? model, response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0), response.usage.output_tokens);
      } catch (e) {
        if (e instanceof BudgetExceededError) return { success: false, summary: '', error: e.message };
        throw e;
      }

      if (response.stop_reason === 'refusal') {
        return { success: false, summary: '', error: `Model declined the request (${response.stop_details?.category ?? 'refusal'}).` };
      }

      messages.push({ role: 'assistant', content: response.content });
      for (const b of response.content) {
        if (b.type === 'text' && b.text.trim()) {
          lastText = b.text.trim();
          ctx.log(`💭 ${lastText.slice(0, 1500)}`);
        }
      }

      const toolUses = response.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === 'tool_use');
      if (response.stop_reason === 'pause_turn') continue;
      if (!toolUses.length) {
        if (response.stop_reason === 'max_tokens') {
          messages.push({ role: 'user', content: 'Your previous response hit the output limit. Continue, using smaller steps.' });
          continue;
        }
        if (!nudged) {
          nudged = true;
          messages.push({ role: 'user', content: 'If the task is done, call complete_task with a summary; otherwise continue working with the tools.' });
          continue;
        }
        return { success: true, summary: lastText || 'Finished.' };
      }

      const results: BetaToolResultBlockParam[] = [];
      let completion: { success: boolean; summary: string } | undefined;
      for (const tu of toolUses) {
        await ctx.control.checkpoint();
        ctx.log(`🔧 ${tu.name} ${summarizeInput(tu.input)}`);
        const out = await executeTool(ctx, toolNames, tu.name, tu.input);
        if (out.complete) completion = out.complete;
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: out.output, is_error: out.isError || undefined });
      }
      if (completion) return completion.success ? { success: true, summary: completion.summary } : { success: false, summary: '', error: completion.summary };

      const content: Exclude<BetaMessageParam['content'], string> = [...results];
      const inbox = ctx.inbox();
      if (inbox.length) {
        content.push({
          type: 'text',
          text: `New messages from your team:\n${inbox.map((m) => `- [${m.kind}] ${m.meta?.fromName ?? 'system'}: ${m.body}`).join('\n')}`,
        });
      }
      messages.push({ role: 'user', content });
    }
    return { success: false, summary: '', error: `Reached the iteration limit (${maxIterations}) without completing the task.` };
  }
}

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const o = input as Record<string, unknown>;
  const key = o.command ?? o.path ?? o.message ?? o.title ?? o.role ?? o.to ?? '';
  return String(key).slice(0, 160);
}
