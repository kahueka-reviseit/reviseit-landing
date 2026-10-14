// @vitest-environment node
import {test,expect,vi} from 'vitest';
import {releaseWorkerOperation} from '../../lib/studio/release-worker-gateway';
import {sha256} from '../../lib/studio/contracts';
test('teacher release gateway exposes no approval, publication, deletion or general database command',async()=>{
 const rpc=vi.fn(),storage={} as any;
 for(const action of ['approve','publish','activate','delete','rpc'])await expect(releaseWorkerOperation({action},rpc,storage)).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();
});
test('download checks complete file bytes before returning a bounded chunk',async()=>{
 const raw=Buffer.alloc(600000,65),rpc=vi.fn().mockResolvedValue({data:{key:'fixed',sha256:sha256(raw),size:raw.length},error:null}),storage={get:vi.fn().mockResolvedValue(raw)} as any;
 const v={action:'file',id:'00000000-0000-4000-8000-000000000064',path:'bundle/synthetic/manifest.json',offset:0};
 const out:any=await releaseWorkerOperation(v,rpc,storage);expect(Buffer.from(out.content,'base64')).toHaveLength(524288);expect(storage.get).toHaveBeenCalledWith('fixed');
 storage.get.mockResolvedValue(Buffer.from('changed'));await expect(releaseWorkerOperation(v,rpc,storage)).rejects.toThrow('Integrity');
});
