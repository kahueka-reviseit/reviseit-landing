import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { authConfig } from './lib/supabase/config';
import { safeNext } from './lib/auth/policy';
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const config = authConfig();
  if (config) {
    const supabase = createServerClient(config.url, config.key, { cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: values => {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    } });
    const { data: { user } } = await supabase.auth.getUser();
    // A signed-out visit to a teacher page (for example from an email link)
    // signs in first and then returns to the same validated page.
    const path = request.nextUrl.pathname;
    if (!user && request.method === 'GET' && /^\/(teacher|account)(\/|$)/.test(path) && safeNext(path)) {
      const login = new URL('/login', request.url);
      login.searchParams.set('next', path);
      const redirect = NextResponse.redirect(login);
      response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie));
      redirect.headers.set('Cache-Control', 'private, no-store');
      return redirect;
    }
  }
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}
export const config = { matcher: ['/login', '/register', '/forgot-password', '/reset-password', '/auth/:path*', '/account/:path*', '/teacher/:path*', '/admin/:path*', '/api/teacher/:path*'] };
