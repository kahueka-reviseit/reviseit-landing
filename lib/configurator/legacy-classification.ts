/** Read-only compatibility for issued definitions. Never rewrites their stored bytes or hashes.
 * New publications use version 4 directly; legacy level values do not enter the evaluator.
 */
const object=(x:unknown):x is Record<string,any>=>!!x&&typeof x==='object'&&!Array.isArray(x);
export function bloomOnlyClassification(payload:unknown):unknown {
  if(!object(payload)) return payload;
  if(payload.schemaVersion===4) {
    if('curriculumRequirementsRef' in payload || (Array.isArray(payload.parts)&&payload.parts.some((p:any)=>object(p?.cognitive)&&
      ('curriculumBand' in p.cognitive || 'curriculumBandCandidates' in p.cognitive)))) throw new Error('Retired classification fields');
    return payload;
  }
  if(![1,2,3].includes(payload.schemaVersion)) return payload;
  const {curriculumRequirementsRef:retired,...doc}=payload;
  const {requirementsProfileSha256,labelNormalisations,...provenance}=object(doc.provenance)?doc.provenance:{};
  return {...doc,provenance,schemaVersion:4,parts:Array.isArray(doc.parts)?doc.parts.map((part:any)=>{
    if(!object(part?.cognitive)) return part;
    const {curriculumBand, curriculumBandCandidates, sourceLabels, ...cognitive}=part.cognitive;
    const basis=cognitive.bloomBasis;
    if(['grouped-band-unresolved','source-bloom-column-holds-band-code','source-label-conflates-band-and-bloom'].includes(cognitive.unknownReason)) cognitive.unknownReason='source-category-unresolved';
    cognitive.bloomBasis=basis==='profile-single-mapping'?'source-conversion':basis==='profile-authorised-fallback'?'owner-approved-conversion':basis;
    return {...part,cognitive};
  }):doc.parts};
}
