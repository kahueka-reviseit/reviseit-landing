export function authConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const siteUrl = process.env.SITE_URL;
  if (!url || !key || !siteUrl) return null;
  try {
    const site = new URL(siteUrl);
    const provider = new URL(url);
    if (![site, provider].every(u => u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)))) return null;
    return { url: provider.origin, key, siteUrl: site.origin };
  } catch { return null; }
}
