import { useEffect, useState } from 'react';

export function AudioWaveform({ level, active }: { level: number; active: boolean }) {
  const [history, setHistory] = useState<number[]>(() => Array(28).fill(0));
  useEffect(() => {
    setHistory(previous => active ? [...previous.slice(1), Math.max(0, Math.min(1, level))] : Array(28).fill(0));
  }, [active, level]);
  return <div className="audio-waveform" role="img" aria-label={active ? 'Live audio amplitude waveform' : 'Audio paused'}>
    {history.map((sample, index) => <span key={index} style={{ height: `${2 + sample * 38}px` }} />)}
  </div>;
}
