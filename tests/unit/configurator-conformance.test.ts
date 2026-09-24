// @vitest-environment node
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {describe,it,expect} from 'vitest';
import {evaluatePaper,type Classification,type Profile} from '../../lib/configurator/contract-v1';
// The producer's private conformance fixtures stay outside this public
// repository. Point CONFIGURATOR_CONTRACT_DIR at a hash-verified copy of the
// contract drop to run every expected result; without it this suite is skipped.
const dir=process.env.CONFIGURATOR_CONTRACT_DIR||'';
const load=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const list=(p:string)=>existsSync(p)?readdirSync(p).filter(f=>f.endsWith('.json')).sort():[];
describe.skipIf(!dir)('configurator contract v1 conformance (private fixtures)',()=>{
 const classifications:Classification[]=list(join(dir,'fixtures/classifications/valid')).map(f=>load(join(dir,'fixtures/classifications/valid',f)));
 const profiles:Profile[]=list(join(dir,'fixtures/profiles/valid')).map(f=>load(join(dir,'fixtures/profiles/valid',f)));
 const papers=list(join(dir,'fixtures/papers'));
 it('has the expected fixture set',()=>{expect(classifications.length).toBe(6);expect(profiles.length).toBe(2);expect(papers.length).toBe(23);});
 it.each(papers)('%s matches the producer result exactly',name=>{
  const result=evaluatePaper(load(join(dir,'fixtures/papers',name)),classifications,profiles);
  expect(JSON.parse(JSON.stringify(result))).toEqual(load(join(dir,'fixtures/expected/papers',name.replace(/\.json$/,'.result.json'))));
 });
});
