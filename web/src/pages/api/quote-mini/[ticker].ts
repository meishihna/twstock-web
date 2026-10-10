import type { APIRoute } from "astro";
import { isValidTicker } from "../../../lib/tickerFormat";
import { getMiniQuote } from "../../../lib/priceCache";

export const prerender = false;

/**
 * 自選股小卡用:當日盤中分時走勢 + 最新報價 + 市場狀態。
 *   GET /api/quote-mini/2330
 *   -> { ticker, points:[…5分收盤], latest, prevClose, change, changePct, state, time }
 */
export const GET: APIRoute = async ({ params }) => {
  const ticker = params.ticker ?? "";
  // 🔴 關 2:原本的四碼樣式(`^\d{4}$`,不含斜線以免漂移掃描器誤判)
  //    擋掉 ETF(`00646` / `009816`)——
  //    `/watchlist` 正是走這條路取價,於是自選加得進去卻永遠顯示不出價。
  //    用存取閘(只保證不會變成任意 URL 轉發),路由由 priceCache 的後綴解析負責。
  if (!isValidTicker(ticker)) {
    return new Response(JSON.stringify({ error: "invalid_ticker" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  const q = await getMiniQuote(ticker);
  if (!q) {
    return new Response(JSON.stringify({ error: "no_data" }), {
      status: 404,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  return new Response(JSON.stringify({ ticker, ...q }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=120",
    },
  });
};
