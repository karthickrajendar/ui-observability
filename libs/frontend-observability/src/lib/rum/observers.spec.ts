import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  describeSafeTarget,
  getBrowserContextAttributes,
  installRumObservers,
  resetRumObserversForTesting,
} from './observers';

describe('rum observers and browser context', () => {
  beforeEach(() => {
    resetRumObserversForTesting();
  });

  it('returns low-cardinality browser context attributes', () => {
    const attrs = getBrowserContextAttributes();
    expect(attrs['online']).toBeDefined();
    expect(attrs['visibility_state']).toBeDefined();
  });

  it('describes DOM targets safely without leaking textContent', () => {
    const fakeTarget = {
      tagName: 'BUTTON',
      getAttribute: (name: string) => (name === 'data-otel-action' ? 'submit-payment' : null),
    } as unknown as EventTarget;
    expect(describeSafeTarget(fakeTarget)).toBe('button[data-otel-action="submit-payment"]');
  });

  it('detects rage clicks when 3 clicks occur rapidly in the same area', () => {
    const onLongTask = vi.fn();
    const onRageClick = vi.fn();
    installRumObservers({ onLongTask, onRageClick });

    render(createElement('button', { 'data-otel-action': 'place-order' }, 'Place order'));
    const btn = screen.getByText('Place order');

    for (let i = 0; i < 3; i += 1) {
      fireEvent.click(btn, { clientX: 100 + i, clientY: 100 + i });
    }

    expect(onRageClick).toHaveBeenCalledTimes(1);
    expect(onRageClick).toHaveBeenCalledWith('button[data-otel-action="place-order"]', 3, '/');
  });
});


