import type { CSSProperties } from "react";

type IconLine = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  opacity?: number;
};

type IconDefinition = {
  lines: [IconLine, IconLine, IconLine];
};

const CENTER = 7;
const collapsed: IconLine = { x1: CENTER, y1: CENTER, x2: CENTER, y2: CENTER, opacity: 0 };

const definitions: Record<"settings" | "close", IconDefinition> = {
  settings: {
    lines: [
      { x1: 2, y1: 3.5, x2: 12, y2: 3.5 },
      { x1: 4, y1: 7, x2: 12, y2: 7 },
      { x1: 2, y1: 10.5, x2: 10, y2: 10.5 },
    ],
  },
  close: {
    lines: [
      { x1: 2.5, y1: 2.5, x2: 11.5, y2: 11.5 },
      { x1: 11.5, y1: 2.5, x2: 2.5, y2: 11.5 },
      collapsed,
    ],
  },
};

export type MorphingIconName = keyof typeof definitions;

export type MorphingIconProps = {
  name: MorphingIconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
};

function transformOf(line: IconLine) {
  const deltaX = line.x2 - line.x1;
  const deltaY = line.y2 - line.y1;
  const length = Math.hypot(deltaX, deltaY);
  const angle = Math.atan2(deltaY, deltaX) * 180 / Math.PI;
  return `translate(${line.x1}px, ${line.y1}px) rotate(${angle}deg) scaleX(${length})`;
}

export function MorphingIcon({ name, size = 16, strokeWidth = 1.6, className }: MorphingIconProps) {
  const definition = definitions[name];
  return (
    <svg aria-hidden="true" className={className} fill="none" height={size} stroke="currentColor" strokeWidth={strokeWidth} viewBox="0 0 14 14" width={size}>
      {definition.lines.map((line, index) => (
        <line
          className="ui-morphing-icon__line"
          key={index}
          opacity={line.opacity ?? 1}
          strokeLinecap="round"
          style={{ transform: transformOf(line) } as CSSProperties}
          vectorEffect="non-scaling-stroke"
          x1={0}
          x2={1}
          y1={0}
          y2={0}
        />
      ))}
    </svg>
  );
}
