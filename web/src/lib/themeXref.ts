/**
 * 伺服器端(build 時)讀取 web/public/data/theme-xref.json(由 build-map-index.mjs 產生),
 * 取出「單一個股所屬的投資題材」供報告頁「所屬投資題材」區塊使用。模組層快取。
 * 檔案缺失或查無 → 回傳空陣列。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

let cache: { byTicker: Record<string, { slug: string; title: string }[]> } | null | undefined;

function load() {
  if (cache !== undefined) return cache;
  cache = null;
  try {
    const file = path.join(process.cwd(), "public", "data", "theme-xref.json");
    if (existsSync(file)) cache = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    cache = null;
  }
  return cache;
}

/** 該代號所屬的投資題材(/map);查無回傳空陣列。 */
export function themesForTicker(ticker: string): { slug: string; title: string }[] {
  const j = load();
  return (j && j.byTicker && j.byTicker[ticker]) || [];
}

/* ──────────────────────────────────────────────────────────────────────
   個股 → 所屬【產業價值鏈】(TPEx)

   🔴 2026-10-11:砍掉 51 個機械衍生題材後,「所屬投資題材」在 1,152 檔上
      會是空的(其中 78 檔是這次新造成的)。原本的寫法是**整塊靜默消失** ——
      那在畫面上與「這個功能不存在」沒有差別。
      改成說出來,並給一條出路:它所屬的產業鏈。

   ⚠️ 這是產業【價值鏈】(/sectors/chain/*),不是報告頁 hero 的研究分類
      (/sectors/*)—— 兩者來源不同,不可混用。
   ────────────────────────────────────────────────────────────────────── */
let xrefCache: { industriesByTicker?: Record<string, { slug: string; title: string }[]> } | null | undefined;

function loadXref() {
  if (xrefCache !== undefined) return xrefCache;
  xrefCache = null;
  try {
    const file = path.join(process.cwd(), "public", "data", "sector-theme-xref.json");
    if (existsSync(file)) xrefCache = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    xrefCache = null;
  }
  return xrefCache;
}

/** 該代號所屬的產業價值鏈;查無回傳空陣列(呼叫端據此改講法,不要留白)。 */
export function industriesForTicker(ticker: string): { slug: string; title: string }[] {
  const j = loadXref();
  return (j && j.industriesByTicker && j.industriesByTicker[ticker]) || [];
}
