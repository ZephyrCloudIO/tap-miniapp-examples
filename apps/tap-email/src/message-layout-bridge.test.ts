/** @rstest-environment jsdom */
import { describe, expect, it } from '@rstest/core';
import { buildRichMessageDocument } from './rich-message';
import { withMessageLayoutBridge } from './message-layout-bridge';

describe('opaque message layout bridge', () => {
  it('permits only the trusted observer when sender scripts are disabled', () => {
    const source = buildRichMessageDocument('<p onclick="alert(1)">Email</p><script>alert(2)</script>', { }, { scriptsEnabled: false });
    const result = new DOMParser().parseFromString(withMessageLayoutBridge(source, 'observer-nonce'), 'text/html');
    expect(result.querySelectorAll('script')).toHaveLength(1);
    expect(result.querySelector('script')?.getAttribute('nonce')).toBe('observer-nonce');
    expect(result.querySelector('script')?.textContent).toContain('ResizeObserver');
    expect(result.querySelector('p')?.hasAttribute('onclick')).toBe(false);
    const policy = result.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content');
    expect(policy).toContain("script-src 'nonce-observer-nonce'");
    expect(policy).not.toContain("script-src 'unsafe-inline'");
    expect(policy).toContain("connect-src 'none'");
  });

  it('keeps enabled sender scripts inside the isolated document', () => {
    const source = buildRichMessageDocument('<script>window.example = 1</script><p>Email</p>', {}, { scriptsEnabled: true });
    const result = new DOMParser().parseFromString(withMessageLayoutBridge(source, 'observer-nonce'), 'text/html');
    expect(result.querySelectorAll('script')).toHaveLength(2);
    expect(result.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toContain("script-src 'unsafe-inline'");
  });
});
