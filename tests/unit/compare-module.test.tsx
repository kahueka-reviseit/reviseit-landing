import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import CompareModule from '../../app/pilot/CompareModule';

describe('Pilot comparison', () => {
  it('switches between the current process and the Revise It offering', async () => {
    const user = userEvent.setup();
    render(<CompareModule />);

    expect(screen.getByText(/Teachers either build papers from scratch/)).toBeVisible();
    expect(screen.queryByText(/A comprehensive teacher memo/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'With Revise It' }));
    expect(screen.getByText(/A comprehensive teacher memo/)).toBeVisible();
    expect(screen.queryByText(/Teachers either build papers from scratch/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'How departments do it today' }));
    expect(screen.getByText(/Teachers either build papers from scratch/)).toBeVisible();
    expect(screen.queryByText(/A comprehensive teacher memo/)).not.toBeInTheDocument();
  });

  it('supports changing the comparison with the keyboard', async () => {
    const user = userEvent.setup();
    render(<CompareModule />);

    await user.tab();
    expect(screen.getByRole('button', { name: 'How departments do it today' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'With Revise It' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByText(/A comprehensive teacher memo/)).toBeVisible();
  });
});
