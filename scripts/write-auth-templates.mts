// Regenerates the Supabase authentication email templates from the shared email
// shell. Run: node scripts/write-auth-templates.mts. A unit test keeps the
// committed files identical to this output. Copying them into the hosted
// project is a separate, authorised step (see EMAIL.md).
import { writeFileSync } from 'node:fs';
import { authTemplate } from '../lib/email/templates.ts';
for (const type of ['confirmation', 'recovery'] as const) writeFileSync(`supabase/templates/${type}.html`, authTemplate(type));
console.log('Wrote supabase/templates/confirmation.html and recovery.html');
