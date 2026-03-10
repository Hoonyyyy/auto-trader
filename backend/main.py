"""
FastAPI 서버
- 프론트엔드에 API 제공
- APScheduler로 30초마다 자동 체크
"""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from apscheduler.schedulers.background import BackgroundScheduler
from alpaca.trading.client import TradingClient
from alpaca.trading.requests import GetAssetsRequest
from alpaca.trading.enums import AssetClass, AssetStatus
import os
from dotenv import load_dotenv
import trader

load_dotenv()
_trading_client = TradingClient(os.getenv("ALPACA_API_KEY"), os.getenv("ALPACA_SECRET_KEY"), paper=True)

app = FastAPI(title="Auto Trader API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_methods=["*"],
    allow_headers=["*"],
)

scheduler = BackgroundScheduler()
scheduler.add_job(trader.run_check, "interval", seconds=30, id="trader_job")
scheduler.start()


class SettingsRequest(BaseModel):
    symbol: Optional[str] = None
    drop_threshold_pct: Optional[float] = None
    buy_amount_usd: Optional[float] = None


@app.get("/api/status")
def get_status():
    return {
        "trader": trader.get_state(),
        "account": trader.get_account_info(),
    }


@app.post("/api/start")
def start():
    trader.start_trading()
    return {"message": "자동매매 시작"}


@app.post("/api/stop")
def stop():
    trader.stop_trading()
    return {"message": "자동매매 정지"}


@app.get("/api/search-symbol")
def search_symbol(q: str = Query(..., min_length=1)):
    """종목 심볼 검색 (실제 Alpaca 상장 종목만)"""
    try:
        q = q.upper()
        req = GetAssetsRequest(asset_class=AssetClass.US_EQUITY, status=AssetStatus.ACTIVE)
        assets = _trading_client.get_all_assets(req)
        results = [
            {"symbol": a.symbol, "name": a.name}
            for a in assets
            if a.tradable and (a.symbol.startswith(q) or q in a.symbol)
        ]
        results.sort(key=lambda x: (not x["symbol"].startswith(q), len(x["symbol"])))
        return {"results": results[:10]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/settings")
def update_settings(req: SettingsRequest):
    if req.symbol:
        # 실제 상장 종목인지 검증
        try:
            asset = _trading_client.get_asset(req.symbol.upper())
            if not asset.tradable:
                raise HTTPException(status_code=400, detail=f"{req.symbol} 은(는) 현재 거래 불가 종목입니다.")
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=400, detail=f"'{req.symbol}' 은(는) 존재하지 않는 종목입니다.")
    trader.update_settings(req.symbol, req.drop_threshold_pct, req.buy_amount_usd)
    return {"message": "설정 저장 완료", "settings": {
        "symbol": trader.settings["symbol"],
        "drop_threshold_pct": trader.settings["drop_threshold"] * 100,
        "buy_amount_usd": trader.settings["buy_amount_usd"],
    }}


@app.get("/api/orders")
def get_orders():
    return {"orders": trader.state["orders"]}


@app.get("/")
def root():
    return {"message": "Auto Trader API 실행중"}
