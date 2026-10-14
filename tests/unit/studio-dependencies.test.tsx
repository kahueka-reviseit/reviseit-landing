import {beforeEach,test,expect} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {DependencyImpact} from '../../app/(accounts)/admin/studio/dependency-impact';
import {impactUrl} from '../../lib/studio/dependencies';
import {impact} from '../fixtures/studio-impact';
beforeEach(cleanup);
test('report distinguishes byte reuse, unresolved links, frozen orders and approval',()=>{
 render(<DependencyImpact data={impact}/>);
 expect(screen.getByText(/does not approve a change/)).toBeTruthy();expect(screen.getByText(/Existing orders retain their frozen inputs/)).toBeTruthy();expect(screen.getByText(/variant references without a parent/)).toBeTruthy();
 expect(screen.getByRole('link',{name:'Synthetic charge calculation'}).getAttribute('href')).toContain('release=synthetic-1');
 expect(screen.getByRole('link',{name:'data/specs/SPEC_P1_SYNTH_01.md'}).getAttribute('href')).toContain(impact.file.snapshotId);
 expect(screen.queryByRole('button',{name:/approve|publish/i})).toBeNull();
});
test('zero matches never implies no impact and form candidates are identified as filename matches',()=>{
 render(<DependencyImpact data={{...impact,dependentRecords:[],catalogueUses:[],formItems:[{...impact.catalogueUses[0]}]}}/>);
 expect(screen.getByText(/not proof of no impact/)).toBeTruthy();expect(screen.getByText(/identifier comes from the authored form/)).toBeTruthy();expect(screen.getByText('Orders containing this form’s item identifier')).toBeTruthy();
});
test('draft link pins revision and hash; source paths are encoded',()=>{
 const url=new URL(impactUrl({...impact.file,path:'data/specs/a&b.md'},'saved-draft',3,'f'.repeat(64)),'https://synthetic.invalid');expect(url.searchParams.get('path')).toBe('data/specs/a&b.md');expect(url.searchParams.get('draft')).toBe('saved-draft');expect(url.searchParams.get('revision')).toBe('3');expect(url.searchParams.get('sha256')).toBe('f'.repeat(64));
});
