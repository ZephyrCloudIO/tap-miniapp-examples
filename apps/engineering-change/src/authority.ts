import { sdk } from "@theaiplatform/miniapp-sdk/sdk";
import type { TapFederatedSurfaceMountContext } from "@theaiplatform/miniapp-sdk/surface";

export const CHANGES_PROPOSE_ACTION = "changes.propose";
export const CHANGES_REVIEW_ACTION = "changes.review";
export const FINDINGS_DISPOSITION_ACTION = "findings.disposition";
export const TASK_WRITE_ACTION = "task.write";
export const POLICIES_MANAGE_ACTION = "policies.manage";
export const EVIDENCE_CAPTURE_ACTION = "evidence.capture";

export type EngineeringChangeAuthorityAction =
  | typeof CHANGES_PROPOSE_ACTION
  | typeof CHANGES_REVIEW_ACTION
  | typeof FINDINGS_DISPOSITION_ACTION
  | typeof TASK_WRITE_ACTION
  | typeof POLICIES_MANAGE_ACTION
  | typeof EVIDENCE_CAPTURE_ACTION;

export type EngineeringChangeAuthorityGuard = (
  actionId: EngineeringChangeAuthorityAction,
) => Promise<boolean>;

const actionAutonomy: Readonly<
  Record<EngineeringChangeAuthorityAction, "listen" | "plan" | "do">
> = {
  [CHANGES_PROPOSE_ACTION]: "plan",
  [CHANGES_REVIEW_ACTION]: "do",
  [FINDINGS_DISPOSITION_ACTION]: "do",
  [TASK_WRITE_ACTION]: "do",
  [POLICIES_MANAGE_ACTION]: "do",
  [EVIDENCE_CAPTURE_ACTION]: "plan",
};

const actionOperation: Readonly<Record<EngineeringChangeAuthorityAction, string>> = {
  [CHANGES_PROPOSE_ACTION]: "shape change proposals",
  [CHANGES_REVIEW_ACTION]: "coordinate change reviews",
  [FINDINGS_DISPOSITION_ACTION]: "disposition review findings",
  [TASK_WRITE_ACTION]: "create follow-up tasks",
  [POLICIES_MANAGE_ACTION]: "manage assurance policies",
  [EVIDENCE_CAPTURE_ACTION]: "capture change evidence",
};

async function waitForHostAuthority(
  context: TapFederatedSurfaceMountContext,
): Promise<void> {
  if (context.hostAuthority.getSnapshot()) return;
  await new Promise<void>((resolve) => {
    let unsubscribe: (() => void) | undefined;
    let settled = false;
    const confirm = () => {
      if (settled || !context.hostAuthority.getSnapshot()) return;
      settled = true;
      unsubscribe?.();
      resolve();
    };
    unsubscribe = context.hostAuthority.subscribe(confirm);
    if (settled) unsubscribe();
    confirm();
  });
}

export async function hasEngineeringChangeAuthority(
  context: TapFederatedSurfaceMountContext | undefined,
  preview: boolean,
  actionId: EngineeringChangeAuthorityAction,
): Promise<boolean> {
  if (preview) return true;
  if (!context) return false;
  try {
    await waitForHostAuthority(context);
    return (
      await sdk.authorization.check({
        actionId,
        autonomy: actionAutonomy[actionId],
      })
    ).allowed;
  } catch {
    return false;
  }
}

export async function requireEngineeringChangeAuthority(
  context: TapFederatedSurfaceMountContext | undefined,
  preview: boolean,
  actionId: EngineeringChangeAuthorityAction,
): Promise<void> {
  if (await hasEngineeringChangeAuthority(context, preview, actionId)) return;
  throw new Error(
    `TAP authorization does not allow this miniapp to ${actionOperation[actionId]}.`,
  );
}
