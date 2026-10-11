#!/usr/bin/env node
/**
 * 上線驗證 —— 推完之後,確認【線上真的換版了】,而且【函式真的跑得起來】
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 🔴 為什麼需要這支:
 *
 *    2026-10-01 ~ 10-11,Vercel 連續 19 次部署失敗,推的東西一件都沒上線。
 *    成因是 Vercel 停用 Node 20,而 `engines` 還釘在 `20.x`(Build Logs 原文:
 *    「Node.js Version "20.x" is discontinued and must be upgraded.」)——
 *    7 秒裡 5.7 秒在 clone,**根本沒進到 build**。
 *
 *    而網站一直正常 —— 它在服務 10/01 的 build。**部署失敗對訪客零症狀。**
 *    我們每一輪都走完「本機驗證 → build 綠 → 推」,
 *    而「推」與「上線」之間有一個**沒人看的缺口**,它開了十天。
 *
 * 🔴 判準不是「Vercel 顯示 Ready」—— 那是它自己的宣稱。
 *    判準是**線上真的有那段只有新版才有的文字**。
 *    (同「受測系統說它拒絕了 ≠ 拒絕留下了痕跡」。)
 *
 * ── 兩層要分開 ─────────────────────────────────────────────────────
 *
 *   第一層【內容】 build 完成、靜態內容換版了嗎
 *   第二層【執行期】serverless function 在新的 Node 上跑得起來嗎
 *
 *   `@astrojs/vercel` 還是 `^7.8.2`(目前 v8)。**build 綠不代表函式能跑** ——
 *   第一層全過、第二層掛掉是可能的,而且那是另一件事,不要混進同一個結論。
 *   → 退出碼分開:1 = 沒換版;3 = 換版了但函式掛了。
 *
 * ── 這支怎麼避免自己變成一個貌似通過的檢查 ────────────────────────
 *
 * ① **雙向**:新版字串要【在】,舊版字串要【不在】。
 *    只驗前者,「頁面抓不到」會長得像「舊版」;只驗後者,空白頁會通過。
 * ② **對照**:先驗一個新舊都有的字串(站名)。它不在 → 是站掛了 / 網址錯了,
 *    **那是另一種病**,退出碼 2。
 * ③ 🔴 **指紋要先拿舊版驗過**。第一版我放了 `tcat-pill`,它【通過】了 ——
 *    因為舊版的分類膠囊是 JS 產生的,那個 class 本來就在 bundle 裡。
 *    一條在舊版也成立的指紋,就是一條永遠綠的假檢查。
 *    驗法:對著【已知是舊版】的線上跑一次,**所有 MUST_HAVE 都該紅**。
 *
 * ⚠️ **範圍**:這支看的是伺服器送出的 HTML 與靜態資產。
 *    瀏覽器端才算得出來的東西(例如新鮮度的「N 天前」、收藏篩選)**驗不到**,
 *    那些要用瀏覽器。範圍寫在這裡,不要把這支的綠讀成「全部都好」。
 *
 * 用法
 *   node scripts/verify-deploy.mjs                      # 對正式站
 *   node scripts/verify-deploy.mjs --base http://localhost:4331
 * 退出碼:0 全過 · 1 沒換版 · 2 站台不可達 · 3 換版了但函式掛了
 * ══════════════════════════════════════════════════════════════════════════
 */
const argv = process.argv.slice(2);
const bi = argv.indexOf("--base");
const BASE = (bi >= 0 ? argv[bi + 1] : "https://my-twstock.vercel.app").replace(/\/$/, "");

const cache = new Map();
async function get(p) {
  if (cache.has(p)) return cache.get(p);
  let r;
  try {
    const res = await fetch(BASE + p, { redirect: "follow" });
    r = { ok: res.ok, status: res.status, body: await res.text() };
  } catch (e) {
    r = { ok: false, status: 0, body: "", err: String(e) };
  }
  cache.set(p, r);
  return r;
}
const json = (r) => {
  try {
    return JSON.parse(r.body);
  } catch {
    return null;
  }
};

const L1 = [];
const L2 = [];
const add = (arr, ok, label, detail = "") => arr.push({ ok, label, detail });

(async () => {
  console.log(`上線驗證  base = ${BASE}\n`);

  /* ── ② 對照:站台可達?(站掛了 ≠ 沒換版)──────────────────── */
  const home = await get("/");
  if (!home.ok || !home.body.includes("TWstock")) {
    console.error(
      `✗ 站台不可達或不是本站:/ HTTP ${home.status}${home.err ? ` (${home.err})` : ""}\n` +
        `  🔴 這是【站掛了 / 網址錯了】,不是【沒換版】—— 兩種病不要混為一談。`
    );
    process.exit(2);
  }
  console.log(`對照:站台可達(/ HTTP ${home.status})`);

  /* ══ 第一層:內容換版了嗎 ══════════════════════════════════ */

  // 1) 導覽收斂成四項
  const navBlock = (home.body.match(/<div class="nav-links"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || "";
  const navHrefs = [...navBlock.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  add(L1, navHrefs.length === 4, `導覽四項(實得 ${navHrefs.length})`, navHrefs.join(" "));
  for (const gone of ["/news", "/signals", "/research", "/trades"]) {
    add(L1, !navHrefs.includes(gone), `主導覽不含 ${gone}`);
  }
  add(L1, home.body.includes("footer-nav"), "頁尾次要導覽存在(移出導覽 ≠ 刪除)");

  // 2) 誠實化:時鐘對準被描述的資料
  add(L1, home.body.includes('data-prefix="題材資料"'), "TodayThemes 前綴改成「題材資料」");
  add(L1, !home.body.includes('data-prefix="更新於"'), "舊前綴「更新於」已消失(它印的是報價時間)");

  // 3) market-focus:有資料日期,且不是停擺時的 2026-07-31
  const mfDates = [...home.body.matchAll(/data-mf-date="(\d{4}-\d{2}-\d{2})"/g)].map((m) => m[1]);
  add(L1, mfDates.length >= 2, `market-focus 卡片帶資料日期(實得 ${mfDates.length} 個)`, mfDates.join(" "));
  add(L1, mfDates.length > 0 && !mfDates.includes("2026-07-31"), "market-focus 不再是 2026-07-31(產生者補回來了)", mfDates.join(" "));

  // 4) 砍題材:第三態說明 + 題材數 51
  const r2208 = await get("/report/2208");
  add(L1, r2208.ok && r2208.body.includes("本站尚未將此標的歸入任何投資題材"), "報告頁第三態說明(2208 台船)");
  /* 🔴 原本用 `href="/discover"` —— 它在舊版的【導覽】裡就有,所以永遠綠。
     第二個假指紋,同一個病:指紋要只有新版才有。改用新版才有的 class。 */
  add(L1, r2208.ok && r2208.body.includes("report-themes-none"), "第三態是說明不是整塊消失(report-themes-none)");
  const mapIdx = json(await get("/data/map-index.json"));
  const nThemes = mapIdx?.themes?.length ?? -1;
  add(L1, nThemes === 51, `題材數 = 51(實得 ${nThemes})`);

  // 5) 探索連通
  const semi = await get("/sectors/chain/semiconductor");
  add(L1, semi.ok && semi.body.includes("xref-chip"), "產業鏈 → 投資題材的交叉連結");
  add(L1, semi.ok && semi.body.includes('id="sc-hint"'), "成分股提示由狀態導出(有 id 供 JS 改寫)");
  add(L1, semi.ok && !semi.body.includes("↑ 點選上方產業鏈節點以查看成分股"), "舊提示已消失(成分股原本預設隱藏)");
  const trans = await get("/sectors/chain/transport-shipping");
  add(L1, trans.ok && trans.body.includes("目前沒有與此產業鏈重疊達門檻"), "0 相關題材會說出來(不靜默消失)");

  // 6) 自選放得下 ETF(介面那一半;取價在第二層)
  const wl = await get("/watchlist");
  add(L1, wl.ok && wl.body.includes("wl-add-form"), "自選股有手動輸入(ETF 進得來)");
  const etf = await get("/api/quote-mini/00646");
  add(L1, etf.ok && typeof json(etf)?.latest === "number", `ETF 取價 /api/quote-mini/00646 → HTTP ${etf.status}`,
      etf.status === 400 ? "舊版的 4 碼守衛還在(這是內容沒換版,不是函式壞了)" : "");

  // 7) 引擎交付:2026Q2
  const fin = json(await get("/data/financials/2330.json"));
  const lastQ = fin?.quarters?.p?.at(-1) ?? "(無)";
  add(L1, lastQ === "2026Q2", `財報末期 = 2026Q2(實得 ${lastQ})`);

  /* ══ 第二層:函式跑得起來嗎(分開報告)═══════════════════════ */
  /**
   * 🔴 第二層只放【新舊版都該通】的端點。
   *    第一版我把 `/api/quote-mini/00646` 放這裡,它在舊版回 400 ——
   *    但那不是「函式掛了」,是「ETF 放寬還沒上線」,那是第一層的症狀。
   *    混在一起會讓上線後的診斷指錯地方。
   */
  const apis = [
    ["/api/market-ticker", (j) => Array.isArray(j?.items) && j.items.length > 0],
    ["/api/quote-batch?symbols=2330", (j) => j?.quotes && typeof j.quotes["2330"]?.price === "number"],
    ["/api/bars/2330", (j) => Array.isArray(j?.bars) && j.bars.length > 0],
    ["/api/quote-mini/2330", (j) => typeof j?.latest === "number"],
  ];
  for (const [p, shape] of apis) {
    const r = await get(p);
    const j = json(r);
    add(L2, r.ok && shape(j), `${p} → HTTP ${r.status}${r.ok ? "" : ` ${r.err || ""}`}`,
        r.ok && !shape(j) ? "回了 200 但內容形狀不對" : "");
  }

  /* ── 報告 ─────────────────────────────────────────────────── */
  const show = (title, arr) => {
    console.log(`\n── ${title} ──`);
    for (const x of arr) console.log(`  ${x.ok ? "✓" : "✗"} ${x.label}${x.detail ? `   ${x.detail}` : ""}`);
  };
  show("第一層:內容是否換版", L1);
  show("第二層:serverless function 是否跑得起來", L2);

  const b1 = L1.filter((x) => !x.ok);
  const b2 = L2.filter((x) => !x.ok);
  console.log();
  if (b1.length) {
    console.error(`✗ 第一層 ${b1.length}/${L1.length} 不符 —— 線上【不是】目前這一版。`);
    console.error(`  🔴 不要用「Vercel 顯示 Ready」當判準;這支看的是線上實際的 HTML。`);
    if (b2.length) console.error(`  (第二層也有 ${b2.length} 項異常,但先修第一層 —— 沒換版時第二層驗的是舊函式。)`);
    process.exit(1);
  }
  console.log(`✓ 第一層 ${L1.length}/${L1.length} 全過 —— 線上確實是目前這一版`);
  if (b2.length) {
    console.error(`\n✗ 第二層 ${b2.length}/${L2.length} 異常 —— 內容上線了,但函式有問題。`);
    console.error(`  🔴 這是【另一件事】(@astrojs/vercel ^7.8.2 在新 Node 上的相容性),分開處理。`);
    process.exit(3);
  }
  console.log(`✓ 第二層 ${L2.length}/${L2.length} 全過 —— 函式也跑得起來`);
  console.log(`\n⚠️ 範圍:這支只看伺服器送出的 HTML 與靜態資產。` +
    `瀏覽器端才算得出來的(新鮮度的「N 天前」、收藏篩選、熱力圖)驗不到,那些要用瀏覽器。`);
})();
