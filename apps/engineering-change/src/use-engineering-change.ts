import { useCallback, useEffect, useState } from "react";
import type { TapFederatedSurfaceMountContext } from "@theaiplatform/miniapp-sdk/surface";
import {
  emptyState,
  type EngineeringChange,
  type EngineeringChangeState,
} from "./domain";
import { loadState, saveState, StorageConflictError } from "./storage";

export interface EngineeringChangeController {
  state: EngineeringChangeState;
  active?: EngineeringChange;
  loading: boolean;
  saving: boolean;
  notice?: string;
  error?: string;
  save(next: EngineeringChangeState, notice: string): Promise<boolean>;
  updateChange(next: EngineeringChange, notice: string): Promise<boolean>;
  selectChange(id: string | null): void;
  selectedId: string | null;
  reload(): Promise<void>;
  clearMessage(): void;
}

export function useEngineeringChange(
  preview: boolean,
  _surfaceContext?: TapFederatedSurfaceMountContext,
): EngineeringChangeController {
  const [state, setState] = useState<EngineeringChangeState>(emptyState);
  const [revision, setRevision] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  const reload = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const loaded = await loadState(preview);
      setState(loaded.state);
      setRevision(loaded.revision);
    } catch (reason) {
      setError(`Engineering Change could not load this workspace. ${String(reason)}`);
    } finally {
      setLoading(false);
    }
  }, [preview]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(
    async (next: EngineeringChangeState, message: string): Promise<boolean> => {
      setSaving(true);
      setError(undefined);
      try {
        const nextRevision = await saveState(next, revision, preview);
        setState(next);
        setRevision(nextRevision);
        setNotice(message);
        return true;
      } catch (reason) {
        if (reason instanceof StorageConflictError) {
          setError(reason.message);
        } else {
          setError(`The change ledger could not be saved. ${String(reason)}`);
        }
        return false;
      } finally {
        setSaving(false);
      }
    },
    [preview, revision],
  );

  const updateChange = useCallback(
    async (next: EngineeringChange, message: string): Promise<boolean> => {
      const nextState = {
        ...state,
        changes: state.changes.map((change) => (change.id === next.id ? next : change)),
      };
      return save(nextState, message);
    },
    [save, state],
  );

  const active = state.changes.find((change) => change.id === selectedId);

  return {
    state,
    active,
    loading,
    saving,
    notice,
    error,
    save,
    updateChange,
    selectChange: setSelectedId,
    selectedId,
    reload,
    clearMessage: () => {
      setNotice(undefined);
      setError(undefined);
    },
  };
}
