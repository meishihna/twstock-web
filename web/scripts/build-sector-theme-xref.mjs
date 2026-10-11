#!/usr/bin/env node
/**
 * 產業鏈 ↔ 投資題材 交叉索引
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 🔴 為什麼需要:導覽收斂成「產業 / 題材 / 探索 / 自選」之後,
 *    前兩項是核心,但它們之間**一個連結都沒有**(兩個方向都是 0)。
 *    使用者在產業鏈頁看完上下游,沒有任何路徑能問「這些公司屬於哪些題材」——
 *    唯一的走法是繞到 /report/{ticker} 再點題材晶片。
 *    **探索的路走不通。**
 *
 * 判準:**成員重疊**。兩邊的成員名單都已經在索引裡,不需要人工對照表。
 *   industries-index.json → 35 個產業鏈,tiers.{u,m,d}[].t
 *   map-index.json        → 102 個投資題材,tiers.{u,m,d}[].t
 *
 * ⚠️ 重疊數會偏袒大題材(成員多自然重疊多)。所以**把數字一起顯示出來**,
 *    讓讀的人自己判斷,而不是只給一個排序後的清單。
 *    同族:「容差若不可見,『通過』可能只是容差太鬆」。
 *
 * 輸出 web/public/data/sector-theme-xref.json
 *   { generatedAt, byIndustry: { slug: [{slug,title,shared,of}] },
 *                  byTheme:    { slug: [{slug,title,shared,of}] } }
 *   `shared` = 重疊檔數;`of` = 對方的成員總數(讓「5/8」與「5/200」分得開)
 * ══════════════════════════════════════════════════════════════════════════
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const WEB = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const DATA = path.join(WEB, "public", "data");
const IND = path.join(DATA, "industries-index.json");
const MAP = path.join(DATA, "map-index.json");
const OUT = path.join(DATA, "sector-theme-xref.json");

/** 每一側最多列幾個。太多會變成另一種雜訊,反而沒人點。 */
const TOP_N = 6;
/** 重疊門檻:只有 1 檔重疊通常是巧合,不構成「相關」。 */
const MIN_SHARED = 2;

const members = (o) => {
  const s = new Set();
  for (const k of ["u", "m", "d"]) for (const c of o?.tiers?.[k] || []) if (c?.t) s.add(c.t);
  return s;
};

function main() {
  for (const [p, who] of [[IND, "industries-index"], [MAP, "map-index"]]) {
    if (!existsSync(p)) {
      console.warn(`[xref] ${who}.json missing, skip`);
      return;
    }
  }
  const industries = (JSON.parse(readFileSync(IND, "utf8")).industries) || [];
  const themes = (JSON.parse(readFileSync(MAP, "utf8")).themes) || [];

  const iM = industries.map((x) => ({ slug: x.slug, title: x.title, set: members(x) }));
  const tM = themes.map((x) => ({ slug: x.slug, title: x.title, set: members(x) }));

  const byIndustry = {};
  const byTheme = {};
  for (const i of iM) byIndustry[i.slug] = [];
  for (const t of tM) byTheme[t.slug] = [];

  let pairs = 0;
  for (const i of iM) {
    for (const t of tM) {
      let shared = 0;
      // 迭代較小的那一邊
      const [a, b] = i.set.size <= t.set.size ? [i.set, t.set] : [t.set, i.set];
      for (const x of a) if (b.has(x)) shared++;
      if (shared < MIN_SHARED) continue;
      pairs++;
      byIndustry[i.slug].push({ slug: t.slug, title: t.title, shared, of: t.set.size });
      byTheme[t.slug].push({ slug: i.slug, title: i.title, shared, of: i.set.size });
    }
  }

  const trim = (m) => {
    for (const k of Object.keys(m)) {
      m[k].sort((a, b) => b.shared - a.shared || a.title.localeCompare(b.title, "zh-TW"));
      m[k] = m[k].slice(0, TOP_N);
    }
    return m;
  };

  /**
   * 個股 -> 所屬產業價值鏈。
   * 🔴 報告頁的「所屬投資題材」在沒有題材時要給一條出路,而最現成的出路
   *    就是它所屬的產業鏈。沒有這份對應,那段文字會變成一個沒有出口的句子。
   * ⚠️ 這是【產業價值鏈】(TPEx),不是報告頁 hero 的研究分類 —— 兩者來源不同。
   */
  const industriesByTicker = {};
  for (const i of iM) {
    for (const t of i.set) {
      (industriesByTicker[t] ||= []).push({ slug: i.slug, title: i.title });
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    minShared: MIN_SHARED,
    topN: TOP_N,
    byIndustry: trim(byIndustry),
    byTheme: trim(byTheme),
    industriesByTicker,
  };
  writeFileSync(OUT, JSON.stringify(payload), "utf8");

  const emptyI = Object.values(payload.byIndustry).filter((v) => !v.length).length;
  const emptyT = Object.values(payload.byTheme).filter((v) => !v.length).length;
  console.log(
    `[xref] wrote ${OUT} | 產業 ${iM.length}(無相關 ${emptyI}) · 題材 ${tM.length}(無相關 ${emptyT})` +
      ` · 重疊≥${MIN_SHARED} 的配對 ${pairs}` +
      ` · 個股→產業鏈 ${Object.keys(industriesByTicker).length} 檔`
  );
  /* 🔴 若絕大多數都沒有相關,那不是「資料就是這樣」,是判準選錯了 —— 讓它喊出來 */
  if (emptyI > iM.length * 0.5 || emptyT > tM.length * 0.5) {
    console.warn("[xref] ⚠️ 過半沒有相關項 —— 門檻或判準可能不適用,請先看分布再上線");
  }
}

main();
