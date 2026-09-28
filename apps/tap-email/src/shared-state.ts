import { equal, isDocument, type Document } from '@tap-examples/tap-shared-state';
import { defaultPreferences, isMailPreferences, normalizeMailPreferences,
  type MailState, type ThreadAttentionCorrectionRecord } from './domain';

export const correctionKey = (accountId: string, threadId: string) => JSON.stringify([accountId, threadId]);
function correction(value: unknown): value is ThreadAttentionCorrectionRecord {
  if (!isDocument(value) || Object.keys(value).some(key => !['critical', 'responseState', 'correctedAt'].includes(key))) return false;
  return typeof value.correctedAt === 'string' && Number.isFinite(Date.parse(value.correctedAt)) &&
    (value.critical === undefined || typeof value.critical === 'boolean') &&
    (value.responseState === undefined || ['needs-response', 'none', 'waiting'].includes(String(value.responseState)));
}
export function validEmailDocument(value: unknown): value is Document {
  return isDocument(value) && Object.keys(value).every(key => ['preferences', 'corrections'].includes(key)) &&
    (value.preferences === undefined || isMailPreferences(value.preferences)) &&
    (value.corrections === undefined || (isDocument(value.corrections) && Object.entries(value.corrections).every(([key, item]) => {
      try { const ids: unknown = JSON.parse(key); return Array.isArray(ids) && ids.length === 2 && ids.every(id => typeof id === 'string' && id.length > 0 && id.length <= 512) && correction(item); } catch { return false; }
    })));
}
export function emailMigration(state: MailState): Document {
  const corrections = Object.fromEntries(state.threads.filter(thread => thread.attentionCorrection)
    .map(thread => [correctionKey(thread.accountId, thread.threadId), thread.attentionCorrection]));
  return JSON.parse(JSON.stringify({
    ...(!equal(state.preferences, defaultPreferences) ? { preferences: state.preferences } : {}),
    ...(Object.keys(corrections).length ? { corrections } : {}),
  }));
}
export function applyEmailDocument(state: MailState, value: Document): MailState {
  if (!validEmailDocument(value)) throw new Error('Shared Email settings are invalid.');
  const preferences = isMailPreferences(value.preferences) ? normalizeMailPreferences(value.preferences) : defaultPreferences;
  const corrections = isDocument(value.corrections) ? value.corrections : {};
  const threads = state.threads.map(thread => {
    const shared = corrections[correctionKey(thread.accountId, thread.threadId)];
    if (correction(shared)) return equal(shared, thread.attentionCorrection) ? thread : { ...thread, attentionCorrection: shared };
    if (!thread.attentionCorrection) return thread;
    const { attentionCorrection: _discarded, ...providerThread } = thread;
    return providerThread;
  });
  return equal(preferences, state.preferences) && threads.every((thread, i) => thread === state.threads[i])
    ? state : { ...state, preferences, threads };
}
