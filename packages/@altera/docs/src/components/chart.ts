import type { ComponentTypeDefinition } from '../core/types.ts';
import { escapeHtml, formatNumber, toString } from './utils.ts';

interface BarPoint {
  label: string;
  value: number;
}

function renderBarChart(points: BarPoint[], width: number, height: number): string {
  if (points.length === 0) return '<div>No data</div>';
  const maxVal = Math.max(...points.map((p) => p.value), 0);
  const minVal = Math.min(...points.map((p) => p.value), 0);
  const span = maxVal - minVal || 1;
  const barGap = 4;
  const chartPadLeft = 40;
  const chartPadBottom = 30;
  const chartPadTop = 10;
  const chartPadRight = 10;
  const innerW = width - chartPadLeft - chartPadRight;
  const innerH = height - chartPadTop - chartPadBottom;
  const barWidth = Math.max(
    6,
    (innerW - barGap * (points.length - 1)) / points.length,
  );

  const zeroY = chartPadTop + innerH - ((0 - minVal) / span) * innerH;

  const bars = points
    .map((p, i) => {
      const x = chartPadLeft + i * (barWidth + barGap);
      const vNormalized = (p.value - minVal) / span;
      const y = chartPadTop + innerH - vNormalized * innerH;
      const h = Math.max(1, Math.abs(zeroY - y));
      const top = Math.min(zeroY, y);
      return `<g><rect x="${x}" y="${top}" width="${barWidth}" height="${h}" fill="currentColor" opacity="0.8"/>
        <text x="${x + barWidth / 2}" y="${chartPadTop + innerH + 16}" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.6">${escapeHtml(
          toString(p.label),
        )}</text></g>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="bar chart">
    <line x1="${chartPadLeft}" y1="${zeroY}" x2="${width - chartPadRight}" y2="${zeroY}" stroke="currentColor" stroke-opacity="0.2" stroke-width="1"/>
    ${bars}
    <text x="${chartPadLeft - 4}" y="${chartPadTop + 10}" text-anchor="end" font-size="10" fill="currentColor" opacity="0.6">${formatNumber(maxVal)}</text>
    <text x="${chartPadLeft - 4}" y="${chartPadTop + innerH}" text-anchor="end" font-size="10" fill="currentColor" opacity="0.6">${formatNumber(minVal)}</text>
  </svg>`;
}

function renderLineChart(points: BarPoint[], width: number, height: number): string {
  if (points.length === 0) return '<div>No data</div>';
  const maxVal = Math.max(...points.map((p) => p.value));
  const minVal = Math.min(...points.map((p) => p.value));
  const span = maxVal - minVal || 1;
  const chartPadLeft = 40;
  const chartPadBottom = 30;
  const chartPadTop = 10;
  const chartPadRight = 10;
  const innerW = width - chartPadLeft - chartPadRight;
  const innerH = height - chartPadTop - chartPadBottom;

  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
  const coords = points.map((p, i) => {
    const x = chartPadLeft + i * stepX;
    const y = chartPadTop + innerH - ((p.value - minVal) / span) * innerH;
    return { x, y, p };
  });

  const path = coords
    .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`)
    .join(' ');
  const dots = coords
    .map((c) => `<circle cx="${c.x}" cy="${c.y}" r="3" fill="currentColor"/>`)
    .join('');
  const labels = coords
    .map(
      (c, i) =>
        `<text x="${c.x}" y="${chartPadTop + innerH + 16}" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.6">${escapeHtml(
          toString(points[i]?.label),
        )}</text>`,
    )
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="line chart">
    <path d="${path}" fill="none" stroke="currentColor" stroke-width="2"/>
    ${dots}
    ${labels}
  </svg>`;
}

export const chartComponent: ComponentTypeDefinition = {
  type: 'chart',
  label: 'Chart',
  description: 'Simple inline SVG chart (bar or line)',
  agentHint:
    'Use for visualizations. Bind: { points: "path.to.array" } with [{ label, value }]. Props: { variant: "bar"|"line", width?, height? }',
  mode: 'read',
  validate: (data, component) => {
    if (!Array.isArray(data.points))
      return [
        {
          component_id: component.id,
          code: 'INVALID_POINTS',
          message: 'Chart requires points as array',
        },
      ];
    return [];
  },
  renderLoom: (data, component) => {
    const points = data.points as BarPoint[];
    const variant = (component.variant ?? component.props?.variant ?? 'bar') as
      | 'bar'
      | 'line';
    const width = (component.props?.width as number) ?? 480;
    const height = (component.props?.height as number) ?? 200;

    const svg =
      variant === 'line'
        ? renderLineChart(points, width, height)
        : renderBarChart(points, width, height);

    return `<div data-ui="card" data-variant="chart"><div data-part="body">${svg}</div></div>`;
  },
};
