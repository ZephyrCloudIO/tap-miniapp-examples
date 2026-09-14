declare module "timezone-support/lookup-convert" {
  export interface TimeZoneInfo {
    readonly name: string;
  }

  export interface TimeZoneData {
    readonly zones: readonly string[];
    readonly links: readonly string[];
  }

  export interface ZonedTime {
    readonly year: number;
    readonly month: number;
    readonly day: number;
    readonly hours: number;
    readonly minutes: number;
    readonly seconds?: number;
    readonly milliseconds?: number;
  }

  export function populateTimeZones(data: TimeZoneData): void;
  export function findTimeZone(name: string): TimeZoneInfo;
  export function getZonedTime(
    date: Date | number,
    timeZone: TimeZoneInfo,
  ): ZonedTime;
}
