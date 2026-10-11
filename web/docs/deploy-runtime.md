# 部署與執行期:2026-10-01 ~ 10-11 的十天停擺

> 相關:`web/scripts/build-vercel.mjs`(以部署路徑建置)、
> `web/scripts/fix-vercel-runtime.mjs`(postbuild 修 runtime)、
> `web/scripts/verify-deploy.mjs`(上線驗證,`npm run verify:deploy`)

---

## 發生了什麼

```
最後一次成功部署  e3376477cb  2026-09-30 16:40   Ready 11m48s
2026-10-01 起     19 次全部 Error,每次 5–10 秒
2026-10-11        修復
```

**而網站一直正常** —— 它在服務 10/01 的 build。**部署失敗對訪客零症狀**,
所以十天、23 個 commit、3,890 個檔案的改動沒有任何一件上線,而沒有人發現。

### 🔴 兩層成因,不是一個

**第一層:Vercel 停用 Node 20,而 `engines` 釘在 `20.x`。**

```
Node.js Version "20.x" is discontinued and must be upgraded.
Please set "engines": { "node": "24.x" } in your package.json file
```

7 秒裡 5.7 秒在 clone —— **根本沒進到 build**。
旁證:`web/package.json` 從 9/30 到 10/10 完全沒動過,而 10/01 就開始失敗。
**repo 沒變,環境變了。**

**第二層:`engines` 改成 24 之後,adapter 靜悄悄退回 `nodejs18.x`。**

```
Build Failed: The following Serverless Functions contain an invalid "runtime": _render (nodejs18.x)
```

`@astrojs/vercel@7.8.2` 的原始碼:

```js
const SUPPORTED_NODE_VERSIONS = { 18: {...}, 20: { status: 'default' } };  // 只認得 18 / 20
if (support === undefined) {
  logger.warn(`The local Node.js version (24) is not supported ...
               Your project will use Node.js 18 as the runtime instead.`);
  return 'nodejs18.x';
}
```

它印的是 **warn 不是 error**,build 照樣 `exit 0`。
而 Vercel 現在也不接受 18 —— 於是「build 成功」直接變成「部署失敗」。

---

## 🔴 最重要的教訓:本機 build 綠,對部署沒有證據力

```js
// astro.config.mjs
adapter: process.env.VERCEL ? vercel() : node({ mode: "standalone" })
```

本機 `npm run build` 走的是 **`@astrojs/node` standalone**,輸出 `dist/`。
它**從來不會**呼叫 Vercel adapter 的 `getRuntime()`,也不會產生 `.vercel/output/`。
實測:本機 `.vc-config.json` **0 個**。

而我們**每一輪**都拿「本機 build 綠」當推送依據。

> 那不是「訊號弱一點」,是**那個訊號根本不涵蓋部署這件事**。

### 處置:讓部署路徑可以在本機重現

```bash
npm run build:vercel     # VERCEL=1 → @astrojs/vercel/serverless,產生 .vercel/output
```

推送前的檢查清單因此改成「**用部署路徑 build 過**」,不是「build 過」。

> ⚠️ **界限**:這支重現的是**adapter 的輸出**,不是**Vercel 的環境**。
>
> | 重現得到 | 重現不到 |
> |---|---|
> | adapter 選了哪個 runtime | Vercel 的 Node 執行期、冷啟動 |
> | `.vercel/output` 結構、函式打包 | 區域、CDN 行為 |
> | postbuild 修補有沒有生效 | 專案設定裡的 Node.js Version(可能覆蓋 package.json) |
>
> **能重現的那一半要重現;不能重現的那一半要說出來** ——
> 否則 `build:vercel` 會變成下一個「綠了所以沒問題」的假保證。
> 上線後仍然要跑 `npm run verify:deploy`。

### 次要教訓:build 的判準不可以只數 error

降級 / 回退 / fallback **幾乎一律是 warn**,而它們正是
「**成功了,但不是你以為的那個成功**」。
判讀改成:`[ERROR]` 為 0 **且** `[WARN]` 逐條看過。

⚠️ 連數 warn 都要小心比對目標:`grep -i warn` 會抓到
`/wiki/borgwarner/index.html`。要抓的是 `[WARN]`。

---

## 現在的修法:postbuild 改寫 `.vc-config.json`

`scripts/fix-vercel-runtime.mjs` 在 `postbuild` 執行,**移除** `runtime` 欄位,
讓函式吃**專案設定**的 Node 版本。

比寫死 `nodejs24.x` 好:下次再升 Node 不必改這支,也不會出現
「`package.json` 說 24、這支說 22」那種兩邊不一致。
(若 Vercel 要求 `runtime` 必填,備案是 `node scripts/fix-vercel-runtime.mjs --pin`。)

### 這支必須大聲,不可以靜默成 no-op

**一個會默默什麼都不做的修補,就是下一個「部署失敗、沒人知道為什麼」。**

| 情況 | 行為 | 驗過了嗎 |
|---|---|---|
| 找到 0 個 `.vc-config.json` | **exit 1** | ✅ 注入(把整個 `_render.func` 移出 `functions/`)→ exit 1;還原 → exit 0 |
| 逐檔印出 runtime 改動前後 | 印 | ✅ |
| 改動數 = 0 | **發警告** | ✅ 雙向:欄位不存在 → 0 + 警告;塞回 `nodejs18.x` → 1 + 無警告 |
| 非 Vercel 建置 | 明說跳過 | ✅ |

> 🔴 寫這支時踩過兩個坑,都已修正:
>
> **① 注入測試是假的。** 第一版把目錄改名成 `_render.func.bak`,它**還在 `functions/` 底下**,
> 遞迴掃描照樣找得到 —— 那次「通過」什麼都沒證明。
>
> **② 「改動數 = 0 要警告」永遠不可能響。** 第一版拿兩個**顯示字串**比對
> (`"(無)"` vs `"(已移除 → 吃專案設定)"`),欄位本來就不存在時字串仍不同,
> 於是 `changed` 永遠 ≥ 1。**檢查存在,但沒有觸發的可能。**
> 改成由資料判斷(`hasOwnProperty`)。
>
> 同族:「一個數字背後有兩種完全不同的世界,就不可以只印那個數字」。

---

## 🔴 重訪條件:這是繞道,不是永久方案

**正解是 Astro 4 → 5 + `@astrojs/vercel` v8**:

```
v7   peer astro ^4.2.0    ← 目前,最後一個支援 Astro 4 的版本;只認得 Node 18 / 20
v8   peer astro ^5.0.0
v9   peer astro ^5.0.0
v10  peer astro ^6.0.0
```

本專案是 `astro ^4.16.0` → 升 adapter 等於先升 Astro 4→5,是大工程。**救火時不做。**

> **觸發時機:**
> · adapter 再次與 Vercel 不相容(例如 Vercel 又停用某個 runtime)
> · 要用 Astro 5 的功能時
> · `fix-vercel-runtime` 印出「一個都沒變」—— 那可能代表 adapter 已不再寫 `runtime`,
>   這支可以退場

---

## 推 ≠ 上線:那個缺口原本沒有任何檢查

`npm run verify:deploy` 的判準**不是** Vercel 顯示 Ready(那是它自己的宣稱),
而是**線上真的有那段只有新版才有的文字**。

兩層分開,退出碼也分開:`0` 全過 / `1` 沒換版 / `2` 站台不可達 / `3` 換版了但函式掛了。

### 兩層在舊版上有不同的期望值 —— 那是設計出來的

```
舊版線上  第一層 20/20 全紅   ← 任何一條變綠 = 那條是假指紋
          第二層  4/4 全綠    ← 任何一條變紅 = 函式問題,不是版本問題
```

這樣「指紋有沒有鑑別力」不必靠人記得檢查,**跑一次就看得出來**。

> 🔴 寫這支時埋了**兩個假指紋**,都是靠上面那個基準抓到的:
> · `tcat-pill` —— 舊版的膠囊是 JS 產生的,class 本來就在 bundle 裡
> · `href="/discover"` —— 舊版的**導覽**裡就有
>
> 還有一個**分層錯誤**:`/api/quote-mini/00646` 放在第二層,但它回 400 是
> 「4 碼守衛還在」= 第一層的症狀。**放錯層的檢查會污染診斷,不只是結果。**

### 量測點本身會被快取污染

等待部署時實測:`/` 回 `X-Vercel-Cache: HIT`、`Age: 3613`,
而 `Last-Modified` 與 `Age` 同步增長 —— 它是**邊緣快取填充時間**,不是部署時間。
`/` 是靜態資產,Vercel 的快取鍵**忽略查詢字串**,`?_cachebust=` 那招對它無效。

→ **不受快取污染的量測點是函式路由**(`/api/*`,標頭自己寫 `MISS`)。
