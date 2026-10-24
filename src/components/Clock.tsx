import { useEffect, useState } from 'react';

const fmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Current local time next to the wordmark; re-renders once per minute only. */
export function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const d = new Date();
      t = setTimeout(() => {
        setNow(new Date());
        schedule();
      }, 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 50);
    };
    schedule();
    return () => clearTimeout(t);
  }, []);
  return (
    <time className="brand brand--clock" dateTime={now.toISOString()}>
      {fmt.format(now)}
    </time>
  );
}
