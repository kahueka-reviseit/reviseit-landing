import type { Answer, QuestionField } from '../jobs/questionnaire';
import type { Attention, BloomKey, CurriculumComparison, FacetView, LineChoice, PartView } from './contracts';

/**
 * Consumer of the producer's private classification contract (version 1).
 * The rule grammar is the producer's; this module evaluates it and never
 * extends it. Until the contract drop is connected, a pinned classification
 * is reported as unreadable rather than guessed at.
 */
export type RequirementsProfile = Record<string,unknown>;
export type ClassifiedItem = {readonly contract:'configurator-contract-v1'; readonly document:unknown; readonly profile:RequirementsProfile|null; readonly fields:QuestionField[]};
export type ClassifiedResult = {
  feasible:boolean; issues:string[]; outstanding:string[]; attention:Attention[];
  cognitive:Record<BloomKey|'unclassified',{min:number;max:number}>; bands:Record<string,{min:number;max:number}>;
  parts:PartView[]; facets:FacetView[]; blockedFieldOptions:Record<string,Set<string>>;
  plannedParts:{id:string; marks:{min:number;max:number}|null; bloom:BloomKey|null; learnerDrawn:boolean}[];
  diagram:{stimulus:string; learnerDrawn:string[]}|null;
  diagramView:{stimulus:'required'|'optional'|'not_applicable'|'unknown'; learnerDrawn:string[]; locked?:string}|null;
};

export function interpretClassification(_payload:unknown,_profile:RequirementsProfile|null,_fields:QuestionField[]):ClassifiedItem {
  throw new Error('Classification contract version 1 is not connected');
}
export function evaluateClassified(_item:ClassifiedItem,_choice:LineChoice,_marks:number,_answers:Record<string,Answer>,_opts:{paid:boolean}):ClassifiedResult {
  throw new Error('Classification contract version 1 is not connected');
}
export function profileComparison(_ref:string,_profile:RequirementsProfile,_rows:Map<string,{min:number;max:number}>):CurriculumComparison|null {
  return null;
}
