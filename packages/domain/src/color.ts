export type OklchColor = {
  lightness: number;
  chroma: number;
  hue: number;
};

type RgbColor = {
  red: number;
  green: number;
  blue: number;
};

const HEX_COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const OKLCH_COLOR_PATTERN = /^oklch\(\s*(\d*\.?\d+)\s+(\d*\.?\d+)\s+(\d*\.?\d+)\s*\)$/i;

export function parseOklchColor(value: string): OklchColor | null {
  const match = value.match(OKLCH_COLOR_PATTERN);
  if (!match) return null;
  const lightness = Number(match[1]);
  const chroma = Number(match[2]);
  const hue = Number(match[3]);
  if (!Number.isFinite(lightness) || lightness < 0 || lightness > 1) return null;
  if (!Number.isFinite(chroma) || chroma < 0 || chroma > 0.4) return null;
  if (!Number.isFinite(hue) || hue < 0 || hue >= 360) return null;
  return { lightness, chroma, hue };
}

export function hexToOklch(value: string): string | null {
  const rgb = rgbOfHex(value);
  if (!rgb) return null;
  const red = srgbToLinear(rgb.red);
  const green = srgbToLinear(rgb.green);
  const blue = srgbToLinear(rgb.blue);
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const chroma = Math.hypot(a, b);
  const hue = chroma < 0.0005 ? 0 : (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
  return formatOklchColor({ lightness, chroma, hue });
}

export function oklchToHex(value: string): string | null {
  const color = parseOklchColor(value);
  if (!color) return null;
  const rgb = rgbOfOklch(color);
  return `#${[rgb.red, rgb.green, rgb.blue]
    .map((channel) => Math.round(clamp(channel) * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

export function normalizeColorToOklch(value: string): string | null {
  const parsed = parseOklchColor(value);
  if (parsed) return formatOklchColor(parsed);
  return hexToOklch(value);
}

export function relativeLuminanceOfColor(value: string): number | null {
  const parsed = parseOklchColor(value);
  const rgb = parsed ? rgbOfOklch(parsed) : rgbOfHex(value);
  if (!rgb) return null;
  return 0.2126 * srgbToLinear(rgb.red) + 0.7152 * srgbToLinear(rgb.green) + 0.0722 * srgbToLinear(rgb.blue);
}

function formatOklchColor(color: OklchColor) {
  return `oklch(${formatChannel(color.lightness)} ${formatChannel(color.chroma)} ${formatChannel(color.hue)})`;
}

function formatChannel(value: number) {
  const formatted = value.toFixed(3).replace(/\.?0+$/, "");
  return formatted === "-0" ? "0" : formatted;
}

function rgbOfHex(value: string): RgbColor | null {
  const match = value.match(HEX_COLOR_PATTERN);
  if (!match) return null;
  const normalized = match[1].length === 3
    ? [...match[1]].map((digit) => digit.repeat(2)).join("")
    : match[1];
  return {
    red: Number.parseInt(normalized.slice(0, 2), 16) / 255,
    green: Number.parseInt(normalized.slice(2, 4), 16) / 255,
    blue: Number.parseInt(normalized.slice(4, 6), 16) / 255,
  };
}

function rgbOfOklch({ lightness, chroma, hue }: OklchColor): RgbColor {
  const radians = hue * Math.PI / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    red: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    green: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    blue: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

function srgbToLinear(channel: number) {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(channel: number) {
  return channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
}

function clamp(channel: number) {
  return Math.min(1, Math.max(0, channel));
}
