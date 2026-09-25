// @vitest-environment node
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {describe,it,expect} from 'vitest';
import {evaluatePaper,type Classification,type Profile} from '../../lib/configurator/contract-v1';
// The producer's private conformance fixtures stay outside this public repository.
// CONFIGURATOR_CONTRACT_DIR (version 1) and CONFIGURATOR_CONTRACT_V2_DIR (version 2)
// name hash-verified copies of contract drops; each absent drop's suite is skipped.
const load=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const list=(p:string)=>existsSync(p)?readdirSync(p).filter(f=>f.endsWith('.json')).sort():[];
for(const [label,dir,counts] of [['version 1',process.env.CONFIGURATOR_CONTRACT_DIR||'',{classifications:6,profiles:2,papers:23}],['version 2',process.env.CONFIGURATOR_CONTRACT_V2_DIR||'',null]] as const){
 describe.skipIf(!dir)(`configurator contract ${label} conformance (private fixtures)`,()=>{
  const classifications:Classification[]=list(join(dir,'fixtures/classifications/valid')).map(f=>load(join(dir,'fixtures/classifications/valid',f)));
  const profiles:Profile[]=list(join(dir,'fixtures/profiles/valid')).map(f=>load(join(dir,'fixtures/profiles/valid',f)));
  const papers=list(join(dir,'fixtures/papers'));
  it('has a fixture set',()=>{if(counts){expect(classifications.length).toBe(counts.classifications);expect(profiles.length).toBe(counts.profiles);expect(papers.length).toBe(counts.papers);}else expect(papers.length).toBeGreaterThan(0);});
  it.each(papers)('%s matches the producer result exactly',name=>{
   const result=evaluatePaper(load(join(dir,'fixtures/papers',name)),classifications,profiles);
   expect(JSON.parse(JSON.stringify(result))).toEqual(load(join(dir,'fixtures/expected/papers',name.replace(/\.json$/,'.result.json'))));
  });
 });
}
