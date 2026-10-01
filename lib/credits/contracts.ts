export type CreditMode='test'|'live';
export type CreditSource={id:string;kind:'purchase'|'offer'|'staff_grant'|'paid_invoice';remainingMinor:number;expiresAt:string|null;voidedAt:string|null};
export type CreditActivity={id:string;kind:'grant'|'purchase'|'claim'|'spend'|'return'|'void';amountMinor:number;createdAt:string;orderId:string|null};
export type CreditSummary={departmentId:string;mode:CreditMode;balanceMinor:number;canManage:boolean;canSpend:boolean;sources:CreditSource[];activity:CreditActivity[]};
export type DepartmentMember={userId:string;name:string;email:string;role:'teacher'|'head';canSpend:boolean;revision:number};
export function moneyInput(value:string):number|null {
 if(!/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(value.trim()))return null;
 const [whole,fraction='']=value.trim().split('.');const n=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 return Number.isSafeInteger(n)&&n>0&&n<=100000000?n:null;
}
