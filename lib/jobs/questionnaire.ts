/** Closed teacher-visible form. Private source bindings never belong here. */
export type Choice = {id:string;label:string};
export type QuestionField = {id:string;label:string;hint:string;required:boolean;allowAutomatic:boolean} &
 ({type:'choice';choices:Choice[];allowOther:boolean}|{type:'text';maxLength:number});
export type Questionnaire = {schemaVersion:2;revision:string;items:{id:string;title:string;marks:number;fields:QuestionField[]}[];paperFields:QuestionField[]};
export type Answer = {kind:'choice';choiceId:string}|{kind:'text';text:string}|{kind:'automatic'}|{kind:'omit'};
export type QuestionnaireAnswers = {schemaVersion:2;revision:string;items:Record<string,Record<string,Answer>>;paper:Record<string,Answer>};
const idPattern=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const record=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const exact=(x:Record<string,unknown>,keys:string[])=>Object.keys(x).sort().join(',')===[...keys].sort().join(',');
const text=(x:unknown,max:number,min=1):x is string=>typeof x==='string'&&x.length>=min&&x.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(x);
const identifier=(x:unknown):x is string=>typeof x==='string'&&idPattern.test(x)&&!['__proto__','constructor','prototype'].includes(x);
function fields(value:unknown,max:number):value is QuestionField[]{
 if(!Array.isArray(value)||value.length>max)return false;
 const seen=new Set<string>();
 return value.every(f=>{
  if(!record(f)||!identifier(f.id)||seen.has(f.id)||!text(f.label,300)||!f.label.trim()||!text(f.hint,1500,0)||typeof f.required!=='boolean'||typeof f.allowAutomatic!=='boolean')return false;
  seen.add(f.id);
  const base=['id','label','hint','required','allowAutomatic','type'];
  if(f.type==='text')return exact(f,[...base,'maxLength'])&&Number.isSafeInteger(f.maxLength)&&Number(f.maxLength)>=1&&Number(f.maxLength)<=2000;
  if(f.type!=='choice'||!exact(f,[...base,'choices','allowOther'])||typeof f.allowOther!=='boolean'||!Array.isArray(f.choices)||f.choices.length<1||f.choices.length>30)return false;
  const choices=new Set<string>();
  return f.choices.every(c=>{
   if(!record(c)||!exact(c,['id','label'])||!identifier(c.id)||choices.has(c.id)||!text(c.label,300)||!c.label.trim())return false;
   choices.add(c.id);return true;
  });
 });
}
export function isQuestionnaire(v:unknown):v is Questionnaire{
 if(!record(v)||!exact(v,['schemaVersion','revision','items','paperFields'])||v.schemaVersion!==2||!text(v.revision,64)||!/^[a-f0-9]{64}$/.test(v.revision)||!Array.isArray(v.items)||v.items.length<1||v.items.length>30||!fields(v.paperFields,20))return false;
 let count=v.paperFields.length;const seen=new Set<string>();
 return v.items.every(item=>{
  if(!record(item)||!exact(item,['id','title','marks','fields'])||!identifier(item.id)||seen.has(item.id)||!text(item.title,160)||!item.title.trim()||!Number.isSafeInteger(item.marks)||Number(item.marks)<1||Number(item.marks)>100||!fields(item.fields,30)||!item.fields.length)return false;
  seen.add(item.id);count+=item.fields.length;return count<=200;
 });
}
export function isAnswer(value:unknown):value is Answer{
 if(!record(value))return false;
 if(value.kind==='automatic'||value.kind==='omit')return exact(value,['kind']);
 if(value.kind==='choice')return exact(value,['kind','choiceId'])&&identifier(value.choiceId);
 return value.kind==='text'&&exact(value,['kind','text'])&&text(value.text,2000,0);
}
export function isQuestionnaireAnswers(v:unknown):v is QuestionnaireAnswers{
 if(!record(v)||!exact(v,['schemaVersion','revision','items','paper'])||v.schemaVersion!==2||typeof v.revision!=='string'||!/^[a-f0-9]{64}$/.test(v.revision)||!record(v.items)||Object.keys(v.items).length>30||!record(v.paper)||Object.keys(v.paper).length>20)return false;
 let count=0;
 const section=(s:unknown)=>record(s)&&Object.keys(s).length<=30&&Object.entries(s).every(([k,a])=>{count++;return identifier(k)&&count<=200&&isAnswer(a);});
 return section(v.paper)&&Object.entries(v.items).every(([k,s])=>identifier(k)&&section(s))&&new TextEncoder().encode(JSON.stringify(v)).byteLength<=64000;
}
function matches(field:QuestionField,answer:Answer):boolean{
 if(answer.kind==='automatic')return field.allowAutomatic;
 if(answer.kind==='omit')return !field.required;
 if(answer.kind==='choice')return field.type==='choice'&&field.choices.some(c=>c.id===answer.choiceId);
 if(field.type==='choice')return field.allowOther&&!!answer.text.trim();
 return answer.text.length<=field.maxLength&&(!field.required||!!answer.text.trim());
}
export function answersMatchQuestionnaire(form:unknown,answers:unknown):boolean{
 if(!isQuestionnaire(form)||!isQuestionnaireAnswers(answers)||form.revision!==answers.revision)return false;
 const section=(fs:QuestionField[],as:Record<string,Answer>)=>exact(as,fs.map(f=>f.id))&&fs.every(f=>matches(f,as[f.id]));
 return exact(answers.items,form.items.map(i=>i.id))&&section(form.paperFields,answers.paper)&&form.items.every(i=>section(i.fields,answers.items[i.id]));
}
