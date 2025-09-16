// middleware.ts
import { NextResponse } from 'next/server';

export const config = { matcher: ['/api/:path*'] };

export default async function middleware(req: Request) {
  // ✅ 設定 DISABLE_RATE_LIMIT=1 時，直接放行
  if (process.env.DISABLE_RATE_LIMIT === '1') {
    return NextResponse.next({
      headers: { 'x-rate-limit-bypass': '1', 'cache-control': 'no-store' },
    });
  }

  // 你原本的免費次數/額度檢查（保留，但現在不會觸發）
  // e.g. 讀 cookie/ip → 計數 → 超過就回 429
  // return new NextResponse(JSON.stringify({ error: "已超過今日免費 5 次..." }), { status: 429 });
}
