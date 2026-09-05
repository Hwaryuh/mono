import type { SVGProps } from "react";

const paths = {
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  calendar: "M4 6h16v14H4zM8 3v4M16 3v4M4 10h16",
  todo: "M4 5h16v14H4zM8 12l2.5 2.5L16 9",
  routine: "M4 12a8 8 0 0113.7-5.7M20 12a8 8 0 01-13.7 5.7M18 4v4h-4M6 20v-4h4",
  scrap: "M9 15l6-6M10 6h5a3 3 0 010 6h-1M14 18H9a3 3 0 010-6h1",
  wallet: "M3 7h18v12H3zM3 11h6a2 2 0 000 4H3",
  inbox: "M4 5h16v14H4zM4 13h5l1 3h4l1-3h5",
  note: "M5 4h10l4 4v12H5zM15 4v4h4",
  file: "M6 3H14L18 7V21H6ZM14 3V7H18M9 13H15M9 16.5H13",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4",
  video: "M4 6h11v12H4zM15 10l5-3v10l-5-3z",
  clock: "M12 4a8 8 0 100 16 8 8 0 000-16zM12 8v4l3 2",
  play: "M8 5.5l11 6.5-11 6.5z",
  pause: "M9.5 5.5v13M14.5 5.5v13",
  skip: "M6 6l8 6-8 6zM18 5.5v13",
  alert: "M12 4l9 16H3zM12 10v4.5M12 17.4v.4",
  ghost: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM9 10l6 6M15 10l-6 6",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  label: "M4 7h9l7 5-7 5H4zM8 12h.01",
  search: "M11 4a7 7 0 100 14 7 7 0 000-14zM16.5 16.5L20 20",
  plus: "M12 5v14M5 12h14",
  bell: "M6 16V10a6 6 0 0112 0v6l2 2H4zM10 20a2 2 0 004 0",
  check: "M5 12.5l4.5 4.5L19 7",
  close: "M6 6l12 12M18 6L6 18",
  chevronRight: "M9 6l6 6-6 6",
  chevronDown: "M6 9l6 6 6-6",
  arrowLeft: "M14 6l-6 6 6 6",
  arrowUp: "M12 19V5M6 11l6-6 6 6",
  arrowDown: "M12 5v14M6 13l6 6 6-6",
  download: "M12 4v10M7 11l5 5 5-5M5 20h14",
  send: "M12 19V5M6 11l6-6 6 6",
  sparkles: "M12 4l1.8 4.7L18.5 10l-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.3zM18 16l.9 2.1L21 19l-2.1.9L18 22l-.9-2.1L15 19l2.1-.9z",
  moon: "M20 15.2A8 8 0 018.8 4 8.5 8.5 0 1020 15.2z",
  sun: "M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  panelCollapse: "M4 4h16v16H4zM9 4v16M15 9l-3 3 3 3",
  panelExpand: "M4 4h16v16H4zM9 4v16M12 9l3 3-3 3",
  message: "M4 5h16v11H9l-5 4z",
  location: "M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11zM12 8a2.5 2.5 0 100 5 2.5 2.5 0 000-5z",
  edit: "M5 19h14M7 15l9-9 2 2-9 9H7z",
  trash: "M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13M10 11v5M14 11v5",
  sync: "M4 12a8 8 0 0113.7-5.7M20 12a8 8 0 01-13.7 5.7",
  server: "M4 5h16v6H4zM4 13h16v6H4zM7.5 8h.01M7.5 16h.01M12 8h5M12 16h5",
  settings: "M4 7h6M14 7h6M12 5v4M4 12h10M18 12h2M16 10v4M4 17h2M10 17h10M8 15v4",
  star: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
} as const;

export type IconName = keyof typeof paths;

export type IconProps = Omit<SVGProps<SVGSVGElement>, "name"> & {
  name: IconName;
  size?: number;
  strokeWidth?: number;
};

export function Icon({ name, size = 16, strokeWidth = 1.6, className, ...props }: IconProps) {
  return (
    <svg
      aria-hidden={props["aria-label"] ? undefined : true}
      className={className}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
