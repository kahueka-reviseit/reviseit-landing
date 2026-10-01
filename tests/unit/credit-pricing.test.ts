import {expect,test} from 'vitest';
import {pricePaper,formatRand} from '../../lib/credits/pricing';
test('founder price for the full pilot is R1950',()=>{expect(pricePaper(10,130)).toMatchObject({multipleChoiceMinor:50000,structuredMinor:145000,totalMinor:195000,currency:'zar'});});
test('smaller sections prorate and omitted sections cost nothing',()=>{
 expect(pricePaper(2,65).totalMinor).toBe(82500);
 expect(pricePaper(10,0).totalMinor).toBe(50000);
 expect(pricePaper(0,130).totalMinor).toBe(145000);
 expect(pricePaper(0,1).totalMinor).toBe(1115);
 expect(pricePaper(0,3).totalMinor).toBe(3346);
});
test('invalid and oversized inputs never produce a price',()=>{
 for(const pair of [[0,0],[11,10],[2,131],[-1,20],[1,1.5],[NaN,1],[1,Infinity]])expect(()=>pricePaper(...pair as [number,number])).toThrow();
});
test('money retains cents without binary rounding artefacts',()=>{expect(formatRand(3346)).toMatch(/33[,.]46/);expect(()=>formatRand(1.5)).toThrow();});
