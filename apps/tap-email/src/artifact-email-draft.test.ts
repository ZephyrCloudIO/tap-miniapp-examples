import { describe, expect, it } from '@rstest/core';
import type {
  MiniAppArtifactReference,
  MiniAppResolvedArtifact,
} from '@theaiplatform/miniapp-sdk/sdk';
import type { TapFederatedSurfaceLaunch } from '@theaiplatform/miniapp-sdk/surface';
import {
  EMAIL_ARTIFACT_ACTION_ID,
  artifactEmailDraft,
  resolveArtifactEmailDraft,
  subscribeToArtifactEmailLaunches,
} from './artifact-email-draft';

function reference(kind: MiniAppArtifactReference['kind'] = 'task'): MiniAppArtifactReference {
  return {
    referenceId: 'opaque_ref_1',
    kind,
    artifactId: 'task_42',
    workspaceId: 'workspace_1',
    mintedAt: 1,
    expiresAt: 2,
  };
}

function resolved(kind: MiniAppArtifactReference['kind'] = 'task'): MiniAppResolvedArtifact {
  return {
    reference: reference(kind),
    snapshot: {
      title: 'Approve the launch',
      description: 'Please confirm the production window.',
      url: 'https://tap.example/tasks/42',
    },
    provenance: { source: 'tasks', observedAt: 1, revision: '7' },
    linkedPlotIds: [],
  };
}

function launch(requestId = 'launch_1'): TapFederatedSurfaceLaunch {
  return {
    requestId,
    actionContributionId: EMAIL_ARTIFACT_ACTION_ID,
    invokedAt: 1,
    reference: reference(),
  };
}

describe('TAP work to reviewed email draft', () => {
  it('bounds and narrows a host-versioned artifact snapshot', () => {
    const draft = artifactEmailDraft('launch_1', {
      ...resolved('repository-issue'),
      snapshot: {
        title: 'x'.repeat(500),
        body: 'y'.repeat(5_000),
        url: 'javascript:alert(1)',
      },
    });
    expect(draft.subject.length).toBeLessThanOrEqual(160);
    expect(draft.bodyText).toContain('repository issue');
    expect(draft.bodyText).toContain('TAP repository issue task_42');
    expect(draft.bodyText).not.toContain('javascript:');
    expect(draft.bodyText.length).toBeLessThan(1_700);
  });

  it('resolves only the opaque host reference before drafting', async () => {
    const calls: unknown[] = [];
    const draft = await resolveArtifactEmailDraft({
      artifacts: {
        resolve: async options => {
          calls.push(options);
          return { artifact: resolved() };
        },
      },
      reference: reference(),
      requestId: 'launch_1',
    });
    expect(calls).toEqual([{ reference: reference() }]);
    expect(draft).toMatchObject({
      requestId: 'launch_1',
      subject: 'Regarding: Approve the launch',
    });
    expect(draft.bodyText).toContain('Please confirm the production window.');
  });

  it('acknowledges matching launches once and leaves unrelated actions untouched', async () => {
    let listener: ((value: TapFederatedSurfaceLaunch) => boolean | Promise<boolean>) | null = null;
    let resolveCalls = 0;
    const drafts: string[] = [];
    const stop = subscribeToArtifactEmailLaunches({
      context: {
        launches: {
          subscribe: next => {
            listener = next;
            return () => { listener = null; };
          },
        },
      },
      artifacts: {
        resolve: async () => {
          resolveCalls += 1;
          return { artifact: resolved() };
        },
      },
      onDraft: draft => { drafts.push(draft.requestId); },
      onError: () => undefined,
    });

    expect(listener).not.toBeNull();
    const activeListener = listener!;
    expect(await activeListener({ ...launch(), actionContributionId: 'another-action' })).toBe(false);
    expect(await activeListener(launch())).toBe(true);
    expect(await activeListener(launch())).toBe(true);
    expect(resolveCalls).toBe(1);
    expect(drafts).toEqual(['launch_1']);
    stop();
    expect(listener).toBeNull();
  });

  it('acknowledges an expired or unavailable artifact after surfacing one error', async () => {
    let listener: ((value: TapFederatedSurfaceLaunch) => boolean | Promise<boolean>) | null = null;
    const errors: unknown[] = [];
    subscribeToArtifactEmailLaunches({
      context: {
        launches: {
          subscribe: next => {
            listener = next;
            return () => undefined;
          },
        },
      },
      artifacts: { resolve: async () => ({ artifact: null }) },
      onDraft: () => undefined,
      onError: error => { errors.push(error); },
    });
    expect(await listener!(launch())).toBe(true);
    expect(await listener!(launch())).toBe(true);
    expect(errors).toHaveLength(1);
  });
});
