// Synthetic transport fixtures only, never real curriculum material.
export function publication(release='1.0',moduleId='synthetic-publication-sciences') {
 return {schema:'reviseit/catalogue@2',status:'published',module:{id:moduleId,name:'Synthetic publication sciences'},release,contentDigest:'a'.repeat(64),entries:[{
  id:'structured:P1-EXAMPLE-01',code:'P1-EXAMPLE-01',kind:'structured',paper:1,title:`Published example ${release}`,topic:'Synthetic mechanics',description:'Interpret a synthetic relationship.',marks:{min:8,max:12},
  preview:{subquestions:{min:1,max:2},outline:[{summary:'Interpret a relationship',bloom:'Understand'}]},
 }]};
}
// Only a trusted existing-gate executor/operator records approval receipts. Tests use the DB owner.
export async function recordReceipt(db:{query:Function},id:string,payload:unknown,previous:string|null=null) {
 await db.query(`insert into private.catalogue_gate_receipts(id,gate_action,gate_record_id,reviewer_id,approved_at,expected_previous_release,forms_digest,duplicate_skill_pairings_flagged,payload)
 values($1::uuid,'publishCatalogue',$1::text,'synthetic-human-reviewer',now(),$2,$3,true,$4::jsonb)`,[id,previous,'b'.repeat(64),JSON.stringify(payload)]);
}
