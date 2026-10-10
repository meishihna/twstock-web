/**
 * Reads ../themes/*.md (excl. README), writes public/data/themes-index.json
 * for /themes pages. Requires reports-index.json for sectorSlug on links.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.join(__dirname, "..");
const REPO_ROOT = path.join(WEB_ROOT, "..");
const THEMES_DIR = path.join(REPO_ROOT, "themes");
const OUT_DIR = path.join(WEB_ROOT, "public", "data");
const OUT_FILE = path.join(OUT_DIR, "themes-index.json");
const IDX_FILE = path.join(OUT_DIR, "reports-index.json");

// - **3443 創意** (Semiconductors) [先進封裝]   ← 末段 [子分類] 為選填
const BULLET_RE = /^\s*-\s*\*\*(\d{4})\s+(.+?)\*\*\s*\(([^)]+)\)(?:\s*\[([^\]]+)\])?/;

// "label=value | label=value" → [{label, value}]
function parseIndicators(raw) {
  if (!raw) return [];
  return raw
    .split("|")
    .map((seg) => {
      const i = seg.indexOf("=");
      if (i < 0) return null;
      const label = seg.slice(0, i).trim();
      const value = seg.slice(i + 1).trim();
      return label && value ? { label, value } : null;
    })
    .filter(Boolean);
}

function parseTheme(content, fileBase) {
  const slug = fileBase.replace(/\.md$/i, "");
  const lines = content.split(/\r?\n/);
  const h1 = lines.find((l) => l.startsWith("# "));
  const title = h1 ? h1.slice(2).trim() : slug;
  let companyCount = 0;
  const cm = content.match(/\*\*涵蓋公司數:\*\*\s*(\d+)/);
  if (cm) companyCount = parseInt(cm[1], 10);

  // H1 後第一行引言 "> ..." 作為題材描述
  const descM = content.match(/^>\s*(.+)$/m);
  const desc = descM ? descM[1].trim() : "";

  const relM = content.match(/\*\*相關主題:\*\*\s*(.+)/);
  const relatedRaw = relM ? relM[1].trim() : "";

  // 策展 metadata(分類必有;CAGR/市場規模/關鍵指標 選填)
  const catM = content.match(/\*\*分類:\*\*\s*(.+)/);
  const category = catM ? catM[1].trim() : "";
  const cagrM = content.match(/\*\*CAGR:\*\*\s*(.+)/);
  const cagr = cagrM ? cagrM[1].trim() : "";
  const msM = content.match(/\*\*市場規模:\*\*\s*(.+)/);
  const marketSize = msM ? msM[1].trim() : "";
  const indM = content.match(/\*\*關鍵指標:\*\*\s*(.+)/);
  const indicators = parseIndicators(indM ? indM[1].trim() : "");

  /**
   * 🔴 策展日期 —— 題材卡「核實 YYYY-MM-DD」的**唯一**來源。
   *
   * 以前那個欄位用的是 `map-index.json` 的 `generatedAt`,而那是 `prebuild`
   * 現生的【部署時間】。內容來源(本檔)停在 2026-06,卻每天都顯示「今天核實」——
   * **一個每天都在動的數字掛著「核實」,比單純過期更嚴重:它看起來永遠健康。**
   *
   * 為什麼寫在 .md 裡而不是 build 時現算:
   *   · `map-index.json` 不進版控 → 沒有「保留前次值」可用
   *   · 檔案 mtime 在 CI clone 之後 = checkout 時間 → 又一個 build-time 謊言
   *   · `git log` 在淺 clone(Vercel)可能查不到 100 天前的 commit
   *   → 唯一在任何環境都成立的來源,是【已進版控的檔案內容】本身。
   *
   * ⚠️ 取不到就是 `""`,呼叫端必須【整個不顯示】,**不可以退回任何其他日期**。
   */
  const curM = content.match(/\*\*策展日期:\*\*\s*(\d{4}-\d{2}-\d{2})/);
  const curatedAt = curM ? curM[1] : "";

  const tiers = { upstream: [], midstream: [], downstream: [] };
  let current = null;
  for (const line of lines) {
    if (/^##\s*上游/.test(line)) {
      current = "upstream";
      continue;
    }
    if (/^##\s*中游/.test(line)) {
      current = "midstream";
      continue;
    }
    if (/^##\s*下游/.test(line)) {
      current = "downstream";
      continue;
    }
    if (line.startsWith("## ")) {
      current = null;
      continue;
    }
    const bm = line.match(BULLET_RE);
    if (bm && current) {
      tiers[current].push({
        ticker: bm[1],
        name: bm[2].trim(),
        sector: bm[3].trim(),
        subcat: (bm[4] || "").trim(),
      });
    }
  }

  return { slug, title, companyCount, desc, category, cagr, marketSize, indicators, relatedRaw, tiers, curatedAt };
}

function main() {
  if (!existsSync(THEMES_DIR)) {
    console.error("themes/ not found:", THEMES_DIR);
    process.exit(1);
  }
  if (!existsSync(IDX_FILE)) {
    console.error("Run build-index.mjs first (missing reports-index.json)");
    process.exit(1);
  }

  const idx = JSON.parse(readFileSync(IDX_FILE, "utf8"));
  const byTicker = idx.byTicker || {};

  const themes = [];
  for (const name of readdirSync(THEMES_DIR)) {
    if (!name.endsWith(".md") || name === "README.md") continue;
    const fp = path.join(THEMES_DIR, name);
    const raw = readFileSync(fp, "utf8");
    const t = parseTheme(raw, name);
    for (const key of ["upstream", "midstream", "downstream"]) {
      for (const row of t.tiers[key]) {
        const meta = byTicker[row.ticker];
        row.sectorSlug = meta?.sectorSlug ?? "";
      }
    }
    themes.push(t);
  }

  themes.sort((a, b) => a.title.localeCompare(b.title, "zh-Hant"));

  mkdirSync(OUT_DIR, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    themes,
  };
  writeFileSync(OUT_FILE, JSON.stringify(payload), "utf8");
  console.log("Wrote", OUT_FILE, "| themes:", themes.length);
}

main();
