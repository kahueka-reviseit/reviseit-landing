import {NextResponse} from 'next/server';
import {access,body,originError,reply} from '../../../../lib/jobs/server';
import {isConfiguredCheckoutRequest} from '../../../../lib/payments/contracts';
import {configuredCheckout} from '../../../../lib/configurator/checkout';
import {serviceClient} from '../../../../lib/supabase/service';
import {creditsEnabled} from '../../../../lib/credits/server';
export async function POST(request:Request){
 const origin=originError(request);if(origin)return origin;
 if(!creditsEnabled())return reply({error:'Department credit is not open yet.'},503);
 const c=await access();if(c instanceof NextResponse)return c;
 let v;try{v=await body(request,8000);}catch{return reply({error:'Invalid paper'},400);}
 if(!isConfiguredCheckoutRequest(v))return reply({error:'Check the paper marks.'},422);
 const service=serviceClient();if(!service)return reply({error:'Paper pricing unavailable.'},503);
 const checked=await configuredCheckout(service,c.user.id,v);if('error' in checked)return reply({error:'Check your saved selection and marks.',problems:checked.problems},422);
 const r=await c.supabase.rpc('quote_department_paper',{target_module:v.moduleId,selection_revision:v.selectionRevision,allocations:v.allocations,targets:v.targets,expected_definitions:checked.definitionsSha256});
 if(r.error)return reply({error:/outside credit pricing/.test(r.error.message)?'Choose up to 10 multiple-choice questions and 130 structured marks.':'The current price could not be confirmed. Your selection is unchanged.'},409);
 return reply(r.data);
}
