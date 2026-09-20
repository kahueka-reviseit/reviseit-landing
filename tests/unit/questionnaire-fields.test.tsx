import {useState} from 'react';
import {render,screen,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe,it,expect} from 'vitest';
import QuestionnaireFields,{emptyQuestionnaireAnswers} from '../../lib/jobs/questionnaire-fields';
import {answersMatchQuestionnaire,type Questionnaire} from '../../lib/jobs/questionnaire';
const form:Questionnaire={schemaVersion:2,revision:'a'.repeat(64),items:[
 {id:'first',title:'First question',marks:8,fields:[{id:'setting',label:'Setting',hint:'Choose the reviewed setting.',required:true,allowAutomatic:false,type:'choice',allowOther:false,choices:[{id:'one',label:'First setting'}]}]},
 {id:'second',title:'Second question',marks:12,fields:[{id:'setting',label:'Setting',hint:'',required:false,allowAutomatic:true,type:'choice',allowOther:true,choices:[{id:'two',label:'Second setting'}]}]},
],paperFields:[{id:'notes',label:'Paper notes',hint:'',required:false,allowAutomatic:false,type:'text',maxLength:100}]};
function Harness({disabled=false}:{disabled?:boolean}){const [answers,setAnswers]=useState(emptyQuestionnaireAnswers(form));return <><QuestionnaireFields form={form} answers={answers} onChange={setAnswers} disabled={disabled}/><output data-testid="answers">{JSON.stringify(answers)}</output><output data-testid="valid">{String(answersMatchQuestionnaire(form,answers))}</output></>;}
describe('grouped teacher questionnaire controls',()=>{
 it('shows question titles and frozen marks without silently choosing answers',()=>{render(<Harness/>);expect(screen.getByRole('group',{name:'Question 1: First question (8 marks)'})).toBeInTheDocument();expect(screen.getByTestId('valid')).toHaveTextContent('false');expect(screen.getAllByRole('combobox').every(x=>(x as HTMLSelectElement).value==='')).toBe(true);});
 it('keeps identical field names independent and submits explicit shared preferences',async()=>{const user=userEvent.setup();render(<Harness/>);const selects=screen.getAllByRole('combobox');await user.selectOptions(selects[0],'choice:one');await user.selectOptions(selects[1],'automatic');await user.selectOptions(selects[2],'omit');expect(screen.getByTestId('valid')).toHaveTextContent('true');const answers=JSON.parse(screen.getByTestId('answers').textContent!);expect(answers.items.first.setting).toEqual({kind:'choice',choiceId:'one'});expect(answers.items.second.setting).toEqual({kind:'automatic'});expect(answers.paper.notes).toEqual({kind:'omit'});});
 it('shows own words and automatic choices only when permitted, and discards stale written text on selection change',async()=>{const user=userEvent.setup();render(<Harness/>);const selects=screen.getAllByRole('combobox');expect(within(selects[0]).queryByRole('option',{name:'Choose for me'})).toBeNull();expect(within(selects[0]).queryByRole('option',{name:'Write my answer'})).toBeNull();await user.selectOptions(selects[1],'text');await user.type(screen.getByRole('textbox'),'My setting');expect(screen.getByTestId('answers')).toHaveTextContent('My setting');await user.selectOptions(selects[1],'choice:two');expect(screen.queryByRole('textbox')).toBeNull();expect(screen.getByTestId('answers')).not.toHaveTextContent('My setting');});
 it('disables all fields while a submission is pending',()=>{render(<Harness disabled/>);for(const select of screen.getAllByRole('combobox'))expect(select).toBeDisabled();});
});
