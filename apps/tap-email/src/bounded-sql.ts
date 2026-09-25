import type { MiniAppPrivateSqlTransaction, MiniAppSqlValue } from '@theaiplatform/miniapp-sdk/sdk';

// Includes JSON escaping, SQL and a generous allowance for the host envelope.
// Well below the 24 MiB request and 16 MiB SQLite row limits.
export const maximumSqlRequestBytes = 512 * 1024;
export const maximumRecordPartBytes = 64 * 1024;
export const sqlEnvelopeBytes = 4096;
const encoder = new TextEncoder();
export const serializedBytes = (value: unknown): number => encoder.encode(JSON.stringify(value)).byteLength;

export async function insertBoundedRows(
  tx: MiniAppPrivateSqlTransaction,
  table: string,
  columns: readonly string[],
  rows: Iterable<readonly MiniAppSqlValue[]>,
): Promise<void> {
  const prefix = `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES `;
  const placeholder = `(${columns.map(() => '?').join(', ')})`;
  let batch: MiniAppSqlValue[][] = [];
  let bytes = serializedBytes({ sql: prefix, params: [] }) + sqlEnvelopeBytes;
  const flush = async () => {
    if (!batch.length) return;
    await tx.execute(prefix + batch.map(() => placeholder).join(', '), batch.flat());
    batch = [];
    bytes = serializedBytes({ sql: prefix, params: [] }) + sqlEnvelopeBytes;
  };
  for (const row of rows) {
    if (row.length !== columns.length) throw new Error(`Invalid row for ${table}.`);
    const rowBytes = serializedBytes(row) + placeholder.length + 4;
    if (rowBytes + prefix.length + sqlEnvelopeBytes > maximumSqlRequestBytes) {
      throw new Error(`A ${table} row exceeds the bounded storage request size.`);
    }
    if (bytes + rowBytes > maximumSqlRequestBytes || (batch.length + 1) * columns.length > 900) await flush();
    batch.push([...row]);
    bytes += rowBytes;
  }
  await flush();
}

/** Split the JSON text by its *transport-serialized* UTF-8 bytes, without cutting a surrogate pair. */
export function* recordParts(value: unknown): Generator<string> {
  const json = JSON.stringify(value);
  // Six bytes per UTF-16 code unit covers JSON escaping, including lone surrogates.
  // Refine to the actual byte boundary so ASCII and non-ASCII use the same budget.
  let start = 0;
  while (start < json.length) {
    let low = start + 1;
    let high = Math.min(json.length, start + maximumRecordPartBytes);
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (serializedBytes(json.slice(start, middle)) <= maximumRecordPartBytes) low = middle;
      else high = middle - 1;
    }
    let end = low;
    if (end < json.length && /[\uD800-\uDBFF]/u.test(json[end - 1]!)) end -= 1;
    yield json.slice(start, end);
    start = end;
  }
}
