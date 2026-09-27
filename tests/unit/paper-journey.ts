import { screen } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
type User=ReturnType<typeof userEvent.setup>;
/** Navigation through the paper journey as a teacher would: catalogue → builder → review. */
export async function openBuilder(user:User){await user.click(screen.getByRole('button',{name:/Open paper builder/}));}
export async function openReview(user:User){
  if(!screen.queryByRole('button',{name:/Review and pay/})) await openBuilder(user);
  await user.click(screen.getByRole('button',{name:/Review and pay/}));
  await screen.findByRole('heading',{name:'Review and pay'});
}
export const payButton=()=>screen.getByRole('button',{name:'Pay with Stripe · R100'});
export async function toPayment(user:User){if(!screen.queryByRole('button',{name:'Pay with Stripe · R100'}))await openReview(user);return payButton();}
