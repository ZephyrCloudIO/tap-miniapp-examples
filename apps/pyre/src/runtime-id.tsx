import * as React from "react";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import {
  auditMutation as domainAuditMutation,
  runtimeId as createRuntimeId,
  type Investigation,
  type RuntimeIdFactory,
} from "./domain";

const RuntimeIdContext = createContext<RuntimeIdFactory>(createRuntimeId);

export function PyreRuntimeIdProvider({
  children,
  randomUUID,
}: {
  children: ReactNode;
  randomUUID: () => string;
}) {
  const idFactory = useMemo<RuntimeIdFactory>(
    () => (prefix) => createRuntimeId(prefix, randomUUID),
    [randomUUID],
  );
  return (
    <RuntimeIdContext.Provider value={idFactory}>
      {children}
    </RuntimeIdContext.Provider>
  );
}

export const useRuntimeId = (): RuntimeIdFactory =>
  useContext(RuntimeIdContext);

export type AuditMutation = (
  investigation: Investigation,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  summary: string,
  before?: unknown,
  after?: unknown,
) => Investigation;

export function useAuditMutation(): AuditMutation {
  const idFactory = useRuntimeId();
  return useCallback(
    (investigation, actorId, action, entityType, entityId, summary, before, after) =>
      domainAuditMutation(
        investigation,
        actorId,
        action,
        entityType,
        entityId,
        summary,
        before,
        after,
        idFactory,
      ),
    [idFactory],
  );
}
