#!/usr/bin/env node
/**
 * 探索連通 —— 產業 ↔ 題材的路走不走得通
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 2026-10-10 盤點指出三件,它們是同一件事:**探索的路是斷的**。
 *
 *   ① /sectors ↔ /map 兩個方向都【零連結】
 *      → 使用者看完上下游,沒有任何路徑能問「這些公司屬於哪些題材」
 *   ② /sectors/chain/* 進頁面時成分股【完全不顯示】(display:none),要先點節點
 *      → 探索頁的預設狀態是空的
 *   ③ 節點熱力圖磚是 <div> 不可點,而且【與可點的個股磚視覺相同】
 *      → 看起來能點、點了沒反應,比明顯不能點更糟
 *
 * 🔴 這三件的共同點:**改回去不會有人發現**。
 *    沒有畫面會壞、沒有錯誤會噴,只是路又斷了。所以要有會響的檢查。
 *
 * ⚠️ DOM 行為(點磚 → 篩選)本檔驗不到,那部分在瀏覽器實跑;
 *    這裡驗的是「那些讓它成立的東西還在不在」。範圍寫在這裡,不要讀成全部。
 *
 * 用法:npx tsx tests/explore-links.mjs
 * ══════════════════════════════════════════════════════════════════════════
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(WEB, "public", "data");

const PLAN = 34; /* 靜態 34 行,無迴圈 */
let pass = 0;
const fails = [];
const ok = (c, label, detail = "") => {
  if (c) pass++;
  else fails.push(`${label}   ${detail}`);
};

const read = (p) => fs.readFileSync(p, "utf8");

/* ── ① 交叉索引 ─────────────────────────────────────────────── */
const XP = path.join(DATA, "sector-theme-xref.json");
ok(fs.existsSync(XP), "sector-theme-xref.json 存在(prebuild 產生)");
const x = fs.existsSync(XP) ? JSON.parse(read(XP)) : { byIndustry: {}, byTheme: {} };
const ind = JSON.parse(read(path.join(DATA, "industries-index.json"))).industries || [];
const themes = JSON.parse(read(path.join(DATA, "map-index.json"))).themes || [];

ok(ind.length > 0 && themes.length > 0, `兩份索引非空(產業 ${ind.length} / 題材 ${themes.length})`);
ok(Object.keys(x.byIndustry || {}).length === ind.length, "每個產業都有一筆(可能是空陣列)");
ok(Object.keys(x.byTheme || {}).length === themes.length, "每個題材都有一筆");

const iHas = Object.values(x.byIndustry || {}).filter((v) => v.length).length;
const tHas = Object.values(x.byTheme || {}).filter((v) => v.length).length;
/* 🔴 這兩條是「判準選對了沒」。若絕大多數都空,那不是資料的錯,是判準不適用 ——
   而一個到處都空的區塊,在畫面上與「功能沒做」無法區分。 */
ok(iHas > ind.length * 0.5, `過半產業有相關題材(${iHas}/${ind.length})`);
ok(tHas > themes.length * 0.5, `過半題材有相關產業(${tHas}/${themes.length})`);

/* 門檻與上限要真的生效 —— 兩個方向都驗 */
const allI = Object.values(x.byIndustry).flat();
const allT = Object.values(x.byTheme).flat();
ok(allI.length > 0 && allT.length > 0, "兩個方向都有項目(否則下面的斷言恆真)");
ok(allI.every((r) => r.shared >= x.minShared), `所有項目 shared >= minShared(${x.minShared})`);
ok(Object.values(x.byIndustry).every((v) => v.length <= x.topN), `每側不超過 topN(${x.topN})`);
ok(Object.values(x.byTheme).every((v) => v.length <= x.topN), "題材側同樣不超過 topN");
ok(allI.every((r) => r.of >= r.shared), "of >= shared(重疊不可能超過對方總數)");
/* 🔴 對照:shared 必須真的有變化,否則「>= minShared」可能只是每筆都剛好等於門檻 */
ok(new Set(allI.map((r) => r.shared)).size > 1, "shared 有分布(不是每筆都同一個值)");

/* slug 必須指得到真的頁面 —— 連結斷掉比沒有連結更糟 */
const iSlugs = new Set(ind.map((i) => i.slug));
const tSlugs = new Set(themes.map((t) => t.slug));
ok(allI.every((r) => tSlugs.has(r.slug)), "產業側指向的題材 slug 都存在");
ok(allT.every((r) => iSlugs.has(r.slug)), "題材側指向的產業 slug 都存在");

/* 對稱性:A 列了 B,則 B 的清單裡要嘛有 A,要嘛是被 topN 截掉(shared 更大的排前面) */
let asym = 0;
for (const [is, arr] of Object.entries(x.byIndustry)) {
  for (const r of arr) {
    const back = (x.byTheme[r.slug] || []).find((b) => b.slug === is);
    if (back) {
      if (back.shared !== r.shared) asym++;
    } else {
      const cut = (x.byTheme[r.slug] || []).length >= x.topN;
      if (!cut) asym++;
    }
  }
}
ok(asym === 0, "對稱:同一對的 shared 兩邊一致(缺席只允許因 topN 截斷)", `不一致 ${asym}`);

/* ── ② 成分股預設顯示 ────────────────────────────────────────── */
const CHAIN = read(path.join(WEB, "src/pages/sectors/chain/[slug].astro"));
ok(CHAIN.length > 0, "產業鏈頁讀得到(否則下面恆真)");
/* 🔴 選擇器要【整條】比對:子字串比對會把
   `.sc-rolegrid.filtering .sc-subgroup { display:none }` 也算進來,
   於是這條永遠紅 —— 那是掃描器自己壞掉,不是程式錯。 */
const ruleBody = (css, selector) => {
  // 以「行首(可含空白)+ 完整選擇器 + {」為界,避免把後代選擇器算進來
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("(?:^|\\n)[ \\t]*" + esc + "[ \\t]*\\{([^}]*)\\}");
  const m = css.match(re);
  return m ? m[1] : null;
};
const subgroupRule = ruleBody(CHAIN, ".sc-subgroup");
ok(subgroupRule != null, "找得到 .sc-subgroup 這條規則(否則下一條恆真)");
ok(
  subgroupRule != null && !/display:\s*none/.test(subgroupRule),
  "🔴 .sc-subgroup 預設不得是 display:none(那會讓進頁面一檔都看不到)",
  String(subgroupRule).trim().slice(0, 60)
);
ok(/\.sc-rolegrid\.filtering\s+\.sc-subgroup\s*\{[^}]*display:\s*none/.test(CHAIN),
   "只有在【篩選中】才隱藏未選取的分組");
ok(CHAIN.includes("#sc-hint"), "提示文字有 id,供 JS 依狀態改寫");
ok(
  !CHAIN.includes("↑ 點選上方產業鏈節點以查看成分股"),
  "🔴 舊的寫死提示已移除(它描述的是舊行為,留著就是說假話)"
);
/* 🔴 對照:掃描器抓得到它該抓的東西,否則上面兩條是假陰性 */
ok(
  /display:\s*none/.test(ruleBody(".sc-subgroup { display: none; flex-direction: column; }", ".sc-subgroup") || ""),
  "對照:掃描器抓得到舊寫法(整條規則裡的 display:none)"
);
ok(
  ruleBody(".sc-rolegrid.filtering .sc-subgroup { display: none; }", ".sc-subgroup") === null,
  "🔴 對照:後代選擇器不會被誤認成 .sc-subgroup 本身"
);

/* ── ③ 節點磚可點 ───────────────────────────────────────────── */
ok(/<button type="button" class="ind-tile node"/.test(CHAIN), "🔴 節點磚是 <button>(原本是不可點的 <div>)");
ok(CHAIN.includes("data-target"), "節點磚帶 data-target(指向對應分組,不靠名稱反查)");
ok(/target:\s*x\.g\.target/.test(CHAIN), "🔴 target 有帶進 treemap 的【輸入】(漏在這層會讓 data-target 全空)");
ok(!/id="ind-hm-node"[^>]*role="img"/.test(CHAIN), "🔴 節點熱力圖容器不得是 role=\"img\"(裡面有互動元素)");
ok(!/id="ind-hm-stock"[^>]*role="img"/.test(CHAIN), "個股熱力圖容器同樣不是 role=\"img\"(裡面是 <a>)");
ok(/\.ind-tile\.node:focus-visible/.test(CHAIN), "節點磚有焦點環(鍵盤使用者看得到自己在哪)");

/* ── ① 的版面:兩頁都要有連結 ────────────────────────────────── */
ok(/href=\{`\/themes\/\$\{encodeURIComponent\(t\.slug\)\}`\}/.test(CHAIN), "🔴 產業鏈頁有連到題材的連結");
const THEME = read(path.join(WEB, "src/pages/themes/[slug].astro"));
ok(THEME.length > 0, "題材頁讀得到");
ok(/href=\{`\/sectors\/chain\/\$\{encodeURIComponent\(r\.slug\)\}`\}/.test(THEME), "🔴 題材頁有連回產業鏈的連結");
ok(THEME.includes("relIndustries"), "題材頁讀 xref");

/* ── 產生者要在管線裡,不是只放在 scripts/ ──────────────────── */
const BD = read(path.join(WEB, "scripts/build-data.mjs"));
ok(BD.includes("build-sector-theme-xref.mjs"), "🔴 xref 產生者接在 build-data 管線上");

/* ══════════════════════════════════════════════════════════════ */
const total = pass + fails.length;
for (const f of fails) console.error(`  ✗ ${f}`);
if (total !== PLAN) {
  console.error(`\n✗ 檢查數 ${total} ≠ 宣告的 PLAN ${PLAN}`);
  process.exit(1);
}
if (fails.length) {
  console.error(`\n✗ ${fails.length}/${total} 失敗`);
  process.exit(1);
}
console.log(`✓ explore-links:${pass}/${PLAN} 全過`);
