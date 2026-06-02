import { DailyActivity } from '../types';

interface Props {
  data: DailyActivity[];
}

function getColor(cost: number): string {
  if (cost <= 0)    return '#ebedf0';
  if (cost < 0.01)  return '#9be9a8';
  if (cost < 0.05)  return '#40c463';
  if (cost < 0.20)  return '#30a14e';
  return '#216e39';
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function YearHeatmap({ data }: Props) {
  const map = new Map(data.map(d => [d.date, d]));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days: Date[] = [];
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push(d);
  }

  const firstDay = days[0].getDay();
  const padded: (Date | null)[] = [...Array(firstDay).fill(null), ...days];

  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < padded.length; i += 7) {
    weeks.push(padded.slice(i, i + 7));
  }

  const monthLabels: { label: string; col: number }[] = [];
  let lastMonth = -1;
  weeks.forEach((week, col) => {
    const first = week.find(d => d !== null);
    if (first && first.getMonth() !== lastMonth) {
      lastMonth = first.getMonth();
      monthLabels.push({
        label: first.toLocaleString('en', { month: 'short' }),
        col,
      });
    }
  });

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ position: 'relative', paddingTop: '20px' }}>
        {monthLabels.map(({ label, col }) => (
          <span
            key={col}
            style={{
              position: 'absolute',
              top: 0,
              left: col * 14,
              fontSize: '11px',
              color: '#666',
            }}
          >
            {label}
          </span>
        ))}
        <div style={{ display: 'flex', gap: '2px' }}>
          {weeks.map((week, wi) => (
            <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {week.map((day, di) => {
                if (!day) return <div key={di} style={{ width: 12, height: 12 }} />;
                const dateStr = formatDate(day);
                const entry = map.get(dateStr);
                const cost = entry?.cost_usd ?? 0;
                const title = entry
                  ? `${dateStr}\n$${cost.toFixed(4)} · ${entry.tool_calls} calls`
                  : dateStr;
                return (
                  <div
                    key={di}
                    title={title}
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 2,
                      backgroundColor: getColor(cost),
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
