import type { Answer, QuestionField } from '../jobs/questionnaire';
import type { Configuration, TeacherBrief } from './contracts';

export const emptyBrief = (text=''):TeacherBrief => ({text,interpretedText:null,suggestions:{},resolutions:{}});
export const sameAnswer = (a:Answer|undefined,b:Answer|undefined) => a?.kind===b?.kind &&
  (a?.kind==='choice'?b?.kind==='choice'&&a.choiceId===b.choiceId:a?.kind==='text'?b?.kind==='text'&&a.text===b.text:true);
export function briefConflicts(brief:TeacherBrief|undefined,answers:Record<string,Answer>) {
  return brief?Object.entries(brief.suggestions).filter(([id,a])=>answers[id]&&!sameAnswer(a,answers[id])&&!brief.resolutions[id]).map(([id])=>id):[];
}
/** Configure fills only unanswered fields. Existing decisions always need an explicit change. */
export function applyInterpretation(cfg:Configuration,lineId:string,suggestions:Record<string,Answer>):Configuration {
  const next=structuredClone(cfg),brief=next.briefs?.[lineId];
  if(!brief)throw new Error('Missing saved brief');
  const previous=brief.suggestions,oldResolutions=brief.resolutions,unchanged=brief.interpretedText===brief.text;
  brief.interpretedText=brief.text;brief.suggestions=suggestions;brief.resolutions={};
  const answers=next.answers.items[lineId]??={};
  for(const [id,a] of Object.entries(suggestions)) {
    if(!answers[id])answers[id]=a;
    // A repeat of the identical interpretation retains the teacher's explicit resolution.
    if(unchanged&&sameAnswer(previous[id],a)&&oldResolutions[id])brief.resolutions[id]=oldResolutions[id];
  }
  return next;
}

/**
 * Up to four of the item's own authored questions, required ones first, as starting
 * points for the brief. They are reminders only; the fields and their rules are unchanged.
 */
export function briefPrompts(fields:QuestionField[]):string[] {
  return [...fields.filter(f=>f.required),...fields.filter(f=>!f.required)].map(f=>f.label.trim()).filter(Boolean).slice(0,4);
}
