import { stripVTControlCharacters, styleText } from 'node:util';
import Table from 'cli-table3';

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

export interface CommandTableRow {
  values: string[];
  tone?: CommandOutputRow['tone'];
}

function terminalWidth(): number {
  const width = process.stdout.isTTY
    ? process.stdout.columns
    : Number(process.env.COLUMNS ?? 120);
  return Number.isSafeInteger(width) && width > 0 ? width : 120;
}

/* cli-table3 owns wrapping, Unicode widths, borders and alignment; styleText owns all colors. */
export function formatCommandTable(
  title: string,
  headers: string[],
  rows: CommandTableRow[],
): string {
  const available = terminalWidth() - headers.length - 1;
  const columnWidth = Math.max(4, Math.floor(available / headers.length));
  const colWidths = headers.map(() => columnWidth);

  if (headers.length === 2) {
    const labelWidth = Math.min(30, columnWidth);
    colWidths[0] = labelWidth;
    colWidths[1] = Math.max(4, available - labelWidth);
  }

  const table = new Table({
    head: headers.map((header) => styleText(['bold', 'cyan'], header)),
    colWidths,
    wordWrap: true,
    style: { head: [], border: [] },
  });

  for (const { values, tone } of rows) {
    table.push(
      values.map((value) => {
        const text = stripVTControlCharacters(value);
        return tone ? styleText(colors[tone], text) : text;
      }),
    );
  }

  return [
    styleText(['bold', 'cyan'], stripVTControlCharacters(title)),
    table.toString(),
    '',
  ].join('\n');
}

export function formatCommandOutput(
  title: string,
  rows: CommandOutputRow[],
): string {
  return formatCommandTable(
    title,
    ['Metric', 'Result'],
    rows.map(({ label, value, tone }) => ({
      values: [label, value],
      ...(tone ? { tone } : {}),
    })),
  );
}
