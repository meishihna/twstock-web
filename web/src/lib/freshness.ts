/**
 * 資料新鮮度 —— **純函式**,給所有「頁面上宣稱某份資料有多新」的地方共用。
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 🔴 2026-10-10 的盤點翻出四處「頁面宣稱的新鮮度不是真的」,而它們是**同一個病**:
 *
 *   /map 題材卡「核實 YYYY-MM-DD」  用的是 map-index.json 的 generatedAt
 *                                  = prebuild 現生的【部署時間】。
 *                                  內容來源停在 2026-06,卡片天天顯示「今天」。
 *   TodayThemes「更新於 HH:MM」      用的是 /api/quote-batch 的 fetchedAt
 *                                  = 【報價抓取時間】,永遠是現在。
 *                                  today-themes.json 真的壞掉時它不會說。
 *   MarketFocus 三大法人/資券        資料停在 2026-07-31,卡片照常顯示。
 *   /news 每日簡報                   產生者 74 天沒跑,標題仍是「每日」。
 *
 * 共同的形狀:**用錯時鐘**。顯示的是「這個檔案/這次請求幾點發生」,
 * 而不是「這份資料的內容是什麼時候的」。
 *
 * 🔴 **一個每天都在動的數字掛著「核實」,比單純過期更嚴重 —— 它看起來永遠健康。**
 *    過期的資料至少會讓人起疑;自我刷新的時間戳不會。
 *
 * ── 三條規則 ────────────────────────────────────────────────────────
 *
 * ① **時鐘要對準被描述的那份資料。** 報價的時間不可以拿來替題材資料背書。
 * ② **量不到就不要宣稱。** 解析不出日期 → 回 `display: null`,呼叫端整個不顯示。
 *    退回「部署時間」「現在」或任何其他時鐘,都是把不知道講成知道。
 * ③ **過了門檻要主動說。** 日期可見不等於使用者讀得出它壞了 ——
 *    「2026-07-31」對多數人只是一個日期,「(70 天前)」才是一句話。
 * ══════════════════════════════════════════════════════════════════════════
 */

/** 預設門檻:每日更新的資料,超過 3 天就該主動說 */
export const STALE_AFTER_DAYS = 3;

export type Freshness = {
  /** 原始 ISO 字串;解析失敗為 null */
  iso: string | null;
  /** 台北時區的顯示字串;**解析失敗為 null(呼叫端必須整個不顯示)** */
  display: string | null;
  /** 距今幾天(無條件捨去);解析失敗為 null */
  ageDays: number | null;
  /** 是否已超過門檻。🔴 解析失敗時是 false —— 不知道不等於舊,也不等於新 */
  stale: boolean;
};

const TPE = "Asia/Taipei";

function fmt(d: Date, withTime: boolean): string {
  const date = new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: TPE,
  }).format(d);
  if (!withTime) return date;
  const time = new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TPE,
  }).format(d);
  return `${date} ${time}`;
}

export function freshness(
  raw: unknown,
  opts: { staleAfterDays?: number; now?: Date; withTime?: boolean } = {}
): Freshness {
  const none: Freshness = { iso: null, display: null, ageDays: null, stale: false };
  if (typeof raw !== "string" || !raw.trim()) return none;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return none;

  const now = opts.now ?? new Date();
  const ageDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  const limit = opts.staleAfterDays ?? STALE_AFTER_DAYS;
  return {
    iso: raw,
    display: fmt(d, opts.withTime ?? false),
    ageDays,
    /* 🔴 未來的時間(ageDays < 0)不算 stale,但也不該被當成「很新」而放過 ——
       那通常代表時區或產生者出錯。呼叫端若在意,看 ageDays。 */
    stale: ageDays >= limit,
  };
}

/**
 * 組出畫面上那一行。**解析不出來就回 null** —— 呼叫端據此整個不顯示,
 * 不可以印一個空的前綴(「更新於 」讀起來像壞掉,而不是像沒有資料)。
 *
 * ⚠️ 會用 textContent 直接進畫面 → 不可以寫 markdown 強調。
 */
export function freshnessLabel(f: Freshness, prefix: string): string | null {
  if (!f.display) return null;
  if (!f.stale || f.ageDays == null) return `${prefix} ${f.display}`;
  return `${prefix} ${f.display}(${f.ageDays} 天前)`;
}
