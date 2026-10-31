import { useEffect } from 'react';
import { useStore } from '../../store/store';

/** Cinematic but fast (≈1.6s), skippable, once per browser session. */
export function Intro() {
  const done = useStore((s) => s.introDone);
  useEffect(() => {
    if (done) return;
    const finish = () => {
      sessionStorage.setItem('nexus.intro', '1');
      useStore.setState({ introDone: true });
    };
    const t = setTimeout(finish, 1700);
    window.addEventListener('keydown', finish, { once: true });
    window.addEventListener('pointerdown', finish, { once: true });
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', finish);
      window.removeEventListener('pointerdown', finish);
    };
  }, [done]);
  if (done) return null;
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-ink-950" style={{ animation: 'fade-up .2s ease-out' }} data-testid="intro">
      <div className="grid-bg opacity-60" />
      <div className="relative text-center">
        <div className="text-gradient text-6xl font-semibold" style={{ animation: 'intro-in 0.9s cubic-bezier(.2,.8,.2,1) both', letterSpacing: '0.32em' }}>NEXUS</div>
        <div className="mx-auto mt-5 h-px w-64 origin-center bg-gradient-to-r from-transparent via-blue-400 to-transparent" style={{ animation: 'intro-line 0.8s 0.35s ease-out both' }} />
        <div className="mt-4 text-[11px] font-medium uppercase tracking-[0.5em] text-ink-300" style={{ animation: 'fade-up 0.6s 0.6s ease-out both' }}>AI Development Command Center</div>
      </div>
      <div className="absolute bottom-8 text-[10px] text-ink-400">press any key to skip</div>
    </div>
  );
}
