// middleware.js
import { NextResponse } from 'next/server';

export const config = { matcher: ['/api/:path*'] };

export default function middleware(req) {
  // 設定 DISABLE_RATE_LIMIT=1 時，直接放行（用來暫時關掉每日上限）
  if (process.env.DISABLE_RATE_LIMIT === '1') {
    const res = NextResponse.next();
    res.headers.set('x-rate-limit-bypass', '1');
    res.headers.set('cache-control', 'no-store');
    return res;
  }

  // TODO: 你的原本限流/免費次數檢查可以放在這裡
  return NextResponse.next();
}
