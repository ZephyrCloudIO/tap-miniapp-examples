import type {
  MiniAppMaybePromise,
  MiniAppStorageAddress,
  MiniAppStorageEntry,
} from '@theaiplatform/miniapp-sdk/sdk';
import {
  isEmailActivityProjection,
  parseEmailActivitySummaryRequest,
  summarizeEmailActivity,
  type EmailActivitySummary,
  type EmailActivitySummaryRequest,
} from './activity';
import { activityAddress } from './storage';

export const TAP_EMAIL_ACTIVITY_SOURCE_ID =
  'tap-email-committed-actions' as const;

/**
 * Identity and scope are stamped by the future host invocation path. They are
 * deliberately absent from the user-controlled range request and from the
 * storage address, so package code cannot substitute a principal or workspace.
 */
export interface TrustedEmailActivitySourceContext {
  readonly userId: string;
  readonly workspaceId: string;
  readonly sourceId: typeof TAP_EMAIL_ACTIVITY_SOURCE_ID;
}

export interface EmailActivitySourceRequest {
  readonly startAt: string;
  readonly endAtExclusive: string;
  readonly timeZone: string;
}

/** The future host injects a workspace/package-scoped, read-only snapshot. */
export interface ReadOnlyEmailActivitySourceStorage {
  read(
    address: Readonly<MiniAppStorageAddress>,
  ): MiniAppMaybePromise<Readonly<MiniAppStorageEntry>>;
}

export interface GovernedEmailActivitySourceResult {
  readonly sourceId: typeof TAP_EMAIL_ACTIVITY_SOURCE_ID;
  /** Opaque revision of the exact activity/v1 snapshot used for this result. */
  readonly sourceRevision: string;
  readonly summary: EmailActivitySummary;
}

export interface EmailActivitySourceRuntime {
  execute(
    context: unknown,
    request: unknown,
  ): Promise<GovernedEmailActivitySourceResult>;
}

const contextKeys = new Set(['userId', 'workspaceId', 'sourceId']);
const requestKeys = new Set(['startAt', 'endAtExclusive', 'timeZone']);
const sourceStorageAddress = Object.freeze({ ...activityAddress });

function hasExactOwnKeys(
  value: Readonly<Record<PropertyKey, unknown>>,
  expected: ReadonlySet<string>,
): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expected.size &&
    keys.every(key => typeof key === 'string' && expected.has(key))
  );
}

function isBoundedScope(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 512 &&
    value.trim() === value
  );
}

function assertTrustedContext(
  value: unknown,
): asserts value is TrustedEmailActivitySourceContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(
      'Email activity source requires immutable trusted user, workspace, and source scope.',
    );
  }
  const context = value as Readonly<Record<PropertyKey, unknown>>;
  if (
    !Object.isFrozen(value) ||
    !hasExactOwnKeys(context, contextKeys) ||
    !isBoundedScope(context.userId) ||
    !isBoundedScope(context.workspaceId) ||
    context.sourceId !== TAP_EMAIL_ACTIVITY_SOURCE_ID
  ) {
    throw new Error(
      'Email activity source requires immutable trusted user, workspace, and source scope.',
    );
  }
}

function parseSourceRequest(value: unknown): EmailActivitySummaryRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Email activity source requires one exact range request.');
  }
  const request = value as Readonly<Record<PropertyKey, unknown>>;
  if (!hasExactOwnKeys(request, requestKeys)) {
    throw new Error('Email activity source requires one exact range request.');
  }
  return parseEmailActivitySummaryRequest({
    start_at: request.startAt,
    end_at_exclusive: request.endAtExclusive,
    timezone: request.timeZone,
  });
}

function parseSourceRevision(value: unknown): string {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error('Email activity source requires a trusted source revision.');
  }
  return String(value);
}

export function createEmailActivitySourceRuntime(
  storage: ReadOnlyEmailActivitySourceStorage,
): EmailActivitySourceRuntime {
  return Object.freeze({
    async execute(context: unknown, request: unknown) {
      // Context and input are validated before the injected reader is touched.
      // Authenticity itself belongs to the future host-governed invocation path;
      // this runtime is intentionally not registered as a manifest contribution.
      assertTrustedContext(context);
      const parsedRequest = parseSourceRequest(request);
      const entry = await storage.read(sourceStorageAddress);
      if (!entry || !isEmailActivityProjection(entry.value)) {
        throw new Error(
          'Email activity source projection is unavailable or malformed.',
        );
      }
      const sourceRevision = parseSourceRevision(entry.revision);
      return Object.freeze({
        sourceId: TAP_EMAIL_ACTIVITY_SOURCE_ID,
        sourceRevision,
        summary: summarizeEmailActivity(entry.value, parsedRequest),
      });
    },
  });
}
