import { createContext, useContext, useMemo, type ReactNode } from "react";
import { runtimeId as createRuntimeId, type RuntimeIdFactory } from "./domain";

const RuntimeIdContext = createContext<RuntimeIdFactory>(createRuntimeId);

export function EngineeringChangeRuntimeIdProvider({
  children,
  randomUUID,
}: {
  children: ReactNode;
  randomUUID: () => string;
}) {
  const idFactory = useMemo<RuntimeIdFactory>(
    () => (prefix) => `${prefix}_${randomUUID()}`,
    [randomUUID],
  );
  return (
    <RuntimeIdContext.Provider value={idFactory}>{children}</RuntimeIdContext.Provider>
  );
}

export const useRuntimeId = (): RuntimeIdFactory => useContext(RuntimeIdContext);
