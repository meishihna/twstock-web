"""
build_market_focus.py — 首頁「今日市場焦點」:三大法人買賣金額 + 信用交易統計(市場合計)。

══════════════════════════════════════════════════════════════════════════════
為什麼有這支:
  `market-focus.json` 原本由 FinMind 產出,2026-08 全面改官方來源時那一步被移除,
  **但沒有東西補上**。於是它停在 2026-07-31 整整 68 天,而 workflow 裡還留著一句
  「已改由官方 BFI82U + MI_MARGN 產出」—— 那句話是假的,沒有任何一步在跑它。
  留著一句不實註解,比沒有註解更糟:它會讓下一個人以為有東西在跑。

來源(全免費、無金鑰;`www.twse.com.tw/rwd` 是本 repo 既有來源,T86 / MI_QFIIS 同樣走它):
  • 三大法人買賣金額統計表(市場合計,單位:元)
      /rwd/zh/fund/BFI82U?dayDate=YYYYMMDD&type=day&response=json
  • 信用交易統計(市場合計,融資/融券單位:交易單位(張);融資金額單位:仟元)
      /rwd/zh/marginTrading/MI_MARGN?date=YYYYMMDD&selectType=MS&response=json

⚠️ 這兩個端點**不在 TWSE 的 OpenAPI 契約裡**(openapi.twse.com.tw 的 143 個端點
   搜過,沒有 BFI82U;MI_MARGN 只有個股別、沒有市場合計)。
   它們可能無預警改。**所以這支腳本不是唯一的防線** ——
   卡片本身會印出資料日期、超過門檻會標色並說「N 天前」。
   即使這支哪天又默默停掉,**頁面會自己講**,而不是再等一次人工盤點。
   (見 web/docs/data-freshness.md)

輸出 web/public/data/market-focus.json(形狀與既有完全一致,卡片不必改)

  python scripts/build_market_focus.py            # 自動往回找最近有資料的交易日
  python scripts/build_market_focus.py 20261008   # 指定日期(測試用)
══════════════════════════════════════════════════════════════════════════════
"""

from __future__ import annotations

import json
import os
import ssl
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from utils import setup_stdout  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "public", "data", "market-focus.json")

BFI82U = "https://www.twse.com.tw/rwd/zh/fund/BFI82U?dayDate={d}&type=day&response=json"
MI_MARGN_MS = "https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date={d}&selectType=MS&response=json"

# 公開政府端點、只讀;憑證鏈在部分環境驗證失敗 → 不驗證(同 build_chips_snapshot.py)
_SSL = ssl.create_default_context()
_SSL.check_hostname = False
_SSL.verify_mode = ssl.CERT_NONE

TPE = timezone(timedelta(hours=8))

# 往回找幾個日曆日。連假最長約 9 天,14 天留餘裕。
LOOKBACK_DAYS = 14

# BFI82U 的列名 → 卡片上的標籤。
# 🔴 逐列具名對應,**不靠順序**:順序變了會靜默錯位,而每一格都還是「有值」。
INST_LABEL = {
    "外資及陸資(不含外資自營商)": "外資",
    "外資及陸資": "外資",
    "投信": "投信",
    "自營商(自行買賣)": "自營商(自行)",
    "自營商(避險)": "自營商(避險)",
    "外資自營商": "外資自營商",
}
INST_ORDER = ["外資", "投信", "自營商(自行)", "自營商(避險)", "外資自營商"]
INST_TOTAL = "合計"


def _get_json(url: str, retries: int = 3):
    last: Exception | None = None
    for i in range(retries):
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "Mozilla/5.0 twstock-market-focus", "Accept": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=60, context=_SSL) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            last = e
            time.sleep(2 * (i + 1))
    raise last if last else RuntimeError("unreachable")


def _num(x):
    """逗號數字 → float;非數值 → None。🔴 空字串不可以讀成 0。"""
    if x is None:
        return None
    s = str(x).strip().replace(",", "").replace("+", "")
    if not s or s in ("--", "-", "N/A"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _ymd(d: str) -> str:
    """'20261008' → '2026-10-08';看不懂就原樣回(不要自己編一個日期)。"""
    s = str(d or "").strip()
    return f"{s[0:4]}-{s[4:6]}-{s[6:8]}" if len(s) == 8 and s.isdigit() else s


def fetch_institutional(day: str):
    """三大法人買賣金額(億元)。查無資料 → None(不是空的 rows)。"""
    j = _get_json(BFI82U.format(d=day))
    if str(j.get("stat")) != "OK":
        return None
    rows = j.get("data") or []
    if not rows:
        return None

    by_label: dict[str, dict] = {}
    total_net = None
    for r in rows:
        if len(r) < 4:
            continue
        name = str(r[0]).strip()
        buy, sell, net = _num(r[1]), _num(r[2]), _num(r[3])
        if name == INST_TOTAL:
            total_net = None if net is None else round(net / 1e8, 1)
            continue
        label = INST_LABEL.get(name)
        if not label:
            continue
        # 元 → 億元
        by_label[label] = {
            "label": label,
            "buy": None if buy is None else round(buy / 1e8, 1),
            "sell": None if sell is None else round(sell / 1e8, 1),
            "net": None if net is None else round(net / 1e8, 1),
        }

    out_rows = [by_label[k] for k in INST_ORDER if k in by_label]
    # 🔴 一列都沒對上 → 判失敗,而不是回一張空表。
    #    來源改欄名時,空表會讓卡片顯示「全部 0」—— 那比不顯示更糟。
    if not out_rows:
        return None
    return {"date": _ymd(j.get("date") or day), "rows": out_rows, "totalNet": total_net}


def fetch_margin(day: str):
    """信用交易統計(市場合計)。查無資料 → None。"""
    j = _get_json(MI_MARGN_MS.format(d=day))
    if str(j.get("stat")) != "OK":
        return None
    tables = [t for t in (j.get("tables") or []) if isinstance(t, dict) and t.get("data")]
    if not tables:
        return None

    # 欄位:['項目','買進','賣出','現金(券)償還','前日餘額','今日餘額']
    want = {"融資(交易單位)": "margin", "融券(交易單位)": "short", "融資金額(仟元)": "marginMoney"}
    got: dict[str, dict] = {}
    for t in tables:
        for r in t.get("data") or []:
            if len(r) < 6:
                continue
            key = want.get(str(r[0]).strip())
            if not key:
                continue
            prev, today = _num(r[4]), _num(r[5])
            if prev is None or today is None:
                continue
            if key == "marginMoney":
                # 仟元 → 億元(1 億 = 100,000 仟元)
                got[key] = {"today": round(today / 1e5, 1), "change": round((today - prev) / 1e5, 1)}
            else:
                got[key] = {"today": int(today), "change": int(today - prev)}

    # 🔴 三項缺一就判失敗:卡片三行是一組,缺一行會讓讀的人以為那一項是 0。
    if set(got) != set(want.values()):
        return None
    return {"date": _ymd(j.get("date") or day), **got}


def main() -> None:
    setup_stdout()
    args = [a for a in sys.argv[1:] if a.isdigit() and len(a) == 8]
    days = args if args else [
        (datetime.now(TPE) - timedelta(days=i)).strftime("%Y%m%d") for i in range(LOOKBACK_DAYS)
    ]

    inst = margin = None
    for d in days:
        if inst is None:
            inst = fetch_institutional(d)
        if margin is None:
            margin = fetch_margin(d)
        if inst and margin:
            break

    # 🔴 任一半拿不到 → **保留既有檔案的那一半**,不要寫一個少了半邊的檔。
    #    卡片會印出資料日期並在過期時標色,所以「保留舊的」不等於「假裝是新的」。
    prev = {}
    if os.path.exists(OUT):
        try:
            prev = json.load(open(OUT, encoding="utf-8")) or {}
        except Exception:
            prev = {}

    kept = []
    if inst is None:
        inst = prev.get("institutional")
        if inst:
            kept.append(f"institutional(沿用 {inst.get('date')})")
    if margin is None:
        margin = prev.get("margin")
        if margin:
            kept.append(f"margin(沿用 {margin.get('date')})")

    if inst is None and margin is None:
        print("[market-focus] 兩個來源都取不到,且沒有可沿用的既有檔 → 不寫檔", file=sys.stderr)
        sys.exit(1)

    payload = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "臺灣證券交易所 BFI82U 三大法人買賣金額統計 + MI_MARGN 信用交易統計(市場合計)",
        "scope": "上市(不含上櫃)",
        "units": {"institutional": "億元", "margin": "交易單位(張)", "marginMoney": "億元"},
        "institutional": inst,
        "margin": margin,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, OUT)

    note = ("  ⚠️ " + " / ".join(kept)) if kept else ""
    print(
        f"wrote {OUT}  三大法人 {inst.get('date') if inst else '—'}"
        f"  信用交易 {margin.get('date') if margin else '—'}{note}"
    )
    # 沿用舊資料不算成功 —— 讓 CI 看得見(卡片那一邊同時也會說)
    if kept:
        sys.exit(2)


if __name__ == "__main__":
    main()
