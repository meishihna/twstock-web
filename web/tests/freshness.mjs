#!/usr/bin/env node
/**
 * 資料新鮮度 —— 純函式測試
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 🔴 這組的重點不是「日期格式對不對」,是三條規則有沒有真的生效:
 *     ① 時鐘對準被描述的資料(這條在呼叫端,下面用來源欄位的掃描守衛)
 *     ② 量不到 → display 為 null,呼叫端整個不顯示(不可退回任何其他時鐘)
 *     ③ 過了門檻要主動說出「N 天前」
 *
 * 🔴 每條「會說」都配一條「不會亂說」的對照 —— 否則分不出
 *    「門檻有效」與「永遠都在喊舊」。
 *
 * 用法:npx tsx tests/freshness.mjs
 * ══════════════════════════════════════════════════════════════════════════
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { freshness, freshnessLabel, STALE_AFTER_DAYS } from "../src/lib/freshness.ts";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PLAN = 39 - 2 + 8 + 4; /* 靜態 39 行,其中 2 行在迴圈內(8 次 + 4 次) */
let pass = 0;
const fails = [];
const ok = (cond, label, detail = "") => {
  if (cond) pass++;
  else fails.push(`${label}   ${detail}`);
};

const NOW = new Date("2026-10-10T08:00:00Z");
const f = (iso, o = {}) => freshness(iso, { now: NOW, ...o });

/* ── ② 量不到就不要宣稱 ─────────────────────────────────────────── */
for (const bad of [null, undefined, "", "   ", "not-a-date", 12345, {}, NaN]) {
  const r = freshness(bad, { now: NOW });
  ok(r.display === null, `量不到 → display null:${JSON.stringify(bad)}`, JSON.stringify(r));
}
ok(freshness(null, { now: NOW }).stale === false, "🔴 量不到 → stale false(不知道不等於舊)");
ok(freshness(null, { now: NOW }).ageDays === null, "量不到 → ageDays null(不是 0)");
ok(freshnessLabel(freshness(null, { now: NOW }), "更新於") === null, "🔴 量不到 → 整行 null(不印空前綴)");

/* ── 門檻 ───────────────────────────────────────────────────────── */
ok(STALE_AFTER_DAYS === 3, "門檻釘死 = 3 天(放寬要同時改這個測試)", String(STALE_AFTER_DAYS));

const fresh = f("2026-10-10T06:00:00Z");
ok(fresh.ageDays === 0, "今天 → 0 天", String(fresh.ageDays));
ok(fresh.stale === false, "今天 → 不 stale");
ok(freshnessLabel(fresh, "更新於") === "更新於 2026-10-10", "新資料不加「N 天前」", String(freshnessLabel(fresh, "更新於")));

/* 🔴 邊界兩側都要驗 —— 只驗一邊看不出門檻是不是永遠成立 */
const d2 = f("2026-10-08T08:00:00Z");
const d3 = f("2026-10-07T08:00:00Z");
ok(d2.ageDays === 2 && d2.stale === false, "2 天 → 不 stale(門檻內)", JSON.stringify(d2));
ok(d3.ageDays === 3 && d3.stale === true, "3 天 → stale(門檻上)", JSON.stringify(d3));
ok(
  freshnessLabel(d3, "更新於") === "更新於 2026-10-07(3 天前)",
  "🔴 stale 時主動說出 N 天前",
  String(freshnessLabel(d3, "更新於"))
);

/* 真實案例:盤點時實際看到的四個數字 */
const cases = [
  ["2026-06-30T00:00:00Z", 102, "themes/*.md 策展日期"],
  ["2026-08-02T12:21:05Z", 68, "market-focus.json"],
  ["2026-07-27T18:40:41Z", 74, "news-digest.json"],
  ["2026-10-09T16:43:32Z", 0, "today-themes.json"],
];
for (const [iso, days, why] of cases) {
  const r = f(iso);
  ok(r.ageDays === days, `${why}:${days} 天前`, `實得 ${r.ageDays}`);
}
ok(f(cases[3][0]).stale === false, "對照:today-themes 是新的 → 不 stale(不是每個都喊舊)");
ok(f(cases[0][0]).stale === true, "對照:102 天的確實判 stale");

/* 未來時間:不該被當成「很新」而靜悄悄放過 */
const future = f("2026-12-01T00:00:00Z");
ok(future.ageDays != null && future.ageDays < 0, "未來時間 → ageDays 為負(看得出異常)", String(future.ageDays));
ok(future.stale === false, "未來時間 → 不判 stale(那是另一種病,不混為一談)");

/* withTime */
ok(f("2026-10-09T16:43:32Z", { withTime: true }).display === "2026-10-10 00:43", "withTime → 台北時區含時分", f("2026-10-09T16:43:32Z", { withTime: true }).display);
ok(f("2026-10-09T16:43:32Z").display === "2026-10-10", "預設只到日(台北時區)", f("2026-10-09T16:43:32Z").display);

/* 自訂門檻 */
ok(f("2026-10-09T08:00:00Z", { staleAfterDays: 1 }).stale === true, "自訂門檻 1 天 → 1 天前判 stale");
ok(f("2026-10-09T08:00:00Z", { staleAfterDays: 5 }).stale === false, "對照:同一筆在門檻 5 天下不判 stale");

/* ── ① 時鐘要對準被描述的資料:呼叫端掃描守衛 ───────────────────
   🔴 這是整組裡最重要的一條,而它只能靠掃描原始碼 ——
      「用錯時鐘」在單元測試裡看不出來(兩個時鐘都是合法日期)。 */
{
  const tt = fs.readFileSync(path.join(WEB, "src/components/TodayThemes.astro"), "utf8");
  ok(tt.length > 0, "TodayThemes 讀得到(否則下面沒有意義)");
  ok(
    !/const\s+src\s*=\s*fetchedAt\s*\|\|\s*gen/.test(tt),
    "🔴 TodayThemes 不得再用「報價抓取時間」當題材資料的時間戳"
  );
  ok(tt.includes("freshnessLabel"), "TodayThemes 走共用的新鮮度判定");

  const mp = fs.readFileSync(path.join(WEB, "src/pages/map.astro"), "utf8");
  ok(
    !/verifiedDate\s*=\s*fmtDate\(j\.generatedAt\)/.test(mp),
    "🔴 /map 的「核實」不得再用 map-index 的 generatedAt(那是部署時間)"
  );
  ok(mp.includes("t.curatedAt"), "/map 逐題材讀策展日期");

  /* 對照:掃描器抓得到它該抓的東西,否則上面兩條是假陰性 */
  ok(
    /const\s+src\s*=\s*fetchedAt\s*\|\|\s*gen/.test("      const src = fetchedAt || gen;"),
    "對照:掃描器抓得到舊寫法(報價時間當資料時間)"
  );
  ok(
    /verifiedDate\s*=\s*fmtDate\(j\.generatedAt\)/.test("        verifiedDate = fmtDate(j.generatedAt);"),
    "對照:掃描器抓得到舊寫法(generatedAt 當核實日期)"
  );
}

/* ── MarketFocus:產生者 + 卡片自己說真話,兩半都要在 ───────────── */
{
  const mf = fs.readFileSync(path.join(WEB, "src/components/MarketFocus.astro"), "utf8");
  ok(mf.length > 0, "MarketFocus 讀得到(否則下面恆真)");
  ok(mf.includes("data-mf-date"), "MarketFocus 把資料日期帶給前端");

  /* 🔴 「N 天前」必須在瀏覽器算:首頁是靜態產生的,
     在 frontmatter(--- 之間)算會把 build 當下的答案烘進 HTML。 */
  const fmEnd = mf.indexOf("---", mf.indexOf("---") + 3);
  const frontmatter = mf.slice(0, fmEnd);
  ok(fmEnd > 0, "找得到 frontmatter 範圍(否則下一條沒有意義)");
  ok(
    !/\bfreshness\s*\(/.test(frontmatter),
    "🔴 不得在 frontmatter(SSR)算新鮮度 —— 那會把 build 時間烘進靜態 HTML"
  );
  ok(/<script>[\s\S]*freshness/.test(mf.slice(fmEnd)), "新鮮度在 <script>(瀏覽器端)算");
  ok(/staleAfterDays:\s*STALE_DAYS/.test(mf) && /STALE_DAYS\s*=\s*6/.test(mf),
     "門檻 6 天(週五→週一是 3 天,用預設會每個週一誤報)");

  const wf = fs.readFileSync(path.join(WEB, "..", ".github/workflows/refresh-snapshots.yml"), "utf8");
  ok(wf.length > 0, "workflow 讀得到");
  ok(
    !wf.includes("已改由【官方】BFI82U + MI_MARGN 產出"),
    "🔴 那句不實註解已刪除(留著比沒有註解更糟)"
  );
  ok(wf.includes("build_market_focus.py"), "🔴 產生者真的接上 workflow(不是只寫在註解裡)");

  const prod = fs.readFileSync(path.join(WEB, "..", "scripts/build_market_focus.py"), "utf8");
  ok(prod.includes("BFI82U") && prod.includes("selectType=MS"), "產生者用的是實測過的兩個端點");
}

/* ── 題材檔都要有策展日期,否則 /map 的標籤會整排消失 ───────────── */
{
  const dir = path.join(WEB, "..", "themes");
  const files = fs.readdirSync(dir).filter((n) => n.endsWith(".md") && n !== "README.md");
  ok(files.length > 50, `themes/*.md 讀得到(${files.length} 檔,否則下一條恆真)`);
  const missing = files.filter((n) => !/\*\*策展日期:\*\*\s*\d{4}-\d{2}-\d{2}/.test(fs.readFileSync(path.join(dir, n), "utf8")));
  ok(missing.length === 0, "🔴 每個題材檔都有策展日期", `缺:${missing.slice(0, 5).join("、")}`);
}

/* ══════════════════════════════════════════════════════════════════════ */
const total = pass + fails.length;
for (const x of fails) console.error(`  ✗ ${x}`);
if (total !== PLAN) {
  console.error(`\n✗ 檢查數 ${total} ≠ 宣告的 PLAN ${PLAN}`);
  process.exit(1);
}
if (fails.length) {
  console.error(`\n✗ ${fails.length}/${total} 失敗`);
  process.exit(1);
}
console.log(`✓ freshness:${pass}/${PLAN} 全過`);
