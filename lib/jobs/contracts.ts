import {isQuestionnaireAnswers,type Questionnaire,type QuestionnaireAnswers} from './questionnaire';
export const documents = ['paper','memo','learner-memo','teacher-description'] as const;
export type DocumentName = typeof documents[number];
export const documentLabels: Record<DocumentName,string> = {paper:'Question paper',memo:'First-draft marking memorandum','learner-memo':'Learner memorandum','teacher-description':'Teacher description'};
export type Order = {id:string;title:string;moduleId:string;release:string;internalTest:boolean;state:string;createdAt:string;updatedAt:string;form:{id:string;label:string;options:string[]}[]|Questionnaire|null;answers:Record<string,string>|QuestionnaireAnswers|null;answerSummary?:{title:string;fields:{label:string;value:string}[]}[]|null;documents:DocumentName[]};
export const stateLabels:Record<string,string> = {awaiting_answers:'Ready for your answers',queued:'Queued',generating:'Preparing your paper',awaiting_memo_review:'Checking the memorandum',rendering:'Formatting your documents',awaiting_release:'Checking your documents',released:'Ready to download',held:'Your request needs attention',cancelled:'Cancelled'};
export function isUuid(value:unknown):value is string {return typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);}
export function isSubmission(value:unknown):value is {requestKey:string;answers:Record<string,string>|QuestionnaireAnswers} {
 if(!value || typeof value!=='object' || Array.isArray(value)) return false;
 const v=value as Record<string,unknown>;
 return Object.keys(v).sort().join(',')==='answers,requestKey' && isUuid(v.requestKey) && !!v.answers && typeof v.answers==='object' && !Array.isArray(v.answers) && (isQuestionnaireAnswers(v.answers) || (Object.keys(v.answers).length<=20 && Object.values(v.answers).every(a=>typeof a==='string' && a.length<=200)));
}
