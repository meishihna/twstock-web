/**
 * 自選股(localStorage)。純前端;以台股代號字串陣列儲存。
 * 供報告頁收藏星號、/watchlist、/compare、/sectors/chain 共用。
 *
 * 🔴 **關 1(2026-10-10 放寬)**:讀取過濾原本是四碼樣式
 *    (`^\d{4}$`,這裡刻意不寫前後斜線 —— `tests/ticker-format.mjs` 的
 *    漂移掃描器只能靠斜線分辨「regex 字面值」與「敘述文字」),
 *    於是 `00646`(5 碼 ETF)、`009816`(6 碼)**存進去會在讀出來時被丟掉** ——
 *    靜默地丟掉,使用者只會看到「我加了但它不見了」。
 *
 * 改用 `isTwTicker`(語意閘:數字開頭 ∪ 具名例外),不是最寬的 `isValidTicker`
 * —— 後者是「不會變成任意 URL 轉發」的閘,`TOTAL` / `CASH` 都過得了。
 * 判準的職責分工見 `lib/tickerFormat.ts`。
 *
 * ⚠️ `discover.astro` 有一份 `is:inline` 的內聯副本(無法 import),
 *    它**不做任何過濾**。兩邊因此曾經不一致:discover 顯示 ★、`/watchlist` 卻看不到。
 *    放寬之後對合法代號已一致;改動這裡時要連那份一起看。
 */
import { isTwTicker } from "./tickerFormat";

const KEY = "tw:watchlist";

export function getWatchlist(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => isTwTicker(x)) : [];
  } catch {
    return [];
  }
}

export function setWatchlist(list: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...new Set(list)]));
  } catch {
    /* quota / privacy mode — ignore */
  }
}

export function hasWatch(ticker: string): boolean {
  return getWatchlist().includes(ticker);
}

/** 切換;回傳切換後是否已收藏 */
export function toggleWatch(ticker: string): boolean {
  const list = getWatchlist();
  const i = list.indexOf(ticker);
  if (i >= 0) {
    list.splice(i, 1);
    setWatchlist(list);
    return false;
  }
  list.push(ticker);
  setWatchlist(list);
  return true;
}

export function removeWatch(ticker: string): void {
  setWatchlist(getWatchlist().filter((x) => x !== ticker));
}
