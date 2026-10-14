import {creditsEnabled} from '../../../../../../../lib/credits/server';
import {requireStudioEditor} from '../../../../../../../lib/studio/server';
import {call} from '../../../../../../../lib/studio/contracts';
import {type CatalogueItem,catalogueEntryId} from '../../../../../../../lib/studio/library';
import {StaffHeader} from '../../../../../staff-header';
import {Notice} from '../../../../../system/notice';
import {StudioShell,StudioHeading} from '../../../components';
import {CatalogueItemView} from '../../../catalogue-item';
export const dynamic='force-dynamic';
export default async function Item({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{module?:string;release?:string}>}) {
 const {rpc,account}=await requireStudioEditor(),{id}=await params,q=await searchParams;let item:CatalogueItem|null=null;
 try {item=await call(rpc,'studio_catalogue_item_view',{p_module:q.module||'',p_release:q.release||'',p_entry:catalogueEntryId(id)});}catch(e){console.warn('Studio catalogue read failed',{entryId:id,moduleId:q.module,release:q.release,error:e instanceof Error?e.message:'Unknown read error'});}
 return <><StaffHeader current="studio" studioEnabled creditsEnabled={creditsEnabled()} signedIn name={(account.full_name||'').split(/\s+/)[0]}/><StudioShell current="library" moduleId={item?.moduleId||q.module}>{item?<CatalogueItemView item={item}/>:<><StudioHeading title="Catalogue item unavailable" breadcrumb="Library"/><Notice tone="problem">This registered item could not be loaded. Return to the library and select its release again.</Notice></>}</StudioShell></>;
}
