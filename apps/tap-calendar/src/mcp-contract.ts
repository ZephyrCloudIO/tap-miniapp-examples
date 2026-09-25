export const CALENDAR_MCP_SCOPES = ["calendar.read", "calendar.analytics", "calendar.write"] as const;
export type CalendarMcpScope = typeof CALENDAR_MCP_SCOPES[number];
export interface CalendarMcpConfiguration {
  readonly conflictCalendarIds: readonly string[];
  readonly eventTypes: readonly {
    readonly profileId: string;
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly durationMinutes: number;
    readonly active: boolean;
    readonly approvalRequired: boolean;
  }[];
}
export interface CalendarMcpConsent {
  readonly clientName: string;
  readonly redirectOrigin: string;
  readonly scopes: readonly CalendarMcpScope[];
  readonly expiresAt: string;
}
export interface CalendarMcpGrant {
  readonly id: string;
  readonly clientName: string;
  readonly scopes: readonly CalendarMcpScope[];
  readonly createdAt: string;
}
