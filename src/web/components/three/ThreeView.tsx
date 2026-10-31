import { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Line, OrbitControls, Stars } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { Crosshair, Square as SquareIcon, Network } from 'lucide-react';
import type { Agent, Team } from '../../../shared/types';
import { useStore } from '../../store/store';
import { agentTone, AGENT_STATUS_LABEL, TONE_HEX } from '../../lib/status';
import { IconButton } from '../ui';

type Vec = [number, number, number];

/** Text label rendered as a GPU sprite (canvas texture) — no DOM, no font downloads. */
function Label({ lines, color, position, scale = 1 }: { lines: { text: string; size: number; color: string; weight?: number }[]; color: string; position: Vec; scale?: number }) {
  const key = lines.map((l) => l.text + l.color).join('|') + color;
  const { texture, aspect } = useMemo(() => {
    const pad = 18;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const font = (l: { size: number; weight?: number }) => `${l.weight ?? 600} ${l.size}px Inter, system-ui, sans-serif`;
    const widths = lines.map((l) => {
      ctx.font = font(l);
      return ctx.measureText(l.text).width;
    });
    const w = Math.ceil(Math.max(...widths) + pad * 2);
    const h = Math.ceil(lines.reduce((a, l) => a + l.size * 1.3, 0) + pad * 1.4);
    canvas.width = w;
    canvas.height = h;
    ctx.fillStyle = 'rgba(8,11,20,0.86)';
    ctx.strokeStyle = `${color}88`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(1.5, 1.5, w - 3, h - 3, 14);
    ctx.fill();
    ctx.stroke();
    let y = pad * 0.7;
    for (const l of lines) {
      ctx.font = font(l);
      ctx.fillStyle = l.color;
      ctx.textBaseline = 'top';
      ctx.fillText(l.text, (w - ctx.measureText(l.text).width) / 2, y);
      y += l.size * 1.3;
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return { texture, aspect: w / h };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const h = 1.1 * scale;
  return (
    <sprite position={position} scale={[h * aspect, h, 1]} renderOrder={10}>
      <spriteMaterial map={texture} transparent depthWrite={false} depthTest={false} />
    </sprite>
  );
}

/** Teams occupy sectors on a ring around the orchestrator; depth in the hierarchy lowers the node. */
function layout3d(agents: Agent[], teams: Record<string, Team>): Map<string, Vec> {
  const pos = new Map<string, Vec>();
  const teamIds = Object.keys(teams);
  const depth = (a: Agent) => {
    let d = 0;
    let cur: Agent | undefined = a;
    const byId = new Map(agents.map((x) => [x.id, x]));
    while (cur?.parentId && d < 8) {
      cur = byId.get(cur.parentId);
      d++;
    }
    return d;
  };
  const R = Math.max(12, teamIds.length * 3.2);
  const byTeam = new Map<string, Agent[]>();
  const loose: Agent[] = [];
  for (const a of agents) {
    if (a.roleId === 'orchestrator') pos.set(a.id, [0, 4, 0]);
    else if (a.teamId && teams[a.teamId]) byTeam.set(a.teamId, [...(byTeam.get(a.teamId) ?? []), a]);
    else loose.push(a);
  }
  teamIds.forEach((tid, i) => {
    const angle = (i / Math.max(1, teamIds.length)) * Math.PI * 2;
    const cx = Math.cos(angle) * R;
    const cz = Math.sin(angle) * R;
    const members = byTeam.get(tid) ?? [];
    const lead = members.find((m) => m.id === teams[tid].leadAgentId);
    members.forEach((m) => {
      if (m === lead) return pos.set(m.id, [cx, 2, cz]);
      // Members sit on concentric rings (8 per ring) around the team's marker.
      const k = members.filter((x) => x !== lead).indexOf(m);
      const n = members.length - (lead ? 1 : 0);
      const ring = Math.floor(k / 8);
      const inRing = Math.min(8, n - ring * 8);
      const a2 = ((k % 8) / inRing) * Math.PI * 2 + ring * 0.4;
      const r2 = 2.6 + ring * 1.9;
      pos.set(m.id, [cx + Math.cos(a2) * r2, 2 - depth(m) * 1.4, cz + Math.sin(a2) * r2]);
    });
  });
  loose.forEach((a, i) => {
    const angle = (i / Math.max(1, loose.length)) * Math.PI * 2;
    pos.set(a.id, [Math.cos(angle) * 6, 1, Math.sin(angle) * 6]);
  });
  return pos;
}

function AgentOrb({ agent, position, label }: { agent: Agent; position: Vec; label: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  const [hover, setHover] = useState(false);
  const selected = useStore((s) => s.selectedAgentId === agent.id);
  const role = useStore((s) => s.roles.find((r) => r.id === agent.roleId));
  const tone = agentTone(agent.status);
  const color = TONE_HEX[tone];
  const size = agent.roleId === 'orchestrator' ? 0.9 : agent.parentId && useStore.getState().agents[agent.parentId]?.roleId === 'orchestrator' ? 0.6 : 0.45;
  const active = agent.status === 'working' || agent.status === 'communicating';
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (ref.current) ref.current.position.y = position[1] + Math.sin(t * 0.8 + position[0]) * 0.12;
    if (halo.current) {
      halo.current.position.y = ref.current?.position.y ?? position[1];
      const s = active ? 1.8 + Math.sin(t * 4) * 0.25 : agent.status === 'failed' ? 1.7 + Math.sin(t * 9) * 0.15 : 1.45;
      halo.current.scale.setScalar(s);
    }
  });
  return (
    <group position={[position[0], 0, position[2]]}>
      <mesh
        ref={ref}
        position={[0, position[1], 0]}
        onClick={(e) => { e.stopPropagation(); useStore.getState().select(agent.id); }}
        onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { setHover(false); document.body.style.cursor = ''; }}
      >
        <icosahedronGeometry args={[size, 2]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={active ? 1.4 : 0.55} roughness={0.25} metalness={0.4} />
      </mesh>
      <mesh ref={halo} position={[0, position[1], 0]}>
        <sphereGeometry args={[size, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={selected ? 0.32 : 0.12} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {(label || hover || selected) && (
        <Label position={[0, position[1] + size + 0.75, 0]} color={color} lines={[{ text: `${role?.icon ?? ''} ${agent.name}`, size: 34, color: '#ffffff' }, { text: AGENT_STATUS_LABEL[agent.status], size: 22, color, weight: 700 }]} />
      )}
    </group>
  );
}

function Link3D({ from, to, color, live }: { from: Vec; to: Vec; color: string; live: boolean }) {
  const dot = useRef<THREE.Mesh>(null);
  const curve = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 1.2, 0));
    return new THREE.QuadraticBezierCurve3(a, mid, b);
  }, [from, to]);
  const points = useMemo(() => curve.getPoints(24), [curve]);
  useFrame(({ clock }) => {
    if (dot.current && live) dot.current.position.copy(curve.getPoint((clock.getElapsedTime() * 0.6) % 1));
  });
  return (
    <>
      <Line points={points} color={color} lineWidth={live ? 2 : 1} transparent opacity={live ? 0.9 : 0.35} />
      {live && (
        <mesh ref={dot}>
          <sphereGeometry args={[0.12, 8, 8]} />
          <meshBasicMaterial color={color} />
        </mesh>
      )}
    </>
  );
}

function CameraRig({ target, enabled, controls }: { target: THREE.Vector3 | null; enabled: boolean; controls: React.RefObject<OrbitControlsImpl | null> }) {
  useFrame(() => {
    if (!enabled || !target || !controls.current) return;
    controls.current.target.lerp(target, 0.03);
    controls.current.update();
  });
  return null;
}

export default function ThreeView() {
  const agentsMap = useStore((s) => s.agents);
  const teams = useStore((s) => s.teams);
  const comms = useStore((s) => s.comms);
  const agents = useMemo(() => Object.values(agentsMap), [agentsMap]);
  const structure = agents.map((a) => `${a.id}${a.parentId}${a.teamId}`).join();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const positions = useMemo(() => layout3d(agents, teams), [structure, teams]);
  const [autoFocus, setAutoFocus] = useState(true);
  const controls = useRef<OrbitControlsImpl>(null);
  const activeTarget = useMemo(() => {
    const act = agents.filter((a) => a.status === 'working' || a.status === 'communicating');
    if (!act.length) return null;
    const v = new THREE.Vector3();
    for (const a of act) v.add(new THREE.Vector3(...(positions.get(a.id) ?? [0, 0, 0])));
    return v.divideScalar(act.length);
  }, [agents, positions]);
  // Camera distance scales with the size of the workforce ring.
  const ringRadius = Math.max(16, Object.keys(teams).length * 3.2 + 8);
  const labelled = new Set(agents.filter((a) => a.roleId === 'orchestrator' || Object.values(teams).some((t) => t.leadAgentId === a.id)).map((a) => a.id));

  return (
    <div className="relative h-full w-full" data-testid="three-view">
      <Canvas camera={{ position: [0, ringRadius * 1.25, ringRadius * 2.1], fov: 50 }} dpr={[1, 1.75]} gl={{ antialias: true, powerPreference: 'high-performance' }} onPointerMissed={() => useStore.getState().select(null)}>
        <color attach="background" args={['#05070d']} />
        <fog attach="fog" args={['#05070d', ringRadius * 2, ringRadius * 6]} />
        <ambientLight intensity={0.35} />
        <pointLight position={[0, 20, 0]} intensity={600} color="#93c5fd" />
        <pointLight position={[25, 5, -20]} intensity={300} color="#c084fc" />
        <Stars radius={90} depth={40} count={2500} factor={3} fade speed={0.6} />
        <gridHelper args={[120, 60, '#1c2540', '#111827']} position={[0, -4, 0]} />
        {Object.values(teams).map((t, i, arr) => {
          const angle = (i / arr.length) * Math.PI * 2;
          const R = Math.max(12, arr.length * 3.2);
          return (
            <group key={t.id} position={[Math.cos(angle) * R, -3.9, Math.sin(angle) * R]}>
              <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[4.6, 5, 64]} />
                <meshBasicMaterial color={t.color} transparent opacity={0.35} />
              </mesh>
              <Label position={[0, 0.8, 5.8]} color={t.color} scale={1.3} lines={[{ text: t.name.toUpperCase(), size: 30, color: t.color, weight: 700 }]} />
            </group>
          );
        })}
        {agents.map((a) => {
          if (!a.parentId || !positions.has(a.parentId) || !positions.has(a.id)) return null;
          const tone = agentTone(a.status);
          return <Link3D key={`l-${a.id}`} from={positions.get(a.parentId)!} to={positions.get(a.id)!} color={TONE_HEX[tone]} live={tone === 'active' || tone === 'comm'} />;
        })}
        {comms.filter((c) => Date.now() - c.at < 4000 && positions.has(c.from) && positions.has(c.to)).map((c) => (
          <Link3D key={`c-${c.from}-${c.to}-${c.at}`} from={positions.get(c.from)!} to={positions.get(c.to)!} color={TONE_HEX.comm} live />
        ))}
        {agents.map((a) => positions.has(a.id) && <AgentOrb key={a.id} agent={a} position={positions.get(a.id)!} label={labelled.has(a.id)} />)}
        <OrbitControls ref={controls} enableDamping dampingFactor={0.08} maxDistance={Math.max(120, ringRadius * 5)} minDistance={6} autoRotate={!autoFocus} autoRotateSpeed={0.35} />
        <CameraRig target={activeTarget} enabled={autoFocus} controls={controls} />
      </Canvas>
      <div className="absolute right-4 top-4 flex items-center gap-1.5">
        <div className="glass flex h-9 items-center gap-0.5 rounded-xl px-1">
          <IconButton label={autoFocus ? 'Auto-focus on active agents: on' : 'Auto-focus: off (orbiting)'} onClick={() => setAutoFocus(!autoFocus)} className={autoFocus ? 'text-blue-300' : ''}><Crosshair size={14} /></IconButton>
          <IconButton label="Reset camera" onClick={() => controls.current?.reset()}><SquareIcon size={13} /></IconButton>
          <IconButton label="Back to 2D canvas" onClick={() => useStore.setState({ dims: '2d' })}><Network size={14} /></IconButton>
        </div>
      </div>
      <div className="glass absolute bottom-4 left-4 rounded-xl px-3 py-2 text-[11px] text-ink-300">
        <div className="mb-1 font-semibold uppercase tracking-[0.16em] text-ink-400">3D command mode</div>
        Drag to rotate · scroll to zoom · click an agent to inspect
        <div className="mt-1.5 flex gap-3">{(['active', 'done', 'wait', 'fail', 'comm', 'idle'] as const).map((t) => <span key={t} className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: TONE_HEX[t] }} />{t}</span>)}</div>
      </div>
    </div>
  );
}
