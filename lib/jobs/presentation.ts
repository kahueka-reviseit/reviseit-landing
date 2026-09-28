import { formatRand } from '../payments/contracts';
import { documentLabels, stateLabels, type DocumentName, type Order, type OrderPayment } from './contracts';

/**
 * Teacher-facing presentation of an order (Paper M1 to M4). Payment, question details
 * and documents are three separate facts derived only from the server's order record;
 * nothing here invents a date, count or percentage the server does not provide.
 */
export type Tone = 'done'|'progress'|'attention'|'problem'|'closed';
export type Group = 'needs-you'|'creating'|'ready'|'closed';
export type Fact = {tone:Tone; value:string; detail?:string};
export type NextStep = {label:string; kind:'primary'|'secondary'|'text'};

/** The five real server stages between submission and release, in order. */
export const stages = ['queued','generating','awaiting_memo_review','rendering','awaiting_release'] as const;
export const stageIndex = (state:string) => (stages as readonly string[]).indexOf(state);
const closedPayments = ['expired','failed','cancelled','refunded'];

export function paymentFact(payment:Order['payment'], internalTest=false):Fact {
  if(!payment) return internalTest?{tone:'closed',value:'No payment',detail:'Internal test order'}:{tone:'closed',value:'No payment recorded'};
  const test=payment.testMode?'Stripe test mode, no real charge':undefined;
  const amount=formatRand(payment.amountMinor);
  switch(payment.status){
    case 'paid': return payment.needsAttention
      ?{tone:'attention',value:`Paid · ${amount}`,detail:'Received after the checkout closed'}
      :{tone:'done',value:`Paid · ${amount}`,detail:test??'Confirmed by Stripe'};
    case 'creating': case 'open': return {tone:'attention',value:'Not paid yet',detail:test??'Checkout open'};
    case 'cancelled': return {tone:'closed',value:'Checkout cancelled',detail:'No payment taken'};
    case 'expired': return {tone:'closed',value:'Checkout expired',detail:'No payment taken'};
    case 'failed': return {tone:'closed',value:'Payment failed',detail:'No payment taken'};
    case 'refunded': return {tone:'closed',value:'Refunded',detail:'Paper closed'};
  }
}

export function isClosed(order:Pick<Order,'state'|'payment'>):boolean {
  return order.state==='cancelled' || (!!order.payment && closedPayments.includes(order.payment.status) && !['queued','generating','awaiting_memo_review','rendering','awaiting_release','released','held'].includes(order.state));
}
export const submitted = (state:string) => stageIndex(state)>=0 || state==='released' || state==='held';

/** Question details. `counts` is supplied only where the configuration was actually read. */
export function detailsFact(order:Pick<Order,'state'|'payment'>, counts?:{ready:number; total:number}):Fact {
  const of=counts?` · ${counts.ready} of ${counts.total}`:'';
  if(submitted(order.state)) return {tone:'done',value:`Submitted${counts?` · ${counts.total} of ${counts.total}`:''}`,detail:'Fixed when you submitted'};
  if(isClosed(order)) return {tone:'closed',value:'Not opened'};
  if(order.state==='awaiting_payment') return {tone:'closed',value:'Open after payment'};
  if(order.state==='awaiting_answers') return {tone:'attention',value:`In progress${of}`,detail:'Editable until you submit'};
  return {tone:'closed',value:'Not available'};
}

export function documentsFact(order:Pick<Order,'state'|'payment'|'documents'>):Fact {
  const i=stageIndex(order.state);
  if(order.state==='released') return {tone:'done',value:`Ready · ${order.documents.length} of 4`};
  if(order.state==='held') return {tone:'problem',value:'Stopped',detail:'Needs our attention · nothing released'};
  if(i>=0) return {tone:'progress',value:stateLabels[order.state],detail:`Stage ${i+1} of ${stages.length} · you can close this page`};
  if(isClosed(order)) return {tone:'closed',value:'Not created'};
  return {tone:'closed',value:'Not started',detail:'Creation begins when you submit'};
}

export type Row = {group:Group; status:{tone:Tone; label:string}; next:NextStep; stage:number};
export function listRow(order:Order):Row {
  const i=stageIndex(order.state);
  if(isClosed(order)) {
    const label=order.payment?.status==='refunded'?'Refunded':order.payment&&closedPayments.includes(order.payment.status)?paymentFact(order.payment).value:'Cancelled';
    return {group:'closed',status:{tone:'closed',label},next:{label:'View record',kind:'text'},stage:-1};
  }
  if(order.state==='held') return {group:'needs-you',status:{tone:'problem',label:'Needs our attention'},next:{label:'View details',kind:'text'},stage:-1};
  if(order.payment?.needsAttention) return {group:'needs-you',status:{tone:'attention',label:'Payment under review'},next:{label:'View details',kind:'text'},stage:-1};
  if(order.state==='awaiting_payment') return {group:'needs-you',status:{tone:'attention',label:'Not paid yet'},next:{label:'Continue to payment',kind:'secondary'},stage:-1};
  if(order.state==='awaiting_answers') return {group:'needs-you',status:{tone:'attention',label:'Needs you'},next:{label:order.configurable?'Finish details':'Answer questions',kind:'primary'},stage:-1};
  if(i>=0) return {group:'creating',status:{tone:'progress',label:'Being created'},next:{label:'View progress →',kind:'text'},stage:i};
  if(order.state==='released') return {group:'ready',status:{tone:'done',label:'Ready'},next:{label:'Download',kind:'secondary'},stage:stages.length};
  return {group:'closed',status:{tone:'closed',label:stateLabels[order.state]||'Status unavailable'},next:{label:'View record',kind:'text'},stage:-1};
}
const order:Group[]=['needs-you','creating','ready','closed'];
/** Needs you, then being created, then ready, then closed; the server's newest-first order inside each. */
export function groupOrders(orders:Order[]):{order:Order;row:Row}[] {
  return orders.map((o,i)=>({order:o,row:listRow(o),i})).sort((a,b)=>order.indexOf(a.row.group)-order.indexOf(b.row.group)||a.i-b.i).map(({order,row})=>({order,row}));
}

/** Title fallback: configured orders have no stored name, so show a generated summary; the start date sits in the meta line. */
export function paperTitle(order:Pick<Order,'title'|'createdAt'>, curriculum?:string):string {
  if(order.title && order.title!=='Catalogue paper') return order.title;
  return `${curriculum||'Catalogue'} paper`;
}
export function shortDate(iso:string):string {
  const d=new Date(iso);if(Number.isNaN(d.getTime())) return '';
  const [y,m,day]=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Johannesburg'}).format(d).split('-').map(Number);
  return `${day} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m-1]} ${y}`;
}

/** Journey steps shown on the paper page (M3, M4). */
export type Step = {label:string; state:'done'|'current'|'next'|'stopped'|'ready'};
export function journeySteps(order:Pick<Order,'state'|'payment'>):Step[] {
  const paid=order.payment?.status==='paid'||!order.payment;
  const i=stageIndex(order.state);
  const s=(label:string,state:Step['state']):Step=>({label,state});
  if(order.state==='released') return [s('Chosen','done'),s('Paid','done'),s('Details','done'),s('Created','done'),s('Ready','ready')];
  if(order.state==='held') return [s('Chosen','done'),s('Paid','done'),s('Details','done'),s('Stopped','stopped'),s('Ready','next')];
  if(i>=0) return [s('Chosen','done'),s('Paid','done'),s('Details','done'),s('Creating','current'),s('Ready','next')];
  if(order.state==='awaiting_answers'&&paid) return [s('Chosen','done'),s('Paid','done'),s('Details','current'),s('Created','next'),s('Ready','next')];
  return [s('Chosen','done'),s('Paid','current'),s('Details','next'),s('Created','next'),s('Ready','next')];
}

export const documentDescriptions:Record<DocumentName,{description:string;file:string;icon:'paper'|'memo'|'learner'|'teacher'}> = {
  paper:{description:'The paper your learners write, in the order you set.',file:'paper.docx',icon:'paper'},
  memo:{description:'Answers and mark allocation for marking. Check it before use.',file:'memo.docx',icon:'memo'},
  'learner-memo':{description:'Worked solutions to hand back to learners after the test.',file:'learner-memo.docx',icon:'learner'},
  'teacher-description':{description:'What each question covers, for you and your department.',file:'teacher-description.docx',icon:'teacher'},
};
export { documentLabels };
export type PaymentNotice = {tone:'progress'|'caution'|'success'|'neutral'|'problem'; title:string; body:string};

/** M2: one notice per payment situation. A return from checkout is never proof of payment. */
export function paymentNotice(order:Order, checking:boolean):PaymentNotice|null {
  const p=order.payment;if(!p) return null;
  if(order.state==='held') return {tone:'problem',title:'Your paper has stopped and needs our attention',body:`No partial documents have been released. You do not need to submit again.${p.status==='paid'?' Your payment is recorded; Revise It will contact you to complete the paper or refund you.':''}`};
  if(p.needsAttention) return {tone:'caution',title:'Your payment arrived after this checkout closed',body:'Your payment is recorded. Revise It will contact you to either refund it or complete your paper. You do not need to pay again.'};
  if(p.status==='refunded') return {tone:'neutral',title:'This payment was refunded. The paper is closed.',body:`Stripe recorded a full refund of ${formatRand(p.amountMinor)}. Your saved questions stay visible here for reference.`};
  if(p.status==='cancelled') return {tone:'neutral',title:'Checkout cancelled. No payment was taken.',body:'To try again, start a new paper from your curriculum.'};
  if(p.status==='expired') return {tone:'neutral',title:'Checkout expired. No payment was taken.',body:'To try again, start a new paper from your curriculum.'};
  if(p.status==='failed') return {tone:'neutral',title:'Payment failed. No payment was taken.',body:'To try again, start a new paper from your curriculum.'};
  if(order.state==='awaiting_payment'&&['creating','open'].includes(p.status)) return checking
    ?{tone:'progress',title:'Checking your payment with Stripe',body:`This usually takes a moment. Your questions and marks are saved with this checkout. ${order.configurable?'Question details open':'The questions open'} as soon as Stripe confirms the payment.`}
    :{tone:'caution',title:'We have not received a payment confirmation yet',body:`If you completed payment, check again in a moment. If you did not finish, you can return to the secure checkout.${order.configurable?' You can still adjust marks below.':''}`};
  if(order.state==='awaiting_answers'&&p.status==='paid') return {tone:'success',title:order.configurable?'Payment confirmed. Now describe each question.':'Payment confirmed. Now answer the questions below.',body:order.configurable?'Open any question to write what you want it to do, then press Configure to see what was understood. Marks, answers and order stay editable until you submit.':'Your answers are fixed for this request once you submit them.'};
  return null;
}
export type {OrderPayment};
