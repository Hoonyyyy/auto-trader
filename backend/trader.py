"""
자동매매 핵심 로직
- 장 시작 시 시가 기록
- N% 하락 감지 시 설정 금액 자동 매수
- 가격 히스토리 기록
- 주문 내역 파일 저장/복원
"""

import os
import json
from typing import Optional
from datetime import datetime
from zoneinfo import ZoneInfo
from dotenv import load_dotenv
from alpaca.trading.client import TradingClient
from alpaca.trading.requests import MarketOrderRequest
from alpaca.trading.enums import OrderSide, TimeInForce
from alpaca.data.historical import StockHistoricalDataClient
from alpaca.data.requests import StockLatestQuoteRequest, StockBarsRequest
from alpaca.data.timeframe import TimeFrame

load_dotenv()

API_KEY = os.getenv("ALPACA_API_KEY")
SECRET_KEY = os.getenv("ALPACA_SECRET_KEY")
ORDERS_FILE = os.path.join(os.path.dirname(__file__), "orders.json")

trading_client = TradingClient(API_KEY, SECRET_KEY, paper=True)
data_client = StockHistoricalDataClient(API_KEY, SECRET_KEY)

# 설정 (UI에서 변경 가능)
settings = {
    "symbol": "AAPL",
    "drop_threshold": 0.01,   # 1%
    "buy_amount_usd": 1.0,
}

# 상태 (메모리)
state = {
    "opening_price": None,
    "last_price": None,
    "status": "대기중",
    "is_running": False,
    "price_history": [],   # [{time, price}, ...]
    "orders": [],
}


# ── 주문 내역 영속성 ──────────────────────────────────────

def _load_orders():
    if os.path.exists(ORDERS_FILE):
        try:
            with open(ORDERS_FILE, "r") as f:
                state["orders"] = json.load(f)
        except Exception:
            state["orders"] = []

def _save_orders():
    with open(ORDERS_FILE, "w") as f:
        json.dump(state["orders"], f, ensure_ascii=False, indent=2)

_load_orders()  # 서버 시작 시 복원


# ── API 호출 ─────────────────────────────────────────────

def get_current_price() -> Optional[float]:
    try:
        req = StockLatestQuoteRequest(symbol_or_symbols=settings["symbol"])
        quote = data_client.get_stock_latest_quote(req)
        return float(quote[settings["symbol"]].ask_price)
    except Exception as e:
        print(f"[가격조회 오류] {e}")
        return None


def get_opening_price() -> Optional[float]:
    try:
        from datetime import date
        req = StockBarsRequest(
            symbol_or_symbols=settings["symbol"],
            timeframe=TimeFrame.Day,
            start=date.today(),
            end=date.today(),
        )
        bars = data_client.get_stock_bars(req)
        bar_list = bars[settings["symbol"]]
        if bar_list:
            return float(bar_list[0].open)
        return None
    except Exception as e:
        print(f"[시가조회 오류] {e}")
        return None


def is_market_open() -> bool:
    try:
        return trading_client.get_clock().is_open
    except Exception as e:
        print(f"[시장상태 오류] {e}")
        return False


def place_buy_order(current_price: float) -> Optional[dict]:
    try:
        order_req = MarketOrderRequest(
            symbol=settings["symbol"],
            notional=settings["buy_amount_usd"],
            side=OrderSide.BUY,
            time_in_force=TimeInForce.DAY,
        )
        order = trading_client.submit_order(order_req)
        record = {
            "id": str(order.id),
            "time": datetime.now(ZoneInfo("Asia/Seoul")).strftime("%Y-%m-%d %H:%M:%S"),
            "symbol": settings["symbol"],
            "amount_usd": settings["buy_amount_usd"],
            "trigger_price": current_price,
            "opening_price": state["opening_price"],
            "drop_pct": round(
                (current_price - state["opening_price"]) / state["opening_price"] * 100, 2
            ),
        }
        state["orders"].append(record)
        _save_orders()
        print(f"[매수 완료] {record}")
        return record
    except Exception as e:
        print(f"[주문 오류] {e}")
        return None


# ── 스케줄러 메인 루프 ───────────────────────────────────

def run_check():
    if not state["is_running"]:
        return

    if not is_market_open():
        state["status"] = "장 마감"
        return

    if state["opening_price"] is None:
        state["opening_price"] = get_opening_price()
        if state["opening_price"]:
            print(f"[시가 기록] {settings['symbol']} 시가: ${state['opening_price']}")

    current = get_current_price()
    if current is None:
        return

    state["last_price"] = current
    now_str = datetime.now(ZoneInfo("Asia/Seoul")).strftime("%H:%M:%S")

    # 가격 히스토리 (최대 100개 유지)
    state["price_history"].append({"time": now_str, "price": current})
    if len(state["price_history"]) > 100:
        state["price_history"].pop(0)

    if state["opening_price"]:
        drop = (current - state["opening_price"]) / state["opening_price"]
        state["status"] = f"모니터링중 ({drop*100:+.2f}%)"
        if drop <= -settings["drop_threshold"]:
            print(f"[신호 감지] ${current} | {drop*100:.2f}%")
            place_buy_order(current)


# ── 제어 ─────────────────────────────────────────────────

def start_trading():
    state["is_running"] = True
    state["opening_price"] = None
    state["status"] = "실행중"


def stop_trading():
    state["is_running"] = False
    state["status"] = "정지됨"
    state["opening_price"] = None


def update_settings(symbol: Optional[str], drop_threshold_pct: Optional[float], buy_amount_usd: Optional[float]):
    if symbol:
        settings["symbol"] = symbol.upper()
        state["opening_price"] = None
        state["price_history"] = []
    if drop_threshold_pct is not None:
        settings["drop_threshold"] = drop_threshold_pct / 100
    if buy_amount_usd is not None:
        settings["buy_amount_usd"] = buy_amount_usd


def get_state() -> dict:
    return {
        **state,
        "symbol": settings["symbol"],
        "drop_threshold_pct": settings["drop_threshold"] * 100,
        "buy_amount_usd": settings["buy_amount_usd"],
    }


def get_account_info() -> dict:
    try:
        account = trading_client.get_account()
        return {
            "cash": float(account.cash),
            "portfolio_value": float(account.portfolio_value),
            "buying_power": float(account.buying_power),
        }
    except Exception as e:
        return {"error": str(e)}
