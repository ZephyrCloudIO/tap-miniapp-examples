import { describe, expect, it } from '@rstest/core';
import type {
  MiniAppHttpRequestInput,
  MiniAppHttpResponse,
} from '@theaiplatform/miniapp-sdk/sdk';
import { refreshOfficialResearchSourcesWith } from './research-sources';

const response = (body: unknown, status = 200): MiniAppHttpResponse => ({
  finalUrl: 'https://example.test',
  status,
  statusText: status === 200 ? 'OK' : 'Not Found',
  headers: [],
  bodyText: JSON.stringify(body),
  bodyBase64: null,
  bodyKind: 'text',
  bodyTruncated: false,
  sizeBytes: 1,
  elapsedMs: 1,
  contentType: 'application/json',
});

describe('official research source refresh', () => {
  it('normalizes PubMed, ClinicalTrials.gov, and openFDA records', async () => {
    const request = async (
      input: MiniAppHttpRequestInput,
    ): Promise<MiniAppHttpResponse> => {
      if (input.url.endsWith('/esearch.fcgi'))
        return response({ esearchresult: { idlist: ['123'] } });
      if (input.url.endsWith('/esummary.fcgi'))
        return response({
          result: {
            '123': {
              title: 'Runtime PubMed article',
              pubdate: '2026',
              fulljournalname: 'Runtime Journal',
              authors: [{ name: 'Runtime Author' }],
            },
          },
        });
      if (input.url.includes('clinicaltrials.gov'))
        return response({
          studies: [
            {
              protocolSection: {
                identificationModule: {
                  nctId: 'NCT00000001',
                  briefTitle: 'Runtime clinical trial',
                },
                descriptionModule: { briefSummary: 'Runtime trial summary' },
                statusModule: {
                  studyFirstPostDateStruct: { date: '2026-01-01' },
                },
              },
            },
          ],
          nextPageToken: 'next-runtime-page',
        });
      return response({
        meta: { last_updated: '2026-07-18' },
        results: [
          {
            id: 'fda-runtime-label',
            effective_time: '20260718',
            openfda: { generic_name: ['Runtime item'] },
            indications_and_usage: ['Runtime indication'],
          },
        ],
      });
    };

    const result = await refreshOfficialResearchSourcesWith(
      request,
      'Runtime item',
      '2026-07-18T12:00:00Z',
    );
    expect(result.records.map(record => record.source)).toEqual([
      'pubmed',
      'clinical-trials',
      'openfda',
    ]);
    expect(result.sources.every(source => source.success)).toBe(true);
    expect(result.records[0]?.url).toBe(
      'https://pubmed.ncbi.nlm.nih.gov/123/',
    );
  });

  it('persists source-specific failure receipts when another source succeeds', async () => {
    const request = async (
      input: MiniAppHttpRequestInput,
    ): Promise<MiniAppHttpResponse> => {
      if (input.url.includes('ncbi.nlm.nih.gov')) throw new Error('NCBI down');
      if (input.url.includes('clinicaltrials.gov'))
        return response({ studies: [] });
      return response({}, 404);
    };
    const result = await refreshOfficialResearchSourcesWith(
      request,
      'Runtime item',
      '2026-07-18T12:00:00Z',
    );
    expect(result.sources[0]).toMatchObject({
      source: 'pubmed',
      success: false,
      error: 'NCBI down',
    });
    expect(result.sources.slice(1).every(source => source.success)).toBe(true);
  });
});
