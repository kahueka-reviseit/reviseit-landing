/**
 * Transactional email templates (Paper: Revise It Website, page 8 "Email journey";
 * Design System, Components 12 "Email"). Email clients ignore stylesheets and
 * variables, so the Paper tokens appear here as literal values on tables and
 * inline styles. Georgia and Arial are the intentional fallbacks when the brand
 * fonts are unavailable. No scripts, images, tracking pixels or attachments.
 *
 * Self-contained on purpose: `scripts/write-auth-templates.mts` imports it under
 * plain Node to regenerate the Supabase templates.
 */
export const TEMPLATE_VERSION = 'c09-1';

const color = {
  canvas: '#F8F6F0', card: '#FFFFFF', border: '#D5D1C8', rule: '#5B8A72', text: '#2D2D2D', muted: '#4A4A4A',
  action: '#436B56', onAction: '#FFFFFF', done: '#436B56', problem: '#B85042', problemText: '#802F25',
  problemTint: '#FCF0EE', account: '#3B5F8A', factsTint: '#F1F6F3', factsRule: '#D3E3DA', fallbackTint: '#F0EDE6',
};
const display = "'Playfair Display', Georgia, 'Times New Roman', serif";
const body = "'Source Sans 3', 'Source Sans Pro', Arial, Helvetica, sans-serif";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
/** Collapses whitespace and caps length so unusual stored names cannot distort the layout or subject. */
export function cleanText(value: unknown, max = 80): string {
  const s = typeof value === 'string' ? value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}
export function firstName(full: unknown): string {
  return cleanText(full, 160).split(' ')[0]?.slice(0, 40) || '';
}

type Tone = 'done' | 'problem' | 'account';
type Block =
  | { kind: 'documents'; items: string[] }
  | { kind: 'facts'; rows: [string, string][] }
  | { kind: 'notice'; title: string; body: string }
  | { kind: 'fallback'; url: string };
/**
 * Every field is plain text and is escaped here, except `action.href` and a
 * fallback `url`, which callers build from a fixed origin (or, for Supabase,
 * from its own template variables) and pass as trusted markup.
 */
export type Shell = {
  preheader: string; status: { tone: Tone; label: string }; title: string; paragraphs: string[];
  block?: Block; action: { label: string; href: string }; note: string; footer: string[];
};

const toneColor: Record<Tone, { dot: string; text: string }> = {
  done: { dot: color.done, text: color.done }, problem: { dot: color.problem, text: color.problemText }, account: { dot: color.account, text: color.account },
};
const p = (text: string, style: string) => `<p style="margin:0;${style}">${text}</p>`;

function block(b: Block): string {
  if (b.kind === 'documents') return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border-top:1px solid ${color.border};">${
    b.items.map(i => `<tr><td style="padding:12px 0;border-bottom:1px solid ${color.border};font-family:${body};font-size:15px;line-height:20px;font-weight:600;color:${color.text};">${escapeHtml(i)}</td></tr>`).join('')}</table>`;
  if (b.kind === 'facts') return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;background-color:${color.factsTint};border-radius:8px;"><tr><td style="padding:4px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${
    b.rows.map(([k, v], i) => `<tr><td style="padding:10px 0;${i < b.rows.length - 1 ? `border-bottom:1px solid ${color.factsRule};` : ''}font-family:${body};font-size:14px;line-height:20px;color:${color.muted};">${escapeHtml(k)}<br><span style="font-weight:600;color:${color.text};word-break:break-word;">${escapeHtml(v)}</span></td></tr>`).join('')}</table></td></tr></table>`;
  if (b.kind === 'notice') return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;background-color:${color.problemTint};border-left:3px solid ${color.problem};border-radius:6px;"><tr><td style="padding:14px 18px;">${
    p(escapeHtml(b.title), `font-family:${body};font-size:15px;line-height:20px;font-weight:600;color:${color.problemText};`)}${p(escapeHtml(b.body), `padding-top:4px;font-family:${body};font-size:14px;line-height:21px;color:${color.text};`)}</td></tr></table>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;background-color:${color.fallbackTint};border-radius:8px;"><tr><td style="padding:12px 16px;">${
    p('If the button does not work, copy this address into your browser:', `font-family:${body};font-size:13px;line-height:18px;color:${color.muted};`)}${p(b.url, `padding-top:4px;font-family:${body};font-size:13px;line-height:18px;color:${color.text};word-break:break-all;`)}</td></tr></table>`;
}

export function renderShell(s: Shell): string {
  const tone = toneColor[s.status.tone];
  const row = (inner: string, pad = '0 0 20px 0') => `<tr><td class="ri-pad" style="padding:${pad};">${inner}</td></tr>`;
  return `<!doctype html>
<html lang="en-ZA" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(s.title)}</title>
<style>
:root { color-scheme: light; supported-color-schemes: light; }
@media (max-width: 620px) {
  .ri-card { width: 100% !important; }
  .ri-inner { padding-left: 24px !important; padding-right: 24px !important; }
  .ri-title { font-size: 26px !important; line-height: 32px !important; }
  .ri-button, .ri-button tbody, .ri-button tr, .ri-button td, .ri-button a { display: block !important; width: 100% !important; text-align: center !important; box-sizing: border-box !important; }
  .ri-button a { padding-left: 12px !important; padding-right: 12px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background-color:${color.canvas};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(s.preheader)}${'&#8199;&#847;'.repeat(30)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${color.canvas};">
<tr><td align="center" style="padding:32px 12px;">
<table role="presentation" class="ri-card" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:${color.card};border:1px solid ${color.border};border-top:4px solid ${color.rule};border-radius:12px;border-collapse:separate;">
<tr><td class="ri-inner" style="padding:28px 40px 36px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${row(p('Revise It', `font-family:${display};font-size:22px;line-height:28px;font-weight:700;color:${color.text};`), '0 0 32px 0')}
${row(`<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="8" style="width:8px;"><div style="width:8px;height:8px;border-radius:4px;background-color:${tone.dot};font-size:0;line-height:0;">&nbsp;</div></td><td style="padding-left:8px;font-family:${body};font-size:13px;line-height:18px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:${tone.text};">${escapeHtml(s.status.label)}</td></tr></table>`)}
${row(`<h1 class="ri-title" style="margin:0;font-family:${display};font-size:30px;line-height:38px;font-weight:700;color:${color.text};">${escapeHtml(s.title)}</h1>`)}
${s.paragraphs.map(t => row(p(escapeHtml(t), `font-family:${body};font-size:16px;line-height:26px;color:${color.text};`))).join('\n')}
${s.block ? row(block(s.block), '4px 0 24px 0') : ''}
${row(`<table role="presentation" class="ri-button" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${color.action}" style="background-color:${color.action};border-radius:999px;"><a href="${s.action.href}" style="display:inline-block;padding:14px 28px;font-family:${body};font-size:16px;line-height:20px;font-weight:600;color:${color.onAction};text-decoration:none;border-radius:999px;">${escapeHtml(s.action.label)}</a></td></tr></table>`, '4px 0 20px 0')}
${row(p(escapeHtml(s.note), `font-family:${body};font-size:14px;line-height:22px;color:${color.muted};`), '0')}
</table>
</td></tr>
</table>
<table role="presentation" class="ri-card" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
<tr><td class="ri-inner" style="padding:20px 40px 0 40px;">
${s.footer.map(t => p(escapeHtml(t), `padding-bottom:6px;font-family:${body};font-size:13px;line-height:20px;color:${color.muted};`)).join('\n')}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}

export function renderText(s: Shell, href: string): string {
  const b = s.block;
  const extra = !b ? [] : b.kind === 'documents' ? b.items.map(i => `- ${i}`) : b.kind === 'facts' ? b.rows.map(([k, v]) => `${k}: ${v}`)
    : b.kind === 'notice' ? [b.title, b.body] : [];
  return [s.title, '', ...s.paragraphs.flatMap(t => [t, '']), ...(extra.length ? [...extra, ''] : []), `${s.action.label}: ${href}`, '', s.note, '', '--', ...s.footer].join('\n');
}

export type Rendered = { subject: string; preheader: string; html: string; text: string; templateVersion: string };
export type Kind = 'access_approved' | 'paper_ready' | 'paper_attention';
export type Metadata = { name?: unknown; school?: unknown; curriculum?: unknown; orderId?: unknown; email?: unknown };

export const COMPLETION_DOCUMENTS = ['Question paper', 'Teacher marking memorandum', 'Learner memorandum', 'Teacher description'];
const accountFooter = ['Questions? Reply to this email and it reaches the Revise It team.', 'You are receiving this service email because you have a Revise It teacher account. Revise It · Cape Town'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The only links: fixed pages on the configured teacher origin. Access is checked there. */
export function destination(kind: Kind, origin: string, orderId?: unknown): string {
  const base = new URL(origin);
  if (base.protocol !== 'https:' && base.hostname !== 'localhost' && base.hostname !== '127.0.0.1') throw new Error('Email origin must use https');
  if (kind === 'access_approved') return new URL('/teacher', base.origin).toString();
  if (typeof orderId !== 'string' || !uuid.test(orderId)) throw new Error('Order reference required');
  return new URL(`/teacher/orders/${orderId.toLowerCase()}`, base.origin).toString();
}

export function renderNotification(kind: Kind, meta: Metadata, origin: string): Rendered {
  const href = destination(kind, origin, meta.orderId);
  const name = firstName(meta.name), hello = name ? `Hello ${name}, ` : 'Hello, ';
  const curriculum = cleanText(meta.curriculum, 80), paper = curriculum ? `your ${curriculum} paper` : 'your paper';
  const ref = typeof meta.orderId === 'string' ? meta.orderId.slice(0, 8).toLowerCase() : '';
  let shell: Shell, subject: string;
  if (kind === 'paper_ready') {
    subject = 'Your paper is ready';
    shell = { preheader: `All four documents for ${paper} are ready to download.`, status: { tone: 'done', label: 'Ready · 4 of 4' }, title: 'Your paper is ready',
      paragraphs: [`${hello}all four documents for ${paper} are ready to download.`], block: { kind: 'documents', items: COMPLETION_DOCUMENTS },
      action: { label: 'View your documents', href: escapeHtml(href) },
      note: `Sign in with your school account to download them. Your documents stay private to your account. Reference ${ref}.`, footer: accountFooter };
  } else if (kind === 'paper_attention') {
    subject = 'Your paper needs our attention';
    shell = { preheader: 'Your paper stopped before it was finished. You do not need to submit it again.', status: { tone: 'problem', label: 'Needs our attention' },
      title: 'Your paper needs our attention', paragraphs: [`${hello}${paper} stopped before it was finished.`],
      block: { kind: 'notice', title: 'No documents were released', body: 'You do not need to submit your questions again. We will contact you about the next step.' },
      action: { label: 'View paper status', href: escapeHtml(href) }, note: `If you have a question, reply to this email and quote reference ${ref}.`, footer: accountFooter };
  } else {
    const school = cleanText(meta.school, 120), email = cleanText(meta.email, 254);
    const rows: [string, string][] = [...(school ? [['School', school] as [string, string]] : []), ...(email ? [['Sign in with', email] as [string, string]] : [])];
    subject = 'Your Revise It account is ready';
    shell = { preheader: 'Your school access is verified. You can now browse your curriculum and build a paper.', status: { tone: 'done', label: 'Account verified' },
      title: 'Welcome to Revise It', paragraphs: [`${hello}we have verified your school account. You can now browse your curriculum, choose questions and build a paper.`],
      block: rows.length ? { kind: 'facts', rows } : undefined,
      action: { label: 'Browse your curriculum', href: escapeHtml(href) }, note: 'If you did not expect this, reply to this email and we will look into it.', footer: accountFooter };
  }
  return { subject, preheader: shell.preheader, html: renderShell(shell), text: renderText(shell, href), templateVersion: TEMPLATE_VERSION };
}

/**
 * Supabase-owned authentication templates. Supabase keeps generating the token,
 * its expiry and delivery through Resend SMTP; these only replace the markup.
 * The links keep the tested token-hash route, which asks the person to press
 * Continue before the token is spent, so mail scanners cannot consume it.
 */
export function authTemplate(type: 'confirmation' | 'recovery'): string {
  const link = `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=${type === 'confirmation' ? 'signup' : 'recovery'}`;
  const footer = ['Questions? Write to kahueka@reviseit.io.'];
  if (type === 'confirmation') return renderShell({ preheader: 'One step before our team verifies your school account.', status: { tone: 'account', label: 'School email' },
    title: 'Confirm your school email', paragraphs: ['Please confirm that this is your school email address. After that, our team checks your school details before you can use the teacher workspace.'],
    block: { kind: 'fallback', url: link }, action: { label: 'Confirm school email', href: link },
    note: 'If you did not create a Revise It account, you can ignore this email.', footer: [...footer, 'You are receiving this because this address was used on the Revise It teacher sign-up page. Revise It · Cape Town'] });
  return renderShell({ preheader: 'Use this link to choose a new password. If you did not ask, ignore this email.', status: { tone: 'account', label: 'Password' },
    title: 'Reset your password', paragraphs: ['We received a request to reset the password for your Revise It teacher account.'],
    block: { kind: 'fallback', url: link }, action: { label: 'Choose a new password', href: link },
    note: 'If you did not ask for this, ignore this email. Your password stays the same. The link works once and expires soon.',
    footer: [...footer, 'You are receiving this because a password reset was requested for this address. Revise It · Cape Town'] });
}
