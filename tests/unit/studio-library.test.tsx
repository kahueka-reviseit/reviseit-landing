import {beforeEach,test,expect} from 'vitest';
import {cleanup,render,screen,fireEvent} from '@testing-library/react';
import {LibraryView} from '../../app/(accounts)/admin/studio/library-view';
import {CatalogueItemView} from '../../app/(accounts)/admin/studio/catalogue-item';
import {BankFileView} from '../../app/(accounts)/admin/studio/bank-file';
import {ReleasesView} from '../../app/(accounts)/admin/studio/releases-view';
import {library,libraryItem,fileDetail,releases} from '../fixtures/studio-library';
import {catalogueEntryId} from '../../lib/studio/library';
beforeEach(cleanup);
test('catalogue route identity accepts raw and encoded separators and rejects malformed identifiers',()=>{
 expect(catalogueEntryId('structured%3AP1-WAVE-02')).toBe('structured:P1-WAVE-02');expect(catalogueEntryId('mcq:MCQ_39')).toBe('mcq:MCQ_39');
 expect(()=>catalogueEntryId('../MCQ_39')).toThrow();expect(()=>catalogueEntryId('structured%253AP1-WAVE-02')).toThrow();
});
test('catalogue filters distinguish unavailable from available and links pin module, release and entry',()=>{
 render(<LibraryView data={library}/>);fireEvent.change(screen.getByLabelText('Availability'),{target:{value:'unavailable'}});expect(screen.queryByText('Synthetic charge calculation')).toBeNull();
 expect(screen.getByRole('link',{name:'Synthetic fixed question'}).getAttribute('href')).toContain('mcq%3AMCQ_01?module=caps-grade-10-physical-sciences&release=synthetic-1');
 fireEvent.change(screen.getByLabelText('Find an item or file'),{target:{value:'no matching item'}});expect(screen.getByRole('status')).toHaveTextContent('No catalogue items');
});
test('bank variants retain parent identity and rehearsal is conspicuous',()=>{
 render(<LibraryView data={library} moduleId={library.modules[0].id} initialTab="tasks"/>);expect(screen.getByText('PHYS_01 · 1A')).toBeTruthy();expect(screen.getByText('CHEM_01 · 1A')).toBeTruthy();expect(screen.getByText(/isolated rehearsal copy/)).toBeTruthy();
});
test('form view distinguishes a complete no-input form from a missing one',()=>{
 const {rerender}=render(<CatalogueItemView item={{...libraryItem,form:{...libraryItem.form!,fields:[],explicitlyNoInput:true}}}/>);fireEvent.click(screen.getByRole('button',{name:'Teacher questions'}));expect(screen.getByRole('heading',{name:'No input needed'})).toBeTruthy();
 rerender(<CatalogueItemView item={{...libraryItem,form:null}}/>);expect(screen.getByRole('status')).toHaveTextContent('No teacher questionnaire is registered');
});
test('source HTML is displayed as text, not executed; failed integrity never displays source content',()=>{
 const {container,rerender}=render(<BankFileView file={fileDetail} content={'<img src=x onerror="bad()">'}/>);expect(container.querySelector('img')).toBeNull();expect(screen.getByText('<img src=x onerror="bad()">')).toBeTruthy();
 rerender(<BankFileView file={fileDetail} content={null} error="Integrity check failed"/>);expect(container.querySelector('pre')).toBeNull();expect(screen.getByRole('status')).toHaveTextContent('Integrity check failed');
});
test('releases shows current vs historical publication evidence without pretending to have activation or rollback commands',()=>{
 render(<ReleasesView data={releases}/>);expect(screen.getByText('Historical')).toBeTruthy();expect(screen.getByText(/not an activation or rollback history/)).toBeTruthy();expect(screen.queryByRole('button')).toBeNull();expect(screen.getByText(/not proof of the generation worker/)).toBeTruthy();
});
