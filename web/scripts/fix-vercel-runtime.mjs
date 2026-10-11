#!/usr/bin/env node
/**
 * 修正 Vercel serverless function 的 runtime —— adapter 把它寫成已淘汰的 nodejs18.x
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 🔴 成因(已讀 adapter 原始碼確認,不是推測):
 *    node_modules/@astrojs/vercel/dist/serverless/adapter.js
 *
 *      const SUPPORTED_NODE_VERSIONS = { 18: {...}, 20: { status: 'default' } };
 *      ...
 *      if (support === undefined) {
 *        logger.warn(`The local Node.js version (${major}) is not supported ...
 *                     Your project will use Node.js 18 as the runtime instead.`);
 *        return 'nodejs18.x';
 *      }
 *
 *    `@astrojs/vercel@7.8.2` 只認得 Node 18 / 20。我們為了讓 Vercel 接受
 *    (它停用了 Node 20)把 engines 升到 24 —— adapter 不認得 24,
 *    **靜悄悄退回 nodejs18.x**,而 Vercel 也已經不接受 18:
 *
 *      Build Failed: The following Serverless Functions contain an invalid "runtime": _render (nodejs18.x)
 *
 *    它印的是 **warn 不是 error**,build 照樣 exit 0。
 *    **降級 / 回退 / fallback 幾乎一律是 warn** —— 而那正是
 *    「成功了,但不是你以為的那個成功」。
 *
 * 🔴 為什麼不升 adapter(正解,但不是現在):
 *      v7  peer astro ^4.2.0   ← 目前,最後一個支援 Astro 4 的版本
 *      v8  peer astro ^5.0.0
 *      v9  peer astro ^5.0.0
 *      v10 peer astro ^6.0.0
 *    本專案是 astro ^4.16.0 → 升 adapter = 先升 Astro 4→5,是大工程。**救火時不做。**
 *
 * > **重訪條件:Astro 4 → 5 + `@astrojs/vercel` v8 才是正解。**
 * > 觸發時機:「adapter 再次與 Vercel 不相容」或「要用 Astro 5 的功能時」。
 * > **這支是繞道,不是永久方案。** 見 web/docs/deploy-runtime.md。
 *
 * ── 這支必須大聲,不可以靜默成 no-op ──────────────────────────────
 *
 * 一個會默默什麼都不做的修補,就是下一個「部署失敗、沒人知道為什麼」。
 * 所以:
 *   · 找到 0 個 .vc-config.json → **失敗**(adapter 改輸出路徑時會發生)
 *   · 逐檔印出改動前後的 runtime
 *   · 非 Vercel 環境(本機用 @astrojs/node standalone)→ 明說跳過,不假裝做了事
 * ══════════════════════════════════════════════════════════════════════════
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const WEB = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const OUT = path.join(WEB, ".vercel", "output", "functions");

/**
 * 🔴 移除 `runtime` 欄位,讓函式吃【專案設定】的 Node 版本。
 *    比寫死 `nodejs24.x` 好:下次再升 Node 不必改這支腳本,
 *    也不會出現「package.json 說 24、這支說 22」那種兩邊不一致。
 *    若 Vercel 要求必填而失敗,再改成寫死(見文件的備案)。
 */
const MODE = process.argv.includes("--pin") ? "pin" : "remove";
const PIN_TO = "nodejs24.x";

function findConfigs(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...findConfigs(p));
    else if (name === ".vc-config.json") out.push(p);
  }
  return out;
}

/* 本機非 Vercel 建置走 @astrojs/node standalone,不會有 .vercel/output —— 明說跳過 */
if (!process.env.VERCEL) {
  console.log("[vc-runtime] 非 Vercel 建置(無 VERCEL 環境變數)→ 跳過。本機用的是 @astrojs/node standalone。");
  process.exit(0);
}

const files = findConfigs(OUT);
console.log(`[vc-runtime] 掃描 ${OUT}`);
console.log(`[vc-runtime] 找到 ${files.length} 個 .vc-config.json`);

/* 🔴 找到 0 個 = 這支什麼都沒做,而部署會照樣帶著 nodejs18.x 失敗。
      那種「修補存在但沒生效」的狀態,正是我們這幾天在修的那個病。 */
if (files.length === 0) {
  console.error(
    "[vc-runtime] 🔴 找不到任何 .vc-config.json —— 這支沒有修到任何東西。\n" +
      "            可能是 adapter 改了輸出路徑,或 build 沒有真的用 Vercel adapter。\n" +
      "            **不要讓它靜默通過**:現在失敗,比部署時才失敗容易查。"
  );
  process.exit(1);
}

let changed = 0;
for (const f of files) {
  const rel = path.relative(WEB, f);
  let j;
  try {
    j = JSON.parse(readFileSync(f, "utf8"));
  } catch (e) {
    console.error(`[vc-runtime] 🔴 ${rel} 不是合法 JSON:${e}`);
    process.exit(1);
  }
  /* 🔴 用【資料】判斷有沒有變,不要用顯示字串。
     第一版拿 before/after 兩個【顯示字串】比對:欄位本來就不存在時是
     "(無)" vs "(已移除 → 吃專案設定)" —— 字串不同,於是 changed 永遠 ≥ 1,
     **「改動數 = 0 要警告」那條因此永遠不可能響**。
     一個永遠不會觸發的檢查,和沒有檢查一樣。 */
  const has = (o) => Object.prototype.hasOwnProperty.call(o, "runtime");
  const beforeVal = has(j) ? j.runtime : undefined;
  if (MODE === "pin") j.runtime = PIN_TO;
  else delete j.runtime;
  const afterVal = has(j) ? j.runtime : undefined;
  if (beforeVal !== afterVal) changed++;
  writeFileSync(f, JSON.stringify(j), "utf8");
  const show = (v, absent) => (v === undefined ? absent : v);
  console.log(
    `[vc-runtime]   ${rel}\n[vc-runtime]     runtime: ${show(beforeVal, "(本來就沒有)")}` +
      `  ->  ${show(afterVal, "(無 → 吃專案設定)")}`
  );
}

console.log(`[vc-runtime] 完成:${files.length} 個檔,其中 ${changed} 個 runtime 有變動(模式:${MODE})`);
if (changed === 0) {
  console.warn(
    "[vc-runtime] ⚠️ 一個都沒變 —— 可能 adapter 已經不再寫 runtime(那是好事,代表這支可以退場),\n" +
      "            也可能它寫的值剛好就是目標值。兩者不同,下次升級 adapter 時回來看這一行。"
  );
}
