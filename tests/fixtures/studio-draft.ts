import type {MaintenanceDraft} from '../../lib/studio/maintenance-drafts';
import {fileDetail} from './studio-library';
export const baseText='# Synthetic task type\n\n## Purpose\nAssess one synthetic calculation.\n\n## Variants\nPHYS_01 · 1A belongs to this parent.';
export const currentText=baseText.replace('one synthetic calculation','a clearly described synthetic calculation');
export const draft:MaintenanceDraft={id:'00000000-0000-4000-8000-000000000099',file:fileDetail,revision:1,state:'draft',createdBy:'synthetic-editor',createdAt:'2099-03-17T12:00:00Z',updatedAt:'2099-03-17T12:00:00Z',discardedBy:null,discardedReason:null,revisions:[{revision:1,blobId:fileDetail.blobId,sha256:'b'.repeat(64),size:100,integrity:'verified',reason:'Make the synthetic purpose clearer.',restoredFrom:null,createdBy:'synthetic-editor',createdAt:'2099-03-17T12:00:00Z'}]};
