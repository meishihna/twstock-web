#!/usr/bin/env node
/**
 * 以【部署路徑】在本機建置 —— `npm run build:vercel`
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 🔴 為什麼需要這支:
 *
 *    astro.config.mjs:
 *      adapter: process.env.VERCEL ? vercel() : node({ mode: "standalone" })
 *
 *    本機 `npm run build` 走的是 **@astrojs/node standalone**,輸出 `dist/`。
 *    它**從來不會**呼叫 Vercel adapter 的 `getRuntime()`,也不會產生
 *    `.vercel/output/**\/.vc-config.json`。
 *
 *    而我們每一輪都拿「本機 build 綠」當推送依據 ——
 *    **那個訊號根本不涵蓋部署這件事**,不是「弱一點」而已。
 *    2026-10-11 的實例:adapter 在 Node 24 下靜悄悄退回 `nodejs18.x`
 *    (印的是 warn、build 照樣 exit 0),Vercel 拒收,
 *    而本機怎麼跑都看不到,因為本機根本沒走那條路。
 *
 * ⚠️ **這支能重現的是「adapter 的輸出」,不是「Vercel 的環境」。**
 *    重現得到:adapter 選了哪個 runtime、`.vercel/output` 的結構、函式打包。
 *    重現不到:Vercel 的 Node 執行期、函式冷啟動、區域、CDN 行為、
 *              專案設定裡的 Node.js Version(它可能覆蓋 package.json)。
 *    **能重現的那一半要重現;不能重現的那一半要說出來** ——
 *    否則這支會變成下一個「綠了所以沒問題」的假保證。
 *    部署之後仍然要跑 `npm run verify:deploy`(看線上實際的 HTML 與函式)。
 *
 * 用 node 包裝而不是 `VERCEL=1 npm run build`:後者在 cmd.exe 不成立,
 * 而專案沒有 cross-env;加一個相依只為了設一個環境變數不划算。
 * ══════════════════════════════════════════════════════════════════════════
 */
import { spawnSync } from "node:child_process";
import process from "node:process";

console.log("[build:vercel] 以部署路徑建置(VERCEL=1 → @astrojs/vercel/serverless)");
console.log("[build:vercel] ⚠️ 重現的是 adapter 的輸出,不是 Vercel 的環境;上線後仍須 verify:deploy\n");

const r = spawnSync("npm", ["run", "build"], {
  stdio: "inherit",
  env: { ...process.env, VERCEL: "1" },
  shell: true,
});
process.exit(r.status ?? 1);
