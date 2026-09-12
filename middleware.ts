import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { authConfig } from './lib/supabase/config';
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
    await supabase.auth.getUser();
  }
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}
export const config = { matcher: ['/login', '/register', '/forgot-password', '/reset-password', '/auth/:path*', '/account/:path*', '/teacher/:path*', '/admin/:path*', '/api/teacher/:path*'] };
