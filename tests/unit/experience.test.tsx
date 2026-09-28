import { describe, expect, it, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('server-only', () => ({}));
// Next supplies these form hooks at runtime; the test's React 18 build does not.
vi.mock('react-dom', async orig => ({ ...(await orig<typeof import('react-dom')>()), useFormState: (_: unknown, initial: unknown) => [initial, vi.fn()], useFormStatus: () => ({ pending: false }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../app/(accounts)/actions', () => ({ reviewAccount: vi.fn(), registerDepartment: vi.fn() }));
import { detailsFact, documentsFact, groupOrders, isClosed, journeySteps, paperTitle, paymentFact, paymentNotice, shortDate } from '../../lib/jobs/presentation';
import { chips, occurrence } from '../../app/(accounts)/teacher/orders/[id]/submitted-summary';
import { searchTerm } from '../../app/(accounts)/admin/data';
import { ReviewPanel } from '../../app/(accounts)/admin/accounts/review';
import type { Order, OrderPayment } from '../../lib/jobs/contracts';
import type { LineView } from '../../lib/configurator/contracts';

// C08 presentation rules. All data is synthetic.
const pay = (status: OrderPayment['status'], extra: Partial<OrderPayment> = {}): OrderPayment => ({ status, amountMinor: 10000, currency: 'zar', testMode: false, checkoutUrl: null, needsAttention: false, ...extra });
const order = (state: string, payment: OrderPayment | null, n = 0): Order => ({ id: `00000000-0000-4000-8000-00000000000${n}`, title: 'Catalogue paper', moduleId: 'm', release: '1', internalTest: false, state, createdAt: '2026-09-26T08:00:00Z', updatedAt: '', form: null, answers: null, documents: state === 'released' ? ['paper', 'memo', 'learner-memo', 'teacher-description'] : [], payment, configurable: true });

describe('three separate facts', () => {
  it('shows payment only from the server status and never as paid before confirmation', () => {
    expect(paymentFact(pay('open')).value).toBe('Not paid yet');
    expect(paymentFact(pay('paid')).value).toBe('Paid · R100');
    expect(paymentFact(pay('paid', { testMode: true })).detail).toBe('Stripe test mode, no real charge');
    expect(paymentFact(pay('paid', { needsAttention: true })).tone).toBe('attention');
    for (const s of ['cancelled', 'expired', 'failed'] as const) expect(paymentFact(pay(s)).detail).toBe('No payment taken');
    expect(paymentFact(pay('refunded')).value).toBe('Refunded');
  });
  it('keeps question details and documents distinct from payment', () => {
    expect(detailsFact(order('awaiting_payment', pay('open'))).value).toBe('Open after payment');
    expect(detailsFact(order('awaiting_answers', pay('paid')), { ready: 3, total: 7 }).value).toBe('In progress · 3 of 7');
    expect(detailsFact(order('rendering', pay('paid'))).value).toBe('Submitted');
    expect(documentsFact(order('rendering', pay('paid'))).detail).toBe('Stage 4 of 5 · you can close this page');
    expect(documentsFact(order('released', pay('paid'))).value).toBe('Ready · 4 of 4');
    expect(documentsFact(order('held', pay('paid'))).value).toBe('Stopped');
  });
  it('treats a refunded or abandoned checkout as closed, but never a paid paper in progress', () => {
    expect(isClosed(order('awaiting_answers', pay('refunded')))).toBe(true);
    expect(isClosed(order('awaiting_payment', pay('expired')))).toBe(true);
    expect(isClosed(order('held', pay('paid')))).toBe(false);
    expect(isClosed(order('queued', pay('paid')))).toBe(false);
  });
});

test('My papers groups what needs the teacher first, then creating, ready and closed', () => {
  const rows = groupOrders([order('released', pay('paid'), 1), order('awaiting_payment', pay('cancelled'), 2), order('rendering', pay('paid'), 3), order('awaiting_answers', pay('paid'), 4), order('awaiting_payment', pay('open'), 5)]);
  expect(rows.map(r => r.row.group)).toEqual(['needs-you', 'needs-you', 'creating', 'ready', 'closed']);
  expect(rows[0].row.next.label).toBe('Finish details');
  expect(rows[1].row.next.label).toBe('Continue to payment');
});

test('a return from checkout only asks the server; it never announces payment', () => {
  const open = order('awaiting_payment', pay('open'));
  expect(paymentNotice(open, true)?.title).toBe('Checking your payment with Stripe');
  expect(paymentNotice(open, false)?.title).toBe('We have not received a payment confirmation yet');
  expect(paymentNotice(order('awaiting_answers', pay('paid', { needsAttention: true })), false)?.title).toBe('Your payment arrived after this checkout closed');
  expect(paymentNotice(order('held', pay('paid')), false)?.tone).toBe('problem');
  expect(paymentNotice(order('awaiting_answers', pay('refunded')), false)?.title).toContain('refunded');
  expect(journeySteps(order('held', pay('paid'))).find(s => s.state === 'stopped')?.label).toBe('Stopped');
});

test('generated titles and dates carry no invented name', () => {
  expect(paperTitle(order('released', pay('paid')), 'Grade 11 Physical Sciences')).toBe('Grade 11 Physical Sciences paper');
  expect(paperTitle({ ...order('released', pay('paid')), title: 'Own name' })).toBe('Own name');
  expect(shortDate('2026-09-26T23:30:00Z')).toBe('27 Sep 2026'); // South African date
});

const line = (over: Partial<LineView>): LineView => ({ id: 'q1', entryId: 'mcq:A', number: '1.1', title: 'T', kind: 'multiple_choice', configurable: 'authored', marks: { value: 2, min: 2, max: 2, fixed: true }, parts: [], facets: [], fields: [], answers: {}, outstanding: [], attention: [], issues: [], ready: true, diagram: null, outline: null, ...over } as LineView);
test('the submitted summary shows each decision once and marks delegation', () => {
  const field = { id: 'friction', label: 'Friction', hint: '', required: true, allowAutomatic: false, type: 'choice' as const, allowOther: false, choices: [{ id: 'k', label: 'Kinetic' }] };
  const values = { id: 'values', label: 'Numerical values', hint: '', required: false, allowAutomatic: true, type: 'choice' as const, allowOther: false, choices: [{ id: 'a', label: 'A' }] };
  const l = line({ fields: [field, values], answers: { friction: { kind: 'choice', choiceId: 'k' }, values: { kind: 'automatic' } },
    facets: [{ id: 'friction', label: 'Friction', hint: '', type: 'choice', required: true, allowAutomatic: false, options: [{ id: 'k', label: 'Kinetic', disabled: false }], value: { kind: 'choice', choiceId: 'k' } }] });
  expect(chips(l)).toEqual([{ text: 'Friction: Kinetic', delegated: false }, { text: 'Numerical values: Revise It chose', delegated: true }]);
  const lines = [line({ id: 'a' }), line({ id: 'b', number: '1.2' }), line({ id: 'c', entryId: 'structured:S' })];
  expect([occurrence(lines, 0), occurrence(lines, 1), occurrence(lines, 2)]).toEqual(['first occurrence', 'second occurrence', null]);
});

test('staff search cannot inject filter syntax', () => {
  expect(searchTerm('smith),status.eq.approved')).toBe('smith status.eq.approved');
  expect(searchTerm('a"b*c%d')).toBe('a b c d');
  expect(searchTerm('x'.repeat(200))).toHaveLength(80);
});

describe('review panel', () => {
  const account = { user_id: 'u1', email: 't@school.example', full_name: 'Synthetic Teacher', requested_school: 'Synthetic School', requested_department: 'Physical Sciences', revision: 3, department_id: null, email_confirmed_at: '2026-09-01' };
  it('preselects no decision', () => {
    render(<ReviewPanel account={account} departments={[]} closeHref="/admin/accounts" statusLabel="Pending"/>);
    for (const name of ['Approve', 'Reject', 'Suspend access']) expect(screen.getByRole('radio', { name })).not.toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Evidence or reason' })).toBeRequired();
  });
  it('keeps Approve unavailable, with the reason, until the email is confirmed', () => {
    render(<ReviewPanel account={{ ...account, email_confirmed_at: null }} departments={[]} closeHref="/admin/accounts" statusLabel="Pending"/>);
    expect(screen.getByRole('radio', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByText(/has not confirmed their email yet/)).toBeVisible();
  });
});
