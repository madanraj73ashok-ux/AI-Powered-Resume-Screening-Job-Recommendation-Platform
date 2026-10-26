import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge, Alert, EmptyState } from '../components/ui';
import { apiErrorMessage } from '../api/client';

describe('UI primitives', () => {
  it('renders a badge with its label', () => {
    render(<Badge color="green">Verified</Badge>);
    expect(screen.getByText('Verified')).toBeInTheDocument();
  });

  it('renders an error alert', () => {
    render(<Alert kind="error">Something failed</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('Something failed');
  });

  it('renders an empty state with title and description', () => {
    render(
      <EmptyState title="No resumes yet" description="Upload a resume to get started." />
    );
    expect(screen.getByText('No resumes yet')).toBeInTheDocument();
    expect(screen.getByText('Upload a resume to get started.')).toBeInTheDocument();
  });
});

describe('apiErrorMessage', () => {
  it('returns a fallback message for unknown errors', () => {
    expect(apiErrorMessage(new Error('boom'))).toBe(
      'Something went wrong. Please try again.'
    );
  });
});
