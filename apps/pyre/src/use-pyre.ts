import { useCallback, useEffect, useMemo, useState } from "react";
import type { TapFederatedSurfaceMountContext } from "@theaiplatform/miniapp-sdk/surface";
import { emptyState, type Actor, type Investigation, type PyreState } from "./domain";
import { bootstrapPlatform, previewActor, subscribePresence, type PlatformContext, type PlatformStatus } from "./platform";
import { loadState, saveState, StorageConflictError } from "./storage";

export interface PyreController {
  state: PyreState;
  active?: Investigation;
  actor: Actor;
  platform: PlatformStatus;
  context: PlatformContext;
  loading: boolean;
  saving: boolean;
  notice?: string;
  error?: string;
  save(next: PyreState, notice: string): Promise<boolean>;
  updateIncident(next: Investigation, notice: string): Promise<boolean>;
  selectIncident(id: string): Promise<void>;
  reload(): Promise<void>;
  clearMessage(): void;
  setPreviewActor(actor: Actor): void;
}

export function usePyre(preview: boolean, surfaceContext?: TapFederatedSurfaceMountContext): PyreController {
  const context = useMemo<PlatformContext>(() => ({
    preview,
    workspaceId: surfaceContext?.workspaceId,
    channelId: surfaceContext?.channelId,
    conversationId: surfaceContext?.conversationId,
    events: surfaceContext?.events,
  }), [preview, surfaceContext]);
  const [state, setState] = useState<PyreState>(emptyState);
  const [revision, setRevision] = useState<number | null>(null);
  const [actor, setActor] = useState<Actor>(previewActor);
  const [platform, setPlatform] = useState<PlatformStatus>({ actor: previewActor, connected: false, presenceCount: 1, workflows: [], httpAvailable: false, credentials: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  const reload = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [loaded, status] = await Promise.all([loadState(preview), bootstrapPlatform(context)]);
      setState(loaded.state);
      setRevision(loaded.revision);
      setPlatform(status);
      setActor(status.actor);
      if (status.error) setError(`TAP platform connection is limited: ${status.error}`);
    } catch (reason) {
      setError(`Pyre could not load this workspace. ${String(reason)}`);
    } finally {
      setLoading(false);
    }
  }, [context, preview]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => subscribePresence(context, (presenceCount) => setPlatform((current) => ({ ...current, presenceCount }))), [context]);

  const save = useCallback(async (next: PyreState, message: string): Promise<boolean> => {
    setSaving(true);
    setError(undefined);
    try {
      const nextRevision = await saveState(next, revision, preview);
      setState(next);
      setRevision(nextRevision);
      setNotice(message);
      return true;
    } catch (reason) {
      setError(reason instanceof StorageConflictError ? reason.message : `Pyre could not save. ${String(reason)}`);
      return false;
    } finally {
      setSaving(false);
    }
  }, [preview, revision]);

  const updateIncident = useCallback(async (next: Investigation, message: string): Promise<boolean> => {
    return save({ ...state, investigations: state.investigations.map((item) => item.id === next.id ? next : item) }, message);
  }, [save, state]);

  const selectIncident = useCallback(async (id: string) => {
    await save({ ...state, activeId: id }, "Investigation opened.");
  }, [save, state]);

  return {
    state,
    active: state.investigations.find((investigation) => investigation.id === state.activeId),
    actor,
    platform,
    context,
    loading,
    saving,
    notice,
    error,
    save,
    updateIncident,
    selectIncident,
    reload,
    clearMessage: () => { setNotice(undefined); setError(undefined); },
    setPreviewActor: (next) => {
      if (!preview) return;
      setActor(next);
      setPlatform((current) => ({ ...current, actor: next }));
    },
  };
}
