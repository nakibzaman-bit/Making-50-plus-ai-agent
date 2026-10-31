import type { Approval, ApprovalKind } from '../../shared/types.js';
import type { Core } from '../core.js';
import { HttpError, id, now } from '../util.js';

/** Human-in-the-loop gate for destructive commands, merges and other sensitive actions. */
export class ApprovalService {
  private waiters = new Map<string, (approved: boolean) => void>();

  constructor(private core: Core) {
    // Approvals can't survive a restart (the waiting agent is gone): deny leftovers.
    this.core.db.run("UPDATE approvals SET status = 'denied', reason = reason || ' (server restarted)', resolved_at = ? WHERE status = 'pending'", now());
  }

  create(projectId: string, agentId: string | null, kind: ApprovalKind, reason: string, payload: Record<string, unknown> = {}): Approval {
    const approval: Approval = { id: id('apr'), projectId, agentId, kind, payload, status: 'pending', reason, createdAt: now(), resolvedAt: null };
    this.core.repos.approvals.insert(approval);
    this.core.bus.emit({ type: 'approval.upserted', projectId, approval });
    return approval;
  }

  /** Create an approval and wait for a human decision. Resolves false on timeout or abort. */
  request(projectId: string, agentId: string | null, kind: ApprovalKind, reason: string, payload: Record<string, unknown> = {}, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<boolean> {
    const approval = this.create(projectId, agentId, kind, reason, payload);
    return this.wait(approval.id, opts);
  }

  wait(approvalId: string, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.resolve(approvalId, false, 'timed out'), opts.timeoutMs ?? 30 * 60_000);
      timer.unref();
      opts.signal?.addEventListener('abort', () => this.resolve(approvalId, false, 'aborted'), { once: true });
      this.waiters.set(approvalId, (ok) => {
        clearTimeout(timer);
        resolve(ok);
      });
    });
  }

  resolve(approvalId: string, approved: boolean, note?: string): Approval {
    const a = this.core.repos.approvals.get(approvalId);
    if (!a) throw new HttpError(404, 'Approval not found');
    if (a.status === 'pending') {
      const patch = { status: approved ? 'approved' : 'denied', resolvedAt: now(), reason: note ? `${a.reason} — ${note}` : a.reason } as const;
      this.core.repos.approvals.update(approvalId, patch);
      const updated = { ...a, ...patch };
      this.core.bus.emit({ type: 'approval.upserted', projectId: a.projectId, approval: updated });
    }
    const w = this.waiters.get(approvalId);
    this.waiters.delete(approvalId);
    w?.(approved);
    return this.core.repos.approvals.get(approvalId)!;
  }

  pending(projectId: string): Approval[] {
    return this.core.repos.approvals.where("project_id = ? AND status = 'pending' ORDER BY created_at", projectId);
  }

  list(projectId: string, limit = 100): Approval[] {
    return this.core.repos.approvals.where('project_id = ? ORDER BY created_at DESC LIMIT ?', projectId, limit);
  }
}
