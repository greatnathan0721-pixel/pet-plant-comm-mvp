import { NextResponse } from 'next/server';
export const config = { matcher: ['/api/:path*'] };
export default function middleware(req) {
  if (process.env.VERCEL_ENV !== 'production') {
    return NextResponse.next({ headers: { 'x-rate-limit-bypass': '1', 'cache-control': 'no-store' } });
  }
  // TODO: 這裡放你原本的限流邏輯（生產環境才跑）
  return NextResponse.next();
}
