/** @rstest-environment jsdom */

import { describe, expect, it } from '@rstest/core';
import {
  bridgeRichMessageKeyboardScroll,
  bridgeRichMessageWheel,
} from './iframe-scroll';

function setDimension(element: Element, property: 'clientHeight' | 'scrollHeight', value: number) {
  Object.defineProperty(element, property, { configurable: true, value });
}

describe('rich-message iframe wheel bridge', () => {
  it('scrolls the reader when the auto-height frame has no remaining range', () => {
    const reader = document.createElement('div');
    const frame = document.createElement('iframe');
    reader.append(frame);
    document.body.append(reader);
    setDimension(reader, 'clientHeight', 400);
    setDimension(reader, 'scrollHeight', 1_600);
    const frameScroller = frame.contentDocument!.documentElement;
    setDimension(frameScroller, 'clientHeight', 900);
    setDimension(frameScroller, 'scrollHeight', 900);

    const stop = bridgeRichMessageWheel(frame, reader);
    const wheel = new WheelEvent('wheel', { cancelable: true, deltaY: 240 });

    expect(frame.contentDocument!.dispatchEvent(wheel)).toBe(false);
    expect(reader.scrollTop).toBe(240);

    stop();
    frame.contentDocument!.dispatchEvent(new WheelEvent('wheel', { deltaY: 240 }));
    expect(reader.scrollTop).toBe(240);
    reader.remove();
  });

  it('preserves native scrolling while an internally capped frame can move', () => {
    const reader = document.createElement('div');
    const frame = document.createElement('iframe');
    reader.append(frame);
    document.body.append(reader);
    setDimension(reader, 'clientHeight', 400);
    setDimension(reader, 'scrollHeight', 1_600);
    const frameScroller = frame.contentDocument!.documentElement;
    setDimension(frameScroller, 'clientHeight', 500);
    setDimension(frameScroller, 'scrollHeight', 1_200);

    const stop = bridgeRichMessageWheel(frame, reader);
    const wheel = new WheelEvent('wheel', { cancelable: true, deltaY: 120 });

    expect(frame.contentDocument!.dispatchEvent(wheel)).toBe(true);
    expect(reader.scrollTop).toBe(0);

    stop();
    reader.remove();
  });

  it('hands scrolling back to the reader at the inner frame boundary', () => {
    const reader = document.createElement('div');
    const frame = document.createElement('iframe');
    reader.append(frame);
    document.body.append(reader);
    setDimension(reader, 'clientHeight', 400);
    setDimension(reader, 'scrollHeight', 1_600);
    const frameScroller = frame.contentDocument!.documentElement;
    setDimension(frameScroller, 'clientHeight', 500);
    setDimension(frameScroller, 'scrollHeight', 1_200);
    frameScroller.scrollTop = 700;

    const stop = bridgeRichMessageWheel(frame, reader);
    frame.contentDocument!.dispatchEvent(new WheelEvent('wheel', {
      cancelable: true,
      deltaMode: WheelEvent.DOM_DELTA_LINE,
      deltaY: 3,
    }));

    expect(reader.scrollTop).toBe(48);

    frameScroller.scrollTop = 0;
    frame.contentDocument!.dispatchEvent(new WheelEvent('wheel', {
      cancelable: true,
      deltaMode: WheelEvent.DOM_DELTA_LINE,
      deltaY: -3,
    }));
    expect(reader.scrollTop).toBe(0);

    stop();
    reader.remove();
  });

  it('preserves a sender-authored nested scrollport until it reaches its boundary', () => {
    const reader = document.createElement('div');
    const frame = document.createElement('iframe');
    reader.append(frame);
    document.body.append(reader);
    setDimension(reader, 'clientHeight', 400);
    setDimension(reader, 'scrollHeight', 1_600);

    const nestedScroller = frame.contentDocument!.createElement('div');
    nestedScroller.style.overflowY = 'auto';
    const nestedContent = frame.contentDocument!.createElement('span');
    nestedScroller.append(nestedContent);
    frame.contentDocument!.body.append(nestedScroller);
    setDimension(nestedScroller, 'clientHeight', 200);
    setDimension(nestedScroller, 'scrollHeight', 800);
    nestedScroller.scrollTop = 100;
    const frameWindow = frame.contentWindow as Window & typeof globalThis;

    const stop = bridgeRichMessageWheel(frame, reader);
    const inside = new frameWindow.WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 120,
    });
    expect(nestedContent.dispatchEvent(inside)).toBe(true);
    expect(reader.scrollTop).toBe(0);

    nestedScroller.scrollTop = 600;
    const boundary = new frameWindow.WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 120,
    });
    expect(nestedContent.dispatchEvent(boundary)).toBe(false);
    expect(reader.scrollTop).toBe(120);

    stop();
    reader.remove();
  });

  it('does not consume zoom gestures or movement past the reader boundary', () => {
    const reader = document.createElement('div');
    const frame = document.createElement('iframe');
    reader.append(frame);
    document.body.append(reader);
    setDimension(reader, 'clientHeight', 400);
    setDimension(reader, 'scrollHeight', 1_600);
    reader.scrollTop = 1_200;

    const stop = bridgeRichMessageWheel(frame, reader);
    const zoom = new WheelEvent('wheel', { cancelable: true, ctrlKey: true, deltaY: 100 });
    const pastEnd = new WheelEvent('wheel', { cancelable: true, deltaY: 100 });

    expect(frame.contentDocument!.dispatchEvent(zoom)).toBe(true);
    expect(frame.contentDocument!.dispatchEvent(pastEnd)).toBe(true);
    expect(reader.scrollTop).toBe(1_200);

    stop();
    reader.remove();
  });
});

describe('rich-message iframe keyboard scroll bridge', () => {
  it('continues standard scroll keys in the reader when the frame cannot move', () => {
    const reader = document.createElement('div');
    const frame = document.createElement('iframe');
    reader.append(frame);
    document.body.append(reader);
    setDimension(reader, 'clientHeight', 400);
    setDimension(reader, 'scrollHeight', 1_600);

    const stop = bridgeRichMessageKeyboardScroll(frame, reader);
    const pageDown = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'PageDown',
    });
    expect(frame.contentDocument!.body.dispatchEvent(pageDown)).toBe(false);
    expect(reader.scrollTop).toBe(400);

    frame.contentDocument!.body.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: ' ',
    }));
    expect(reader.scrollTop).toBe(800);

    frame.contentDocument!.body.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: ' ',
      shiftKey: true,
    }));
    expect(reader.scrollTop).toBe(400);

    frame.contentDocument!.body.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'End',
    }));
    expect(reader.scrollTop).toBe(1_200);

    stop();
    reader.remove();
  });

  it('does not steal app shortcuts, modified arrows, or summary activation', () => {
    const reader = document.createElement('div');
    const frame = document.createElement('iframe');
    reader.append(frame);
    document.body.append(reader);
    setDimension(reader, 'clientHeight', 400);
    setDimension(reader, 'scrollHeight', 1_600);
    const summary = frame.contentDocument!.createElement('summary');
    frame.contentDocument!.body.append(summary);

    const stop = bridgeRichMessageKeyboardScroll(frame, reader);
    for (const event of [
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'H' }),
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowDown', metaKey: true }),
    ]) {
      expect(frame.contentDocument!.body.dispatchEvent(event)).toBe(true);
    }
    expect(summary.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: ' ',
    }))).toBe(true);
    expect(reader.scrollTop).toBe(0);

    stop();
    reader.remove();
  });

  it('lets the existing shortcut listener win before applying native scroll keys', () => {
    const reader = document.createElement('div');
    const frame = document.createElement('iframe');
    reader.append(frame);
    document.body.append(reader);
    setDimension(reader, 'clientHeight', 400);
    setDimension(reader, 'scrollHeight', 1_600);
    const preventShortcut = (event: KeyboardEvent) => event.preventDefault();
    frame.contentDocument!.addEventListener('keydown', preventShortcut);
    const stop = bridgeRichMessageKeyboardScroll(frame, reader);

    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'PageDown',
    });
    expect(frame.contentDocument!.body.dispatchEvent(event)).toBe(false);
    expect(reader.scrollTop).toBe(0);

    stop();
    frame.contentDocument!.removeEventListener('keydown', preventShortcut);
    reader.remove();
  });
});
