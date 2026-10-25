import { styleText } from 'node:util';

export interface CommandOutputRow {
  label: string;
  value: string;
  tone?: 'success' | 'warning' | 'error';
}

const colors = {
  success: 'green',
  warning: 'yellow',
  error: 'red',
} as const;

export function formatCommandOutput(
  title: string,
  rows: CommandOutputRow[],
): string {
  const width = Math.max(0, ...rows.map(({ label }) => label.length));
  const lines = rows.map(({ label, value, tone }) => {
    const line = `  ${label.padEnd(width)}  ${value}`;

    return tone ? styleText(['bold', colors[tone]], line) : line;
  });

  return [styleText('bold', title), ...lines, ''].join('\n');
}
