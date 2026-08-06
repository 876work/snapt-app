/** Tiny inline trend — a shape, not a chart: no axes, no legend, no ticks. */
export function Sparkline({
  points,
  width = 96,
  height = 28,
  stroke = 'var(--brand)',
}: {
  points: number[];
  width?: number;
  height?: number;
  stroke?: string;
}) {
  if (points.length < 2 || points.every((p) => p === 0)) {
    return (
      <svg width={width} height={height} aria-hidden>
        <line x1={0} y1={height - 4} x2={width} y2={height - 4} stroke="var(--line)" strokeWidth={1.5} strokeDasharray="3 4" />
      </svg>
    );
  }
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const y = (v: number) => 3 + (height - 6) * (1 - (v - min) / span);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  return (
    <svg width={width} height={height} aria-hidden>
      <path d={d} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={width} cy={y(last)} r={2.6} fill={stroke} />
    </svg>
  );
}
