// middleware.js（MVP 期全放行）
import { NextResponse } from 'next/server';
export const config = { matcher: ['/api/:path*'] };
export default function middleware() {
  return NextResponse.next({ headers: { 'cache-control': 'no-store', 'x-rate-limit-bypass': '1' }});
}
