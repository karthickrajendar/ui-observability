import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ObservabilityErrorBoundary } from './error-boundary';

const captureErrorMock = vi.hoisted(() => vi.fn());

vi.mock('../core/api', () => ({
  captureError: captureErrorMock,
}));

function Bomb(): never {
  throw new Error('render exploded');
}

describe('ObservabilityErrorBoundary', () => {
  beforeEach(() => {
    captureErrorMock.mockClear();
    // React logs caught render errors; keep test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders children when nothing throws', () => {
    render(
      <ObservabilityErrorBoundary fallback={<p>failed</p>}>
        <p>content</p>
      </ObservabilityErrorBoundary>
    );
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('reports the error with the component stack and renders the fallback', () => {
    render(
      <ObservabilityErrorBoundary fallback={<p>something went wrong</p>}>
        <Bomb />
      </ObservabilityErrorBoundary>
    );

    expect(screen.getByText('something went wrong')).toBeTruthy();
    expect(captureErrorMock).toHaveBeenCalledTimes(1);
    const [error, context] = captureErrorMock.mock.calls[0];
    expect((error as Error).message).toBe('render exploded');
    expect(context.attributes.source).toBe('react-error-boundary');
    expect(context.attributes).toHaveProperty('component_stack');
  });

  it('supports a render-function fallback receiving the error', () => {
    render(
      <ObservabilityErrorBoundary fallback={(error) => <p>caught: {error.message}</p>}>
        <Bomb />
      </ObservabilityErrorBoundary>
    );
    expect(screen.getByText('caught: render exploded')).toBeTruthy();
  });
});
