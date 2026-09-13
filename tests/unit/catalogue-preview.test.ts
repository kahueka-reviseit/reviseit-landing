import {test,expect} from 'vitest';
import {cataloguePreview} from '../../lib/workspace/contracts';
const valid={subquestions:{min:1,max:2},outline:[{summary:'Interpret a relationship',bloom:'Analyse',marks:{min:2,max:3}}]};
test('preview accepts named categories, optional marks and a range without an outline',()=>{
 expect(cataloguePreview(valid)).toEqual(valid);expect(cataloguePreview({subquestions:{min:2,max:5}})).toEqual({subquestions:{min:2,max:5}});
});
test.each([
 {...valid,parameter_questions:['PRIVATE_FORM']},
 {...valid,outline:[{...valid.outline[0],specification:'PRIVATE_SPEC'}]},
 {...valid,outline:[{...valid.outline[0],bloom:'L4'}]},
 {...valid,outline:[{...valid.outline[0],bloom:'Apply/Analyze'}]},
 {...valid,outline:[{...valid.outline[0],summary:''}]},
 {...valid,outline:[{...valid.outline[0],marks:{min:3,max:2}}]},
 {...valid,subquestions:{min:3,max:5}},
 {...valid,subquestions:{min:1.5,max:3}},
 {...valid,subquestions:{min:1,max:31}},
 {...valid,outline:null},null,{}
])('invalid or private preview fields fail closed: %j',value=>{expect(cataloguePreview(value)).toBeUndefined();});
