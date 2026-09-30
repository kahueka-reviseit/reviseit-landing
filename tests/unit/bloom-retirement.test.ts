// @vitest-environment node
import {expect,it} from 'vitest';
import {bloomOnlyClassification} from '../../lib/configurator/legacy-classification';
import {interpretClassification} from '../../lib/configurator/classification';
import {readFileSync} from 'node:fs';

const legacy={schemaVersion:3,curriculumRequirementsRef:{profileId:'historic',version:1},
 provenance:{sources:[{sha256:'immutable-source'}],requirementsProfileSha256:'old',labelNormalisations:[]},
 parts:[{id:'part',cognitive:{bloom:'apply',bloomCandidates:[],curriculumBand:'L3',curriculumBandCandidates:[],sourceLabels:{bloom:'L3'},bloomBasis:'profile-authorised-fallback'}}]};
it('reads historical definitions without mutating their bytes, categories or source identity',()=>{
 const bytes=JSON.stringify(legacy),result:any=bloomOnlyClassification(legacy);
 expect(JSON.stringify(legacy)).toBe(bytes);
 expect(result.provenance.sources).toEqual(legacy.provenance.sources);
 expect(result.parts[0].cognitive).toEqual({bloom:'apply',bloomCandidates:[],bloomBasis:'owner-approved-conversion'});
 expect(result).not.toHaveProperty('curriculumRequirementsRef');
 expect(result.provenance).not.toHaveProperty('requirementsProfileSha256');
});
it('new format refuses retired fields instead of silently accepting a second model',()=>{
 const clean:any=bloomOnlyClassification(legacy);
 expect(()=>bloomOnlyClassification({...clean,curriculumRequirementsRef:null})).toThrow('Retired');
 expect(()=>bloomOnlyClassification({...clean,parts:[{cognitive:{...clean.parts[0].cognitive,curriculumBand:null}}]})).toThrow('Retired');
});
it('unknown contract versions stay refused',()=>{
 expect(()=>interpretClassification({...legacy,schemaVersion:99},[])).toThrow('Unsupported');
});

const registrations=process.env.CONFIGURATOR_CONTENT_REGISTRATIONS;
it.skipIf(!registrations)('all new registered definitions are Bloom-only with source identities intact',()=>{
 const rows=JSON.parse(readFileSync(registrations!,'utf8')).classifications;
 expect(rows).toHaveLength(64);
 for(const row of rows){
  expect(row.envelope.schemaVersion).toBe(4);
  expect(row).not.toHaveProperty('requirementsSha256');
  const text=JSON.stringify(row.envelope);
  for(const key of ['curriculumRequirementsRef','curriculumBand','requirementsProfileSha256','profile-authorised-fallback'])expect(text).not.toContain(key);
  const item=interpretClassification(row.envelope,row.fields,{range:row.catalogueMarks,fixedMarks:row.kind==='multiple-choice'?2:null,formRevision:row.registration.formRevision,kind:row.envelope.kind});
  expect(item.doc.provenance).toEqual(row.envelope.provenance);
 }
});
