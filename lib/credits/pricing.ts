/** Founder pricing, 1 October 2026. Rand is stored as integer cents.
 * The structured section is prorated, rounded once to the nearest cent.
 */
export const CREDIT_PRICE_VERSION = '2026-10-01-prorated-v1';
export type PaperPrice = { version:string; currency:'zar'; multipleChoiceMinor:number; structuredMinor:number; totalMinor:number };
export function pricePaper(multipleChoiceCount:number, structuredMarks:number):PaperPrice {
  if(!Number.isInteger(multipleChoiceCount)||multipleChoiceCount<0||multipleChoiceCount>10 ||
    !Number.isInteger(structuredMarks)||structuredMarks<0||structuredMarks>130 ||
    multipleChoiceCount+structuredMarks===0) throw new Error('Choose 1–10 multiple-choice questions or 1–130 structured marks.');
  const multipleChoiceMinor=multipleChoiceCount*5000;
  const structuredMinor=Math.floor((structuredMarks*145000+65)/130);
  return {version:CREDIT_PRICE_VERSION,currency:'zar',multipleChoiceMinor,structuredMinor,totalMinor:multipleChoiceMinor+structuredMinor};
}
export function formatRand(minor:number):string {
  if(!Number.isSafeInteger(minor))throw new Error('Money must be integer cents');
  return new Intl.NumberFormat('en-ZA',{style:'currency',currency:'ZAR',minimumFractionDigits:minor%100===0?0:2,maximumFractionDigits:2}).format(minor/100);
}
