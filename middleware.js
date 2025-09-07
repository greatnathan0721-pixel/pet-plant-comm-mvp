import { NextResponse } from 'next/server';

// 每日上限
const LIMITS = {
  text: 5,
  image: 5,
};

function getCookieOrInit(req, name, defaultVal) {
  const cookie = req.cookies.get(name);
  return cookie ? JSON.parse(cookie.value) : defaultVal;
}

export function middleware(req) {
  const url = req.nextUrl.pathname;

  if (url.startsWith('/api/chat') || url.startsWith('/api/analyze')) {
    const res = NextResponse.next();

    // 每日 key = yyyy-mm-dd
    const today = new Date().toISOString().slice(0, 10);

    // 根據 API 分類
    const type = url.includes('/api/chat') ? 'text' : 'image';

    // 取 cookie 中的紀錄
    const usage = getCookieOrInit(req, 'usage', { date: today, text: 0, image: 0 });

    // 新的一天 → 重置
    if (usage.date !== today) {
      usage.date = today;
      usage.text = 0;
      usage.image = 0;
    }

    // 檢查是否超限
    if (usage[type] >= LIMITS[type]) {
      return new NextResponse(
        JSON.stringify({ error: `已超過今日免費 ${LIMITS[type]} 次 ${type === 'text' ? '文字' : '圖片'} 使用上限` }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 增加使用次數
    usage[type] += 1;
    res.cookies.set('usage', JSON.stringify(usage), { path: '/' });

    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/chat', '/api/analyze', '/api/plant/identify'], // ⬅️ 新增這個
};

