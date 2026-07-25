import { sdk } from '@theaiplatform/miniapp-sdk/sdk';

export const LEDGER_ACTIONS = {
  manage: {
    actionId: 'health-ledger.manage',
    autonomy: 'plan',
    label: 'change this health ledger',
  },
  research: {
    actionId: 'health-ledger.research',
    autonomy: 'plan',
    label: 'run health research',
  },
  export: {
    actionId: 'health-ledger.export',
    autonomy: 'do',
    label: 'export this health ledger',
  },
} as const;

export type LedgerAction = keyof typeof LEDGER_ACTIONS;

type AuthorizationCheck = (options: {
  readonly actionId: string;
  readonly autonomy: 'listen' | 'plan' | 'do';
}) => Promise<{ readonly allowed: boolean }>;

export class LedgerAuthorizationError extends Error {
  readonly action: LedgerAction;

  constructor(action: LedgerAction) {
    const definition = LEDGER_ACTIONS[action];
    super(
      `TAP did not grant ${definition.actionId}; this package cannot ${definition.label}.`,
    );
    this.name = 'LedgerAuthorizationError';
    this.action = action;
  }
}

export async function checkLedgerAction(
  action: LedgerAction,
  check: AuthorizationCheck = options => sdk.authorization.check(options),
): Promise<boolean> {
  const definition = LEDGER_ACTIONS[action];
  const result = await check({
    actionId: definition.actionId,
    autonomy: definition.autonomy,
  });
  return result.allowed;
}

export async function requireLedgerAction(
  action: LedgerAction,
  check?: AuthorizationCheck,
): Promise<void> {
  if (!(await checkLedgerAction(action, check))) {
    throw new LedgerAuthorizationError(action);
  }
}
