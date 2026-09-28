import {describe,it,expect} from 'vitest';
import {compileBrief,interpretBrief} from '../../lib/jev/interpret';
import type {QuestionField} from '../../lib/jobs/questionnaire';
const fields:QuestionField[]=[{id:'setting',label:'Choose the setting',hint:'',required:true,allowAutomatic:true,type:'choice',allowOther:true,choices:[{id:'red',label:'Red'},{id:'blue',label:'Blue'}]},
 {id:'detail',label:'Special instructions',hint:'',required:false,allowAutomatic:true,type:'text',maxLength:1000}];
const response=(a:string,b:string,probability=0.97)=>({answers:{field_0:{type:'choice',choice:a,probabilities:{[a]:probability}},field_1:{type:'choice',choice:b,probabilities:{[b]:probability}}}});
it('uses the actual form options and preserves the original paragraph in state',()=>{
 const c=compileBrief('Use blue. Include a short explanation.',fields,'jev-1.13.0');expect(c.request.state.teacherBrief).toBe('Use blue. Include a short explanation.');expect(c.request.questions.field_0.criteria.blue).toContain('Blue');
 expect(c.request.questions.field_0.criteria.__not_mentioned__).toBeDefined();expect(c.request.questions.field_0.criteria.__unclear__).toBeDefined();
});
it('returns choices and exact source passages, without generating replacement teacher text',()=>{
 const c=compileBrief('Use blue. Include a short explanation.',fields,'jev-1.13.0');const r=interpretBrief(c,response('blue','span_1'));
 expect(r.answers).toEqual({setting:{kind:'choice',choiceId:'blue'},detail:{kind:'text',text:'Include a short explanation.'}});expect(r.unanswered).toEqual([]);
});
it('leaves unmentioned, custom and uncertain decisions unanswered',()=>{
 const c=compileBrief('Something else.',fields,'jev-1.13.0');expect(interpretBrief(c,response('__custom__','__not_mentioned__')).unanswered.map(x=>x.reason)).toEqual(['custom-detail','not-mentioned']);expect(interpretBrief(c,response('blue','span_0',0.5)).answers).toEqual({});
});
it('delegates only when explicitly selected and the form permits it',()=>{
 const c=compileBrief('Choose for me.',fields,'jev-1.13.0');expect(interpretBrief(c,response('__delegate__','__delegate__')).answers).toEqual({setting:{kind:'automatic'},detail:{kind:'automatic'}});
 const no=compileBrief('Choose for me.',[{...fields[0],allowAutomatic:false}],'jev-1.13.0');expect(no.request.questions.field_0.criteria.__delegate__).toBeUndefined();
});

import {applyInterpretation,briefConflicts,emptyBrief} from '../../lib/configurator/brief';
import type {Configuration} from '../../lib/configurator/contracts';
const configured=()=>({schemaVersion:1,targets:{paper:8},lines:{q1:{marks:8,parts:null,facets:{}}},answers:{items:{q1:{setting:{kind:'choice',choiceId:'red'}}},paper:{}},briefs:{q1:emptyBrief('Use blue.')}} as Configuration);
it('fills only unanswered fields and asks before replacing an existing decision',()=>{
 const cfg=configured(),next=applyInterpretation(cfg,'q1',{setting:{kind:'choice',choiceId:'blue'},detail:{kind:'text',text:'Use blue.'}});
 expect(next.answers.items.q1.setting).toEqual({kind:'choice',choiceId:'red'});
 expect(next.answers.items.q1.detail).toEqual({kind:'text',text:'Use blue.'});
 expect(briefConflicts(next.briefs!.q1,next.answers.items.q1)).toEqual(['setting']);
 expect(next.briefs!.q1.text).toBe('Use blue.');expect(cfg.answers.items.q1.detail).toBeUndefined();
});
it('keeps an explicit resolution on an identical retry but reopens it after the paragraph changes',()=>{
 const suggestion={setting:{kind:'choice',choiceId:'blue'}} as const;
 const cfg=applyInterpretation(configured(),'q1',suggestion);cfg.briefs!.q1.resolutions.setting='choice';
 expect(briefConflicts(applyInterpretation(cfg,'q1',suggestion).briefs!.q1,cfg.answers.items.q1)).toEqual([]);
 cfg.briefs!.q1.text='Definitely use blue.';
 expect(briefConflicts(applyInterpretation(cfg,'q1',suggestion).briefs!.q1,cfg.answers.items.q1)).toEqual(['setting']);
});
