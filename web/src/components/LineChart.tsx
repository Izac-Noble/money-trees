import { useId } from "react";
import { toPlotNumber } from "../lib/format";

export type Series = {
  label: string;
  /**
   * API money strings by month: index 0 is the starting balance (month 0), then
   * each month's ending balance.
   */
  values: string[];
  color: string;
  /** Dash pattern so lines differ by more than color. */
  dash?: string;
};

type Props = {
  title: string;
  description: string;
  series: Series[];
};

const WIDTH = 640;
const HEIGHT = 240;
const PAD = { top: 12, right: 12, bottom: 28, left: 12 };

/**
 * A small responsive SVG line chart of balances by month. Strings are converted to
 * numbers for plotting only; values shown as text come straight from the API.
 */
export function LineChart({ title, description, series }: Props) {
  const id = useId();
  const lastMonth = Math.max(1, ...series.map((s) => s.values.length - 1));
  const peak = Math.max(1, ...series.flatMap((s) => s.values.map(toPlotNumber)));
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (month: number) => PAD.left + (plotW * month) / lastMonth;
  const y = (v: number) => PAD.top + plotH - (plotH * v) / peak;

  return (
    <figure className="mt-4">
      <figcaption className="text-sm font-medium">{title}</figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="mt-2 h-auto w-full"
        role="img"
        aria-labelledby={`${id}-t ${id}-d`}
      >
        <title id={`${id}-t`}>{title}</title>
        <desc id={`${id}-d`}>{description}</desc>
        <line
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={PAD.top + plotH}
          y2={PAD.top + plotH}
          stroke="#d6d3d1"
        />
        {series.map((s) => (
          <polyline
            key={s.label}
            points={s.values.map((v, month) => `${x(month)},${y(toPlotNumber(v))}`).join(" ")}
            fill="none"
            stroke={s.color}
            strokeWidth={2.5}
            strokeDasharray={s.dash}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <text x={PAD.left} y={HEIGHT - 8} fontSize={12} fill="#57534e">
          Month 0
        </text>
        <text x={WIDTH - PAD.right} y={HEIGHT - 8} fontSize={12} fill="#57534e" textAnchor="end">
          Month {lastMonth}
        </text>
      </svg>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-700">
        {series.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <svg width="28" height="8" aria-hidden="true">
              <line
                x1="0"
                x2="28"
                y1="4"
                y2="4"
                stroke={s.color}
                strokeWidth="3"
                strokeDasharray={s.dash}
              />
            </svg>
            {s.label} (balance reaches 0 in month {s.values.length - 1})
          </li>
        ))}
      </ul>
    </figure>
  );
}
