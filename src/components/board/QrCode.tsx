import { useMemo } from 'react';
import { encode } from 'uqr';

/**
 * A QR code drawn as one SVG path, encoded on the client so the board link
 * never leaves the browser. Colors come from `--qr-dark` / `--qr-light`,
 * which no theme overrides: scanners want dark modules on a light quiet zone.
 */
export function QrCode({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const { size, path } = useMemo(() => {
    // Medium error correction survives glare on a shared screen; a border of
    // four modules is the quiet zone the spec asks for.
    const qr = encode(value, { ecc: 'M', border: 4 });
    let d = '';
    qr.data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      });
    });
    return { size: qr.size, path: d };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width={size} height={size} fill="var(--qr-light)" />
      <path d={path} fill="var(--qr-dark)" />
    </svg>
  );
}
