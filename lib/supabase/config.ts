export function authConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const siteUrl = process.env.SITE_URL;
  if (!url || !key || !siteUrl) return null;
  try {
    const site = new URL(siteUrl);
    const provider = new URL(url);
    const secure = (u: URL) => u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname));
    if (![site, provider].every(secure)) return null;
    // An optional separate administration origin (for example admin.reviseit.io)
    // served by the same deployment. Exact origins only; never a wildcard.
    const admin = process.env.ADMIN_SITE_URL ? new URL(process.env.ADMIN_SITE_URL) : null;
    if (admin && (!secure(admin) || admin.origin !== process.env.ADMIN_SITE_URL!.replace(/\/$/, ''))) return null;
    const trustedOrigins = [site.origin, ...(admin && admin.origin !== site.origin ? [admin.origin] : [])];
    return { url: provider.origin, key, siteUrl: site.origin, adminUrl: admin?.origin ?? null, trustedOrigins };
  } catch { return null; }
}
// Cookie-authenticated mutations require a browser request from one of our own
// configured origins. The hostname never grants any role by itself.
export function trustedOrigin(origin: string | null): boolean {
  const config = authConfig();
  return !!config && !!origin && config.trustedOrigins.includes(origin);
}
