export type UtcInterval = { start: string; end: string };

const MINUTE = 60_000;
const UTC_MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/;

export function minuteTimestamp(value: string): number {
  if (!UTC_MINUTE.test(value)) throw new Error('Qualifying ranges require whole UTC minute boundaries.');
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw new Error('Invalid UTC minute.');
  return time;
}

export function intervalTimes(interval: UtcInterval): [number, number] {
  const start = minuteTimestamp(interval.start);
  const end = minuteTimestamp(interval.end);
  if (end <= start) throw new Error('Qualifying range end must follow start.');
  return [start, end];
}

export function monthBounds(period: string): [number, number] {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!match) throw new Error('Invalid UTC month.');
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const start = Date.UTC(year, month, 1);
  const end = Date.UTC(year, month + 1, 1);
  if (new Date(start).getUTCFullYear() !== year) throw new Error('Invalid UTC month.');
  return [start, end];
}

export function unionMinutesInMonth(period: string, intervals: UtcInterval[]): number {
  const [monthStart, monthEnd] = monthBounds(period);
  const clipped = intervals.map(intervalTimes)
    .map(([start, end]) => [Math.max(start, monthStart), Math.min(end, monthEnd)] as [number, number])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let minutes = 0;
  let left = 0;
  let right = 0;
  for (const [start, end] of clipped) {
    if (start > right) {
      minutes += (right - left) / MINUTE;
      left = start;
      right = end;
    } else {
      right = Math.max(right, end);
    }
  }
  return minutes + (right - left) / MINUTE;
}

export function minutesInMonth(period: string): number {
  const [start, end] = monthBounds(period);
  return (end - start) / MINUTE;
}
