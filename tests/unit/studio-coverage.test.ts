// Strict coverage arithmetic (addendum C05). Small explicit fixtures; this proves the counting rule,
// not that any classifier assigns the right labels.
import { test, expect } from 'vitest';
import { taskCoverage, specificationCoverage, leafOutcome, type LeafReview, type InventoryLeaf } from '../../lib/studio/coverage';

const leaf = (id: string, marks: number | null): InventoryLeaf => ({ id, marks, format: 'structured', question: id.split('.')[0] });
const c = (id: string, label: any, status: any = 'resolved') => ({ id, label, status });
test('a required EXACT plus a required NEAR is partial and earns zero marks', () => {
  const r: LeafReview = { leafId: '1.1', reviewed: true, components: [c('a', 'EXACT'), c('b', 'NEAR')], paths: [{ components: ['a', 'b'], sufficient: true, role: 'required' }] };
  expect(leafOutcome(r)).toBe('partial');
  expect(taskCoverage([leaf('1.1', 4)], [r])).toMatchObject({ numerator: 0, denominator: 4, partial: ['1.1'] });
});
test('two required EXACT components covering the leaf earn its marks once', () => {
  const r: LeafReview = { leafId: '1.2', reviewed: true, components: [c('a', 'EXACT'), c('b', 'VARIANT')], paths: [{ components: ['a', 'b'], sufficient: true }] };
  expect(taskCoverage([leaf('1.2', 5)], [r])).toMatchObject({ numerator: 5, denominator: 5, full: ['1.2'] });
});
test('two alternative fully covered paths still earn the marks once', () => {
  const r: LeafReview = { leafId: '2.1', reviewed: true, components: [c('a', 'EXACT'), c('b', 'EXACT')], paths: [{ components: ['a'], sufficient: true, role: 'alternative' }, { components: ['b'], sufficient: true, role: 'alternative' }] };
  expect(taskCoverage([leaf('2.1', 3)], [r]).numerator).toBe(3);
});
test('unresolved evidence earns no assumed coverage; an insufficient path is not full', () => {
  expect(leafOutcome({ leafId: 'x', reviewed: true, components: [c('a', null, 'unresolved')], paths: [{ components: ['a'], sufficient: true }] })).toBe('none');
  expect(leafOutcome({ leafId: 'x', reviewed: true, components: [c('a', 'EXACT')], paths: [{ components: ['a'], sufficient: false }] })).toBe('partial');
  expect(leafOutcome({ leafId: 'x', reviewed: true, components: [c('a', 'EXACT', 'evidence_blocked')], paths: [{ components: ['a'], sufficient: true }] })).toBe('none');
});
test('the denominator keeps every printed mark; missing review and missing marks are shown explicitly', () => {
  const r = taskCoverage([leaf('1.1', 2), leaf('1.2', 3), leaf('1.3', null)], [{ leafId: '1.1', reviewed: true, components: [c('a', 'EXACT')], paths: [{ components: ['a'], sufficient: true }] }]);
  expect(r).toMatchObject({ numerator: 2, denominator: 5, unreviewed: ['1.2'], missingMarks: ['1.3'] });
});
test('unmapped is a status, not a semantic label; NOVEL carries no existing record reference', () => {
  expect(() => leafOutcome({ leafId: 'x', reviewed: true, components: [c('a', 'UNMAPPED_FINDING')], paths: [] })).toThrow(/Invalid task label/);
  expect(() => leafOutcome({ leafId: 'x', reviewed: true, components: [{ id: 'a', label: 'NOVEL', status: 'resolved', recordRef: { moduleId: 'm', kind: 'task_type', id: 'PHYS_01' } }], paths: [] })).toThrow(/NOVEL/);
});
test('whole-question coverage counts reviewed EXACT and CLOSE against all structured questions; zero is not applicable', () => {
  expect(specificationCoverage([])).toMatchObject({ value: 'not_applicable' });
  expect(specificationCoverage([{ question: '1', reviewed: true, label: 'EXACT', status: 'resolved' }, { question: '2', reviewed: true, label: 'PARTIAL', status: 'resolved' }, { question: '3', reviewed: false, label: 'CLOSE', status: 'resolved' }]))
    .toMatchObject({ numerator: 1, denominator: 3, unreviewed: ['3'] });
});
