import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import App from './app';

describe('App', () => {
  it('renders the home page without the SDK being initialized', () => {
    // The observability SDK is deliberately NOT initialized here:
    // rendering must work when telemetry is disabled.
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );
    expect(screen.getByText('Frontend Observability Demo')).toBeTruthy();
    expect(screen.getByText('disabled')).toBeTruthy();
  });

  it('renders the telemetry lab route', () => {
    render(
      <MemoryRouter initialEntries={['/lab']}>
        <App />
      </MemoryRouter>
    );
    expect(screen.getByRole('heading', { name: 'Telemetry Lab' })).toBeTruthy();
  });
});
