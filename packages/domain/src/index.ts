export const platformModuleIds = ["todo", "routine", "calendar", "scrap", "ledger"] as const;

export type PlatformModuleId = (typeof platformModuleIds)[number];

export const inboxTargetModuleIds = ["todo", "calendar", "scrap", "ledger"] as const satisfies readonly PlatformModuleId[];

export type InboxTargetModuleId = (typeof inboxTargetModuleIds)[number];

export {
  currentIsoDate,
  koreanDateLabel,
  koreanMonthLabel,
  type WeekdayStyle,
} from "./date.ts";

export {
  hexToOklch,
  normalizeColorToOklch,
  oklchToHex,
  parseOklchColor,
  relativeLuminanceOfColor,
  type OklchColor,
} from "./color.ts";
