import { isDocument, type Document } from './index';

// Structural subset of the generated D1 binding, also usable by SQL test drivers.
interface Database {
  prepare(sql: string): {
    bind(...values: (string | number | null)[]): {
      first<T>(): Promise<T | null>;
    };
  };
}
const limit = 1_048_576;
export async function sharedStateResponse(request: Request, db: Database, owner: string,
  validate: (value: Document) => boolean): Promise<Response> {
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  const fail = (status: number, code: string, message: string) => reply({ error: code, message }, status);
  if (request.method === 'GET') {
    const row = await db.prepare('SELECT revision, value_json FROM miniapp_shared_state WHERE owner = ?')
      .bind(owner).first<{ revision: number; value_json: string }>();
    return reply(row ? { revision: row.revision, value: JSON.parse(row.value_json) } : { revision: null, value: {} });
  }
  if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Use GET or POST.');
  const reader = request.body?.getReader();
  if (!reader) return fail(400, 'invalid_state', 'A settings document is required.');
  let text = ''; let bytes = 0; const decoder = new TextDecoder();
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > limit) { await reader.cancel(); return fail(413, 'state_too_large', 'Settings exceed the storage limit.'); }
    text += decoder.decode(chunk.value, { stream: true });
  }
  let body: unknown;
  try { body = JSON.parse(text + decoder.decode()); } catch { return fail(400, 'invalid_state', 'Invalid settings JSON.'); }
  if (!isDocument(body) || !isDocument(body.value) || !validate(body.value) ||
    !(body.revision === null || (typeof body.revision === 'number' && Number.isSafeInteger(body.revision) && body.revision > 0))) {
    return fail(400, 'invalid_state', 'Invalid settings document or revision.');
  }
  const encoded = JSON.stringify(body.value);
  const row = body.revision === null
    ? await db.prepare('INSERT INTO miniapp_shared_state(owner, revision, value_json) VALUES(?, 1, ?) ON CONFLICT(owner) DO NOTHING RETURNING revision')
      .bind(owner, encoded).first<{ revision: number }>()
    : await db.prepare('UPDATE miniapp_shared_state SET revision = revision + 1, value_json = ? WHERE owner = ? AND revision = ? RETURNING revision')
      .bind(encoded, owner, body.revision).first<{ revision: number }>();
  return row ? reply({ revision: row.revision, value: body.value })
    : fail(409, 'state_conflict', 'Settings changed on another device. Refresh and merge before retrying.');
}
