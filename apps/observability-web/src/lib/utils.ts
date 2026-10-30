import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Unit } from '@ui-observability/contracts';
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
export function formatValue(
  value: number | null | undefined,
  unit: Unit = 'number',
): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return 'No data';
  if (unit === 'ratio')
    return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
  if (unit === 'percent') return value.toFixed(1) + '%';
  if (unit === 'ms')
    return value >= 1000
      ? (value / 1000).toFixed(2) + ' s'
      : value.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' ms';
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
export const timeLabel = (value: number) =>
  new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
export function localDate(value: number): string {
  const date = new Date(value);
  return new Date(value - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
