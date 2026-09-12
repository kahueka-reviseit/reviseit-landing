import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import CatalogueExplorer from '../../app/components/CatalogueExplorer/CatalogueExplorer';

// Exercise selection and display without visibility tracking or external forms.
vi.mock('../../app/hooks/useIntentTracking', () => ({
  useIntentTracking: () => ({ track: vi.fn(), sectionRef: vi.fn() }),
}));

describe('Catalogue selection', () => {
  it('waits for a curriculum selection before showing its preview and request form', () => {
    const { container } = render(<CatalogueExplorer />);
    expect(screen.getByRole('combobox', { name: 'Select a curriculum' })).toHaveValue('');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('shows the selected curriculum and clears it when the selection is reset', async () => {
    const user = userEvent.setup();
    const { container } = render(<CatalogueExplorer />);
    const select = screen.getByRole('combobox', { name: 'Select a curriculum' });

    await user.selectOptions(select, 'caps-gr11-phys-sci');
    expect(screen.getByRole('img', { name: /Preview of the Grade 11 Physical Sciences/ }))
      .toHaveAttribute('src', '/catalogue-previews/caps-gr11-phys-sci.png');
    expect(screen.getByTitle(/Get the Grade 11 Physical Sciences/))
      .toHaveAttribute('data-tally-src', expect.stringContaining('/embed/MeJeXM?'));

    await user.selectOptions(select, '');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('does not let teachers request a curriculum marked as coming soon', async () => {
    const user = userEvent.setup();
    const { container } = render(<CatalogueExplorer />);
    expect(screen.getByRole('option', { name: /Grade 12.*Coming Soon/ })).toBeDisabled();
    await user.selectOptions(screen.getByRole('combobox'), 'caps-gr12-phys-sci');
    expect(screen.getByRole('combobox')).toHaveValue('');
    expect(container.querySelector('iframe')).toBeNull();
  });
});
