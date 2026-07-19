import {
  sdk,
  type MiniAppHttpRequestInput,
  type MiniAppHttpResponse,
} from '@theaiplatform/miniapp-sdk/sdk';
import type {
  ResearchRecordInput,
  ResearchSource,
  ResearchSourceCursorInput,
} from './domain';

type HttpRequester = (
  input: MiniAppHttpRequestInput,
) => MiniAppHttpResponse | Promise<MiniAppHttpResponse>;

export interface OfficialResearchRefresh {
  readonly refreshedAt: string;
  readonly records: readonly ResearchRecordInput[];
  readonly sources: readonly ResearchSourceCursorInput[];
}

const row = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const rows = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.map(row).filter((entry): entry is Record<string, unknown> => !!entry)
    : [];
const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';
const texts = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(text).filter(Boolean) : [];
const nested = (
  value: unknown,
  ...path: readonly string[]
): unknown => path.reduce<unknown>((current, key) => row(current)?.[key], value);

async function requestJson(
  request: HttpRequester,
  input: MiniAppHttpRequestInput,
  allowNotFound = false,
): Promise<unknown> {
  const response = await request({
    ...input,
    headers: [{ name: 'Accept', value: 'application/json' }],
    timeoutMs: 30_000,
    responseBodyLimitBytes: 2 * 1024 * 1024,
    followRedirects: false,
  });
  if (allowNotFound && response.status === 404) return {};
  if (response.status < 200 || response.status >= 300)
    throw new Error(
      `${new URL(input.url).hostname} returned HTTP ${response.status}.`,
    );
  if (response.bodyKind !== 'text' || !response.bodyText)
    throw new Error(`${new URL(input.url).hostname} returned no JSON body.`);
  try {
    return JSON.parse(response.bodyText) as unknown;
  } catch {
    throw new Error(`${new URL(input.url).hostname} returned invalid JSON.`);
  }
}

async function fetchPubMed(
  request: HttpRequester,
  query: string,
): Promise<{ records: ResearchRecordInput[]; cursor: string }> {
  const search = await requestJson(request, {
    method: 'GET',
    url: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi',
    query: [
      { name: 'db', value: 'pubmed' },
      { name: 'term', value: query },
      { name: 'retmode', value: 'json' },
      { name: 'retmax', value: '8' },
      { name: 'sort', value: 'pub date' },
    ],
  });
  const ids = texts(nested(search, 'esearchresult', 'idlist'));
  if (!ids.length) return { records: [], cursor: '' };
  const summary = await requestJson(request, {
    method: 'GET',
    url: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi',
    query: [
      { name: 'db', value: 'pubmed' },
      { name: 'id', value: ids.join(',') },
      { name: 'retmode', value: 'json' },
    ],
  });
  const result = row(nested(summary, 'result'));
  const records = ids.flatMap<ResearchRecordInput>(sourceRecordId => {
    const article = row(result?.[sourceRecordId]);
    if (!article) return [];
    const title = text(article.title);
    if (!title) return [];
    const authors = rows(article.authors)
      .map(author => text(author.name))
      .filter(Boolean)
      .slice(0, 6)
      .join(', ');
    return [
      {
        source: 'pubmed',
        sourceRecordId,
        evidenceType: 'literature',
        title,
        summary: [authors, text(article.fulljournalname)]
          .filter(Boolean)
          .join(' · '),
        url: `https://pubmed.ncbi.nlm.nih.gov/${sourceRecordId}/`,
        publishedAt: text(article.pubdate),
      },
    ];
  });
  return { records, cursor: ids[0] ?? '' };
}

async function fetchClinicalTrials(
  request: HttpRequester,
  query: string,
): Promise<{ records: ResearchRecordInput[]; cursor: string }> {
  const payload = await requestJson(request, {
    method: 'GET',
    url: 'https://clinicaltrials.gov/api/v2/studies',
    query: [
      { name: 'query.term', value: query },
      { name: 'pageSize', value: '8' },
      { name: 'format', value: 'json' },
    ],
  });
  const records = rows(row(payload)?.studies).flatMap<ResearchRecordInput>(
    study => {
      const sourceRecordId = text(
        nested(study, 'protocolSection', 'identificationModule', 'nctId'),
      );
      const title = text(
        nested(study, 'protocolSection', 'identificationModule', 'briefTitle'),
      );
      if (!sourceRecordId || !title) return [];
      return [
        {
          source: 'clinical-trials',
          sourceRecordId,
          evidenceType: 'registered-trial',
          title,
          summary: text(
            nested(
              study,
              'protocolSection',
              'descriptionModule',
              'briefSummary',
            ),
          ),
          url: `https://clinicaltrials.gov/study/${sourceRecordId}`,
          publishedAt: text(
            nested(
              study,
              'protocolSection',
              'statusModule',
              'studyFirstPostDateStruct',
              'date',
            ),
          ),
        },
      ];
    },
  );
  return {
    records,
    cursor:
      text(row(payload)?.nextPageToken) || records[0]?.sourceRecordId || '',
  };
}

async function fetchOpenFda(
  request: HttpRequester,
  query: string,
): Promise<{ records: ResearchRecordInput[]; cursor: string }> {
  const escapedQuery = query.replaceAll('"', '\\"');
  const payload = await requestJson(
    request,
    {
      method: 'GET',
      url: 'https://api.fda.gov/drug/label.json',
      query: [
        {
          name: 'search',
          value: `openfda.generic_name:"${escapedQuery}"`,
        },
        { name: 'limit', value: '8' },
      ],
    },
    true,
  );
  const records = rows(row(payload)?.results).flatMap<ResearchRecordInput>(
    label => {
      const openfda = row(label.openfda);
      const sourceRecordId =
        text(label.id) ||
        texts(openfda?.set_id)[0] ||
        texts(openfda?.application_number)[0] ||
        '';
      const names = [
        ...texts(openfda?.brand_name),
        ...texts(openfda?.generic_name),
      ];
      const title = names.length
        ? `FDA label: ${[...new Set(names)].slice(0, 3).join(' / ')}`
        : 'FDA drug label';
      if (!sourceRecordId) return [];
      return [
        {
          source: 'openfda',
          sourceRecordId,
          evidenceType: 'regulatory',
          title,
          summary: [
            ...texts(label.indications_and_usage),
            ...texts(label.warnings),
          ]
            .slice(0, 2)
            .join('\n\n'),
          url: `https://api.fda.gov/drug/label.json?search=id:${encodeURIComponent(sourceRecordId)}`,
          publishedAt: text(label.effective_time),
        },
      ];
    },
  );
  return {
    records,
    cursor:
      text(nested(payload, 'meta', 'last_updated')) ||
      records[0]?.sourceRecordId ||
      '',
  };
}

export async function refreshOfficialResearchSourcesWith(
  request: HttpRequester,
  query: string,
  refreshedAt = new Date().toISOString(),
): Promise<OfficialResearchRefresh> {
  const normalizedQuery = query.trim().slice(0, 240);
  if (!normalizedQuery) throw new Error('Choose a tracked item to refresh.');
  const adapters: readonly [
    ResearchSource,
    (
      requester: HttpRequester,
      sourceQuery: string,
    ) => Promise<{ records: ResearchRecordInput[]; cursor: string }>,
  ][] = [
    ['pubmed', fetchPubMed],
    ['clinical-trials', fetchClinicalTrials],
    ['openfda', fetchOpenFda],
  ];
  const records: ResearchRecordInput[] = [];
  const sources: ResearchSourceCursorInput[] = [];
  for (const [source, adapter] of adapters) {
    try {
      const result = await adapter(request, normalizedQuery);
      records.push(...result.records);
      sources.push({
        source,
        cursor: result.cursor,
        success: true,
        recordCount: result.records.length,
        error: '',
      });
    } catch (cause) {
      sources.push({
        source,
        cursor: '',
        success: false,
        recordCount: 0,
        error: cause instanceof Error ? cause.message : 'Source refresh failed.',
      });
    }
  }
  if (!sources.some(source => source.success))
    throw new Error(
      `Every official source refresh failed: ${sources.map(source => source.error).join(' ')}`,
    );
  return { refreshedAt, records, sources };
}

export async function refreshOfficialResearchSources(
  query: string,
): Promise<OfficialResearchRefresh> {
  if (sdk.hasHostHttpRequest !== true || !sdk.http)
    throw new Error(
      'This TAP host does not provide consented host-mediated HTTP.',
    );
  return refreshOfficialResearchSourcesWith(
    input => sdk.http!.request(input),
    query,
  );
}
