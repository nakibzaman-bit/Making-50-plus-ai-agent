/** USD per million tokens (Anthropic first-party list prices). Used for cost estimates only. */
export const MODEL_PRICING: Record<string, { input: number; output: number; label: string }> = {
  'claude-fable-5-1': { input: 10, output: 50, label: 'Claude Fable 5.1' },
  'claude-opus-5-5': { input: 4, output: 20, label: 'Claude Opus 5.5' },
  'claude-sonnet-5-5': { input: 2, output: 10, label: 'Claude Sonnet 5.5' },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, label: 'Claude Haiku 5.5' },
};

export const SCRIPTED_MODEL = 'scripted';

export function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const p = MODEL_PRICING[model];
  if (!p) return 0;
  return (tokensIn / 1e6) * p.input + (tokensOut / 1e6) * p.output;
}

export function modelLabel(model: string): string {
  if (model === SCRIPTED_MODEL) return 'Scripted (no LLM)';
  return MODEL_PRICING[model]?.label ?? model;
}
