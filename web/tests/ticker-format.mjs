#!/usr/bin/env node
/**
 * 代號樣式 —— TS ↔ SQL 不得漂移、持股路徑不得殘留舊樣式
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 起因:輪 7 把 `/^\d{4}$/` 記成「已知界限、現在全是 4 碼所以不擋」。
 *      六週後使用者買了 `00646` / `009816`,**沒有人動過那行程式,它自己過期了**。
 *
 * 🔴 所以這個檔要做的不是「驗 regex 對不對」(那太容易),而是:
 *      ① TS 的 TICKER_PATTERN 與 SQL migration 裡的樣式【逐字相同】
 *      ② 持股路徑的八個檔案不得殘留舊 regex 字面值
 *      ③ 「接受範圍」與「.TW 後綴路由範圍」是兩個不同的判準(BDRY 回歸)
 *
 * 🔴 每條檢查都配一條【對照】:證明它在該紅的時候會紅。
 *    (空集合上的 every() 恆真;檔案讀不到的掃描也恆真。)
 *
 * 用法:npx tsx tests/ticker-format.mjs
 * ══════════════════════════════════════════════════════════════════════════
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TICKER_PATTERN,
  TICKER_RE,
  isValidTicker,
  isTwSuffixCandidate,
  isTwTicker,
  qtyUnitOf,
  DEFAULT_QTY_UNIT,
  TICKER_QTY_UNIT,
} from "../src/lib/tickerFormat.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "..");
const REPO = path.resolve(WEB, "..");

/** 🔴 預先宣告的檢查數。數不對就紅 —— 前四輪抓到我自己數錯三次。 */
const PLAN = 100;

let pass = 0;
const fails = [];
const ok = (cond, label) => {
  if (cond) pass++;
  else fails.push(label);
};

/* ══════════════════════════════════════════════════════════════════════
   ① 樣式本身的行為
   ════════════════════════════════════════════════════════════════════ */

// 真實存在的台股代號形狀,全部必須收
const ACCEPT = [
  ["2330", "普通股 4 碼"],
  ["2891A", "特別股 4 碼 + 字母"],
  ["0050", "ETF 前導零"],
  ["00646", "ETF 5 碼 —— 使用者實際持有,舊樣式擋掉"],
  ["009816", "ETF 6 碼 —— 使用者實際持有,舊樣式擋掉"],
  ["00632R", "反向 ETF"],
  ["AU9901", "黃金現貨,字母開頭 —— 使用者實際持有"],
  ["910322", "TDR 6 碼"],
];
for (const [t, why] of ACCEPT) ok(isValidTicker(t), `應接受 ${t}(${why})`);

// 必須擋掉的 —— 其中前四個是「別變成任意 URL 轉發」那道閘
const REJECT = [
  ["00646.TW", "含 . → 可改變 Yahoo 的符號/路徑語意"],
  ["2330/../x", "含 / → 路徑穿越形狀"],
  ["a?b=c", "含 ? = → query 注入形狀"],
  ["1234567", "7 碼,超過長度上限"],
  ["123", "3 碼,不足"],
  ["", "空字串"],
  ["2330 ", "尾端空白 —— 未正規化就不該收"],
  ["au9901", "小寫 —— 正規化在輸入端做,儲存形式唯一"],
  ["2330\n2317", "換行 —— PG 的 $ 不可以放行這個"],
];
for (const [t, why] of REJECT) ok(!isValidTicker(t), `應拒絕 ${JSON.stringify(t)}(${why})`);

// 非字串
ok(!isValidTicker(null), "應拒絕 null");
ok(!isValidTicker(2330), "應拒絕數字 2330(型別)");
ok(!isValidTicker(undefined), "應拒絕 undefined");

/* 🔴 對照:證明這批斷言確實在測「放寬」這件事。
      ⚠️ 而且要分清楚【是哪一層擋住哪一檔】—— 我第一版把這件事寫錯了:
         舊的兩層判準**本來就不一致**,所以「被擋」的原因每檔不同。

           檔案         DB  ^[0-9]{4}[0-9A-Z]?$     報價層 /^\d{4}$/
           2330              收                      收
           00646             收 ← 進得了資料庫        擋 ← 查不到價
           009816            擋 ← 連存都存不進        擋
           AU9901            擋                      擋

      所以使用者看到的症狀不一樣:00646 有持倉、沒市值;009816 / AU9901
      連交易都寫不進去。合併成一句「舊樣式擋掉這三檔」是錯的。 */
const OLD_DB_RE = /^[0-9]{4}[0-9A-Z]?$/;
const OLD_PRICE_RE = /^\d{4}$/;

ok(OLD_DB_RE.test("00646"), "對照:舊 DB 樣式其實收得下 00646(擋它的是報價層,不是 DB)");
ok(!OLD_DB_RE.test("009816"), "對照:舊 DB 樣式擋掉 009816(6 碼)");
ok(!OLD_DB_RE.test("AU9901"), "對照:舊 DB 樣式擋掉 AU9901(字母開頭)");
ok(OLD_DB_RE.test("2330"), "對照:舊 DB 樣式本來就收 2330(不是整條壞掉)");

ok(!OLD_PRICE_RE.test("00646"), "對照:舊報價層判準擋掉 00646 → 有持倉卻沒市值");
ok(!OLD_PRICE_RE.test("00632R"), "對照:舊報價層判準擋掉 00632R");
ok(OLD_PRICE_RE.test("2330"), "對照:舊報價層判準本來就收 2330");

/* ══════════════════════════════════════════════════════════════════════
   ② 接受範圍 ≠ .TW 後綴路由範圍(BDRY 回歸)
   ════════════════════════════════════════════════════════════════════ */

// 這些要走 .TW / .TWO
for (const t of ["2330", "2891A", "0050", "00646", "009816", "00632R", "910322"]) {
  ok(isTwSuffixCandidate(t), `應走 .TW 後綴:${t}`);
}

/* 🔴 核心回歸:/api/quote-batch 是混載通道,同時載美股與商品符號。
      `BDRY` 通過 isValidTicker,但它是美股 ETF —— 若拿 isValidTicker 當路由判準,
      會被劫持去問 BDRY.TW / BDRY.TWO,兩個都 404,新聞頁海運報價消失。 */
ok(isValidTicker("BDRY"), "前提:BDRY 確實通過 isValidTicker(所以這個洞是真的)");
ok(!isTwSuffixCandidate("BDRY"), "🔴 BDRY 不得走 .TW 後綴(新聞頁海運 ETF)");
ok(!isTwSuffixCandidate("AAPL"), "AAPL 不得走 .TW 後綴");
ok(!isTwSuffixCandidate("GC=F"), "GC=F 不得走 .TW 後綴");
ok(!isTwSuffixCandidate("^TWOII"), "^TWOII 不得走 .TW 後綴");
ok(!isTwSuffixCandidate("AU9901"), "AU9901 走原樣路徑(Yahoo 兩種後綴都 404,屬「尚未接上價格來源」)");

/* ══════════════════════════════════════════════════════════════════════
   ②b 語意閘:放寬存取範圍 ≠ 放寬「什麼算一檔股票」
   ════════════════════════════════════════════════════════════════════ */

/* 🔴 這組是放寬時**差點弄丟的守衛**。匯入來源是 Excel 複製,
      表格下方的合計列長成 `TOTAL` / `CASH`;它們通得過 ^[0-9A-Z]{4,6}$。
      每條都配「存取閘會收」的前提 —— 否則看不出語意閘到底擋住了什麼。 */
for (const junk of ["TOTAL", "CASH", "NULL", "TSMC"]) {
  ok(isValidTicker(junk), `前提:${junk} 通得過存取閘(所以語意閘非有不可)`);
  ok(!isTwTicker(junk), `🔴 ${junk} 不得被當成一檔台股`);
}
ok(isTwTicker("AU9901"), "AU9901 是具名例外:語意閘要收(使用者實際持有)");
ok(!isTwSuffixCandidate("AU9901"), "AU9901 仍不走 .TW 後綴(語意閘 ≠ 路由閘)");
for (const t of ["2330", "00646", "009816", "00632R", "2891A"]) {
  ok(isTwTicker(t), `語意閘收 ${t}`);
}

/* 三閘的包含關係:路由閘 ⊆ 語意閘 ⊆ 存取閘。
   任何一個方向反了,就代表某處的「代用」是安全的錯覺。 */
const SAMPLE = [
  "2330", "2891A", "0050", "00646", "009816", "00632R", "AU9901", "910322",
  "BDRY", "AAPL", "TOTAL", "CASH", "NULL", "TSMC", "GC=F", "^TWOII", "123", "1234567",
];
ok(
  SAMPLE.every((s) => !isTwSuffixCandidate(s) || isTwTicker(s)),
  "包含關係:路由閘 ⊆ 語意閘"
);
ok(
  SAMPLE.every((s) => !isTwTicker(s) || isValidTicker(s)),
  "包含關係:語意閘 ⊆ 存取閘"
);
/* 🔴 對照:三閘若其實是同一個判準,上面兩條也會全綠(⊆ 在相等時成立)。
      所以必須證明它們**真的不同**:存在只被外層收的樣本。 */
ok(
  SAMPLE.some((s) => isValidTicker(s) && !isTwTicker(s)),
  "對照:存取閘嚴格大於語意閘(存在 TOTAL 這種樣本)"
);
ok(
  SAMPLE.some((s) => isTwTicker(s) && !isTwSuffixCandidate(s)),
  "對照:語意閘嚴格大於路由閘(存在 AU9901 這種樣本)"
);

/* ══════════════════════════════════════════════════════════════════════
   ②c 數量單位:不是每一檔都是「股」
   ════════════════════════════════════════════════════════════════════ */

/* 🔴 `AU9901` 是黃金現貨,單位是台兩。把 3 顯示成「3 股」是說了一件假話,
      而且是讀的人不會起疑的那種 —— 沒有任何畫面會因此報錯。 */
ok(qtyUnitOf("AU9901") === "台兩", "AU9901 的單位是台兩,不是股");
ok(qtyUnitOf("2330") === DEFAULT_QTY_UNIT, "一般個股用預設單位");
ok(qtyUnitOf("00646") === DEFAULT_QTY_UNIT, "ETF 用預設單位");
ok(DEFAULT_QTY_UNIT === "股", "預設單位釘死為「股」(改它要同時改顯示端)");
/* 這張表只收【例外】。混進一個等於預設的項目,顯示端的「只在非預設時附加」就失效 */
ok(
  Object.values(TICKER_QTY_UNIT).every((u) => u !== DEFAULT_QTY_UNIT),
  "例外表裡不得出現與預設相同的單位"
);
ok(
  Object.keys(TICKER_QTY_UNIT).length > 0 &&
    Object.keys(TICKER_QTY_UNIT).every((t) => isTwTicker(t)),
  "例外表的鍵都是合法台股代號(非空,否則這條恆真)"
);

/* ══════════════════════════════════════════════════════════════════════
   ③ TS ↔ SQL 漂移守衛 —— **暫時沒有 SQL 那一側**
   ════════════════════════════════════════════════════════════════════

   原本這裡讀 `supabase/migrations/…widen_ticker_check.sql`,逐字比對
   `TICKER_PATTERN`,並拿「變異後的樣式」當對照證明比對有鑑別力。

   🔴 2026-10-10:那份 migration 隨 `/trades` 一起停在 `wip/trades-unpriced`
      分支(退役評估中,刻意不套到線上)。**沒有消費端就沒有可比對的東西** ——
      留一個讀不到檔案、永遠紅或永遠綠的檢查,比沒有檢查更糟。

   ⚠️ **重訪條件:只要台股代號樣式再次出現在 SQL 那一側**
      (`/trades` 復活,或任何新的 DB check 用到它),這一節要補回來。
      樣式散在多處而沒有漂移守衛,正是 2026-10-09 那次「八處各寫一份、
      各自長歪」的成因。
   ════════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════════
   ④ 持股路徑不得殘留舊 regex;研究路徑【刻意】保留 4 碼
   ════════════════════════════════════════════════════════════════════ */

/** 舊樣式的 regex【字面值】形式。只抓程式碼,不抓說明文字(說明文字沒有前後斜線)。 */
const OLD_LITERALS = [/\/\^\\d\{4\}\$\//, /\/\^\[0-9\]\{4\}\[0-9A-Z\]\?\$\//];

/**
 * 報價路徑:「使用者指定的代號 → 取價」會流經這些檔案 → 必須用 tickerFormat。
 *
 * 🔴 2026-10-10 重排:`/trades` 那幾檔(importParse / tradesApp / equity / corp-events)
 *    已不在這條路上(該頁退役評估中,相關改動停在 `wip/trades-unpriced` 分支)。
 *    進來的是**自選那條路**:自選要放得下 ETF,`00646` 得先存得進去、再取得到價。
 *
 * 每個都附一個「錨點字串」,錨點不在就代表我拿錯檔案或檔案被改名,
 * 那要紅在「找不到錨點」,而不是靜悄悄地通過「沒有舊 regex」。
 */
const QUOTE_PATH = [
  ["src/lib/priceCache.ts", "suffixOrder"],
  ["src/pages/api/bars/[ticker].ts", "getBars"],
  ["src/pages/api/quote-batch.ts", "quoteTwBySuffix"],
  /* 自選那條路上的六道關裡,這三道是「代號樣式」性質的 */
  ["src/pages/api/quote-mini/[ticker].ts", "getMiniQuote"],
  ["src/lib/watchlist.ts", "tw:watchlist"],
  ["src/pages/compare.astro", "cmp-excluded"],
];
for (const [rel, anchor] of QUOTE_PATH) {
  const full = path.join(WEB, rel);
  let txt = "";
  try {
    txt = fs.readFileSync(full, "utf8");
  } catch {
    /* 下面兩條會紅 */
  }
  ok(txt.includes(anchor), `報價路徑 ${rel}:錨點「${anchor}」存在(確認檔案真的讀到)`);
  ok(
    txt.length > 0 && !OLD_LITERALS.some((re) => re.test(txt)),
    `報價路徑 ${rel}:無舊代號 regex 字面值`
  );
}

/* 🔴 對照:掃描器必須抓得到。拿一段確定含舊字面值的文字餵它 ——
      若這條綠不起來,上面每一個「無舊 regex」就全是假陰性。 */
ok(
  OLD_LITERALS.some((re) => re.test("if (/^\\d{4}$/.test(x)) {")),
  "對照:掃描器抓得到 /^\\d{4}$/ 字面值"
);
ok(
  OLD_LITERALS.some((re) => re.test("const R = /^[0-9]{4}[0-9A-Z]?$/;")),
  "對照:掃描器抓得到舊樣式字面值"
);
ok(
  !OLD_LITERALS.some((re) => re.test("// 樣式 ^[0-9]{4}[0-9A-Z]?$ 已淘汰")),
  "對照:掃描器不誤抓說明文字(沒有斜線的敘述)"
);

/**
 * 研究路徑:這些過濾的是「有沒有個股報告 / 是不是熱力圖成分股」,
 * 覆蓋範圍本來就只有 4 碼普通股(Pilot_Reports 檔名是 XXXX_名稱.md)。
 * 🔴 **刻意不放寬**,而且要是哪天被順手放寬了,這裡要紅 —— 因為放寬它
 *    會讓 ETF 代號進到「找得到報告頁」的路徑,連到不存在的 /report/00646。
 *
 * 失效觸發條件:**若 Pilot_Reports 開始收錄非 4 碼標的**,這段要重訪。
 *
 * ⚠️ `watchlist.ts` 與 `compare.astro` 原本在這張表上(理由:★ 只出現在報告頁)。
 *    2026-10-10 移出 —— 自選加了手動輸入,ETF 進得來了,
 *    那個理由**不再成立**。清單上的項目要隨理由一起動,不是隨檔名。
 */
const RESEARCH_PATH = [
  ["src/lib/parseReport.ts", "報告解析:代號來自 Pilot_Reports 檔名"],
  ["src/lib/news-related.ts", "新聞關聯:只連到有報告的個股"],
  ["src/components/TodayThemes.astro", "首頁題材:成分股來自覆蓋範圍"],
  ["src/pages/map.astro", "投資題材:成分股來自覆蓋範圍"],
];
for (const [rel, why] of RESEARCH_PATH) {
  const txt = fs.readFileSync(path.join(WEB, rel), "utf8");
  ok(
    OLD_LITERALS.some((re) => re.test(txt)),
    `研究路徑 ${rel}:刻意保留 4 碼過濾(${why})`
  );
}

/* ══════════════════════════════════════════════════════════════════════
   ⑤ 自選那條路的六道關:每一關都要有一個會響的標記
   ════════════════════════════════════════════════════════════════════

   🔴 「有一個入口」不等於「有一條路」。`00646` 要出現在自選並顯示價格,
      中間有六道關,少開一道整條路就不通 —— 而且每一道的症狀都不一樣:

        關 1  watchlist.ts 讀取過濾        存得進、讀不出(加了卻不見)
        關 2  /api/quote-mini 守衛          在清單上、永遠沒有價
        關 3  沒有手動輸入框                 根本加不進去(★ 只在 4 碼列)
        關 4  名稱查 screener-index.json     有列但一片空白
        關 5  標題連 /report/00646           點下去 404
        關 6  /compare 靜默丟掉              自選 8 檔、比較只剩 5 檔

   下面用「原始碼裡的標記」當守衛。弱,但擋得住「順手刪掉」——
   而且每條都配錨點,檔案讀不到會紅在錨點而不是靜悄悄通過。
   ════════════════════════════════════════════════════════════════════ */

const GATES = [
  ["src/lib/watchlist.ts", "isTwTicker", "關 1:讀取過濾用語意閘"],
  ["src/pages/api/quote-mini/[ticker].ts", "isValidTicker", "關 2:取價守衛用存取閘"],
  ["src/pages/watchlist.astro", "wl-add-form", "關 3:手動輸入入口存在"],
  ["src/pages/watchlist.astro", "indexLoaded", "關 4:覆蓋判斷等 index 載入後才下(未載入不宣稱)"],
  ["src/pages/watchlist.astro", "wl__nocover", "關 5:未覆蓋標的有具名說明(不是靜默拿掉連結)"],
  ["src/pages/compare.astro", "renderExcluded", "關 6:比較頁具名排除"],
];
for (const [rel, marker, why] of GATES) {
  let txt = "";
  try {
    txt = fs.readFileSync(path.join(WEB, rel), "utf8");
  } catch {
    /* 下面會紅 */
  }
  ok(txt.length > 0, `${rel}:檔案讀得到(否則下一條沒有意義)`);
  ok(txt.includes(marker), `${why} —— ${rel} 含「${marker}」`);
}

/* 🔴 關 5 與關 6 的核心是「講出來」。只檢查有沒有連結是不夠的 ——
      靜默拿掉連結也會通過。所以檢查**說明文字本身**在不在。 */
{
  const wl = fs.readFileSync(path.join(WEB, "src/pages/watchlist.astro"), "utf8");
  ok(wl.includes("本站尚無此標的的個股報告"), "🔴 關 5:說明文字在(靜默拿掉連結也會通過前一條)");
  const cmp = fs.readFileSync(path.join(WEB, "src/pages/compare.astro"), "utf8");
  ok(cmp.includes("未納入比較"), "🔴 關 6:說明文字在");
  ok(cmp.includes("requested"), "關 6:保留 requested 清單(排除項不會在下一次 render 消失)");
}

/* 🔴 對照:標記檢查必須有鑑別力 —— 拿一個確定不存在的標記試一次。
      少了這條,上面每一條 includes 都可能只是因為字串太常見。 */
ok(!fs.readFileSync(path.join(WEB, "src/lib/watchlist.ts"), "utf8").includes("__NOT_PRESENT__"),
   "對照:不存在的標記確實找不到");

/* ══════════════════════════════════════════════════════════════════════ */
const total = pass + fails.length;
for (const f of fails) console.error(`  ✗ ${f}`);
if (total !== PLAN) {
  console.error(`\n✗ 檢查數 ${total} ≠ 宣告的 PLAN ${PLAN} —— 有檢查被漏掉或重複。`);
  process.exit(1);
}
if (fails.length) {
  console.error(`\n✗ ${fails.length}/${total} 失敗`);
  process.exit(1);
}
console.log(`✓ ticker-format:${pass}/${PLAN} 全過`);
