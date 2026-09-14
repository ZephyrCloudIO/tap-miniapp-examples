import type {
  MiniAppArtifactKind,
  MiniAppArtifactReference,
  MiniAppArtifactsApi,
  MiniAppJsonValue,
  MiniAppResolvedArtifact,
} from '@theaiplatform/miniapp-sdk/sdk';
import type {
  TapFederatedSurfaceLaunch,
  TapFederatedSurfaceMountContext,
} from '@theaiplatform/miniapp-sdk/surface';

const MAXIMUM_SUBJECT_CHARACTERS = 160;
const MAXIMUM_SUMMARY_CHARACTERS = 1_200;
const MAXIMUM_SOURCE_URL_CHARACTERS = 768;

export const EMAIL_ARTIFACT_ACTION_ID = 'tap-email-email-this';

export interface ArtifactEmailDraft {
  readonly requestId: string;
  readonly artifactId: string;
  readonly artifactKind: MiniAppArtifactKind;
  readonly subject: string;
  readonly bodyText: string;
}

type ArtifactSnapshot = Readonly<Record<string, MiniAppJsonValue>>;

export class ArtifactEmailCapabilityUnavailableError extends Error {
  readonly code = 'artifact_email_capability_unavailable' as const;

  constructor() {
    super('This TAP host does not expose artifact context resolution.');
    this.name = 'ArtifactEmailCapabilityUnavailableError';
  }
}

export class ArtifactEmailResolutionError extends Error {
  readonly code = 'artifact_email_resolution_failed' as const;

  constructor() {
    super('The selected TAP item is no longer available. Open it and try Email this again.');
    this.name = 'ArtifactEmailResolutionError';
  }
}

function truncate(value: string, maximum: number, suffix = '…'): string {
  if (value.length <= maximum) return value;
  let end = Math.max(0, maximum - suffix.length);
  const finalCodeUnit = value.charCodeAt(end - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) end -= 1;
  return `${value.slice(0, end)}${suffix}`;
}

function oneLine(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function isSnapshot(value: MiniAppJsonValue): value is ArtifactSnapshot {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringField(snapshot: ArtifactSnapshot, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = snapshot[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function safeSourceUrl(snapshot: ArtifactSnapshot): string | null {
  const candidate = stringField(snapshot, ['url', 'htmlUrl', 'webUrl', 'permalink']);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return truncate(url.href, MAXIMUM_SOURCE_URL_CHARACTERS);
  } catch {
    return null;
  }
}

function artifactLabel(kind: MiniAppArtifactKind): string {
  switch (kind) {
    case 'channel-message': return 'channel message';
    case 'pull-request': return 'pull request';
    case 'repository-issue': return 'repository issue';
    case 'task': return 'task';
  }
}

function artifactTitle(artifact: MiniAppResolvedArtifact): string {
  if (!isSnapshot(artifact.snapshot)) return artifact.reference.artifactId;
  const raw = stringField(artifact.snapshot, ['title', 'subject', 'name']);
  return truncate(oneLine(raw ?? artifact.reference.artifactId), MAXIMUM_SUBJECT_CHARACTERS - 12);
}

function artifactSummary(artifact: MiniAppResolvedArtifact): string | null {
  if (!isSnapshot(artifact.snapshot)) return null;
  const raw = stringField(artifact.snapshot, [
    'summary',
    'description',
    'text',
    'body',
    'content',
  ]);
  return raw ? truncate(raw.trim(), MAXIMUM_SUMMARY_CHARACTERS) : null;
}

export function artifactEmailDraft(
  requestId: string,
  artifact: MiniAppResolvedArtifact,
): ArtifactEmailDraft {
  const label = artifactLabel(artifact.reference.kind);
  const title = artifactTitle(artifact);
  const summary = artifactSummary(artifact);
  const url = isSnapshot(artifact.snapshot) ? safeSourceUrl(artifact.snapshot) : null;
  const source = url ?? `TAP ${label} ${artifact.reference.artifactId}`;
  const body = [
    'Hi,',
    '',
    `I’m following up on this ${label}: ${title}.`,
    ...(summary ? ['', summary] : []),
    '',
    `Source: ${source}`,
    '',
    'Best,',
  ].join('\n');
  return {
    requestId,
    artifactId: artifact.reference.artifactId,
    artifactKind: artifact.reference.kind,
    subject: truncate(`Regarding: ${title}`, MAXIMUM_SUBJECT_CHARACTERS),
    bodyText: body,
  };
}

export async function resolveArtifactEmailDraft({
  artifacts,
  reference,
  requestId,
}: {
  readonly artifacts: MiniAppArtifactsApi | undefined;
  readonly reference: MiniAppArtifactReference;
  readonly requestId: string;
}): Promise<ArtifactEmailDraft> {
  if (!artifacts) throw new ArtifactEmailCapabilityUnavailableError();
  const { artifact } = await artifacts.resolve({ reference });
  if (!artifact) throw new ArtifactEmailResolutionError();
  return artifactEmailDraft(requestId, artifact);
}

export function subscribeToArtifactEmailLaunches({
  context,
  artifacts,
  onDraft,
  onError,
}: {
  readonly context: Pick<TapFederatedSurfaceMountContext, 'launches'>;
  readonly artifacts: MiniAppArtifactsApi | undefined;
  readonly onDraft: (draft: ArtifactEmailDraft) => void | Promise<void>;
  readonly onError: (error: unknown, launch: TapFederatedSurfaceLaunch) => void | Promise<void>;
}): () => void {
  const handled = new Set<string>();
  const inFlight = new Map<string, Promise<void>>();
  return context.launches.subscribe(async launch => {
    if (launch.actionContributionId !== EMAIL_ARTIFACT_ACTION_ID) return false;
    if (handled.has(launch.requestId)) return true;
    const existing = inFlight.get(launch.requestId);
    if (existing) {
      await existing;
      return true;
    }
    const operation = resolveArtifactEmailDraft({
      artifacts,
      reference: launch.reference,
      requestId: launch.requestId,
    }).then(onDraft).catch(error => onError(error, launch)).then(() => {
      handled.add(launch.requestId);
    }).finally(() => {
      inFlight.delete(launch.requestId);
    });
    inFlight.set(launch.requestId, operation);
    await operation;
    return true;
  });
}
