// middleware.ts
import { NextResponse } from 'next/server';

// MVP 期間：不做任何限流/次數統計，直接放行
export function middleware() {
  return NextResponse.next();
}

// 仍只套在 API 路徑上（你也可改成 ['/:path*']）
export const config = {
  matcher: ['/api/:path*'],
};
