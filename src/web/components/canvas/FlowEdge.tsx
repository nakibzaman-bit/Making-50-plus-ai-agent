import { memo } from 'react';
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';
import { useStore } from '../../store/store';
import { agentTone, TONE_HEX, type Tone } from '../../lib/status';

/** Gentle arc between two node centres (used for peer messages and manual links). */
function arc(sx: number, sy: number, tx: number, ty: number) {
  const mx = (sx + tx) / 2;
  const my = (sy + ty) / 2;
  const dx = tx - sx;
  const dy = ty - sy;
  const len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(160, len * 0.22);
  return `M${sx},${sy} Q${mx - (dy / len) * bend},${my + (dx / len) * bend - bend * 0.6} ${tx},${ty}`;
}

export type FlowEdgeData = { kind: 'hierarchy' | 'manual' | 'comms'; target: string };

/**
 * Connection colours: BLUE active · GREEN completed · YELLOW waiting · RED failed ·
 * PURPLE communicating · GRAY inactive. Particles travel along live connections.
 */
export const FlowEdge = memo(function FlowEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected } = props;
  const d = data as FlowEdgeData;
  const status = useStore((s) => s.agents[d.target]?.status);
  const talking = useStore((s) => s.comms.some((c) => Date.now() - c.at < 4000 && ((c.from === props.source && c.to === props.target) || (c.to === props.source && c.from === props.target))));
  const lowDetail = useStore((s) => s.compact);
  const [bezier] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.35 });
  const path = d.kind === 'hierarchy' ? bezier : arc(sourceX, sourceY - 98, targetX, targetY + 98);
  let tone: Tone = d.kind === 'comms' || talking ? 'comm' : status ? agentTone(status) : 'idle';
  if (d.kind === 'manual' && tone === 'idle') tone = 'idle';
  const color = TONE_HEX[tone];
  const live = tone === 'active' || tone === 'comm';
  const dashed = d.kind === 'manual' || tone === 'wait' || tone === 'fail';
  return (
    <>
      <path d={path} fill="none" stroke={color} strokeOpacity={live ? 0.18 : 0.06} strokeWidth={live ? 8 : 5} />
      <BaseEdge
        id={id}
        path={path}
        className="edge-main"
        style={{
          stroke: color,
          strokeOpacity: tone === 'idle' ? 0.35 : 0.85,
          strokeWidth: selected ? 3 : live ? 2 : 1.5,
          strokeDasharray: dashed ? '6 6' : undefined,
          animation: tone === 'wait' ? 'dash 1.2s linear infinite' : undefined,
        }}
      />
      {live && !lowDetail && (
        <>
          {[0, 0.55, 1.1].map((delay) => (
            <circle key={delay} r={tone === 'comm' ? 3.2 : 2.6} fill={color} style={{ filter: `drop-shadow(0 0 4px ${color})` }}>
              <animateMotion dur={tone === 'comm' ? '1.1s' : '1.7s'} begin={`${delay}s`} repeatCount="indefinite" path={path} keyPoints={tone === 'comm' && d.kind !== 'hierarchy' ? '1;0' : '0;1'} keyTimes="0;1" calcMode="linear" />
            </circle>
          ))}
        </>
      )}
      {tone === 'done' && !lowDetail && (
        <circle r={2} fill={color} opacity={0.7}>
          <animateMotion dur="4s" repeatCount="indefinite" path={path} />
        </circle>
      )}
    </>
  );
});
