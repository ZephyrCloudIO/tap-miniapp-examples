/** @rstest-environment jsdom */
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, describe, expect, it } from '@rstest/core';

const style = document.createElement('style');
style.textContent = readFileSync('src/styles.css', 'utf8');
document.head.append(style);
const root = document.documentElement;
afterAll(() => style.remove());

afterEach(() => {
  root.removeAttribute('data-theme');
  root.removeAttribute('class');
});

describe('Email colors follow the SDK root theme selectors', () => {
  it('uses dark reader and toolbar colors in an MCP document with only data-theme', () => {
    root.dataset.theme = 'dark';
    const colors = getComputedStyle(root);
    expect(colors.getPropertyValue('--mail-copy').trim()).toBe('#d6d3cc');
    expect(colors.getPropertyValue('--mail-glass').trim().replace(/\s*\/\s*/g, '/')).toBe('rgb(23 24 23/.93)');
    expect(colors.colorScheme).toBe('dark');
  });

  it('returns reader, toolbar and browser controls to light when the host changes theme', () => {
    root.dataset.theme = 'dark';
    // Prime style calculation before the change to detect stale appearance.
    expect(getComputedStyle(root).colorScheme).toBe('dark');
    root.dataset.theme = 'light';
    const colors = getComputedStyle(root);
    expect(colors.getPropertyValue('--mail-copy').trim()).toBe('#373832');
    expect(colors.getPropertyValue('--mail-glass').trim().replace(/\s*\/\s*/g, '/')).toBe('rgb(255 255 255/.92)');
    expect(colors.colorScheme).toBe('light');
  });

  it('retains dark colors for the SDK class selector used by TAP frames', () => {
    root.classList.add('dark');
    const colors = getComputedStyle(root);
    expect(colors.getPropertyValue('--mail-copy').trim()).toBe('#d6d3cc');
    expect(colors.getPropertyValue('--mail-glass').trim().replace(/\s*\/\s*/g, '/')).toBe('rgb(23 24 23/.93)');
    expect(colors.colorScheme).toBe('dark');
  });
});
