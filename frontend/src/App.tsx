import React, { useEffect, useState, useRef, useCallback } from "react";
import axios from "axios";
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import "./App.css";

const API = "http://localhost:8000/api";

interface PricePoint { time: string; price: number; }
interface Order {
  id: string; time: string; symbol: string;
  amount_usd: number; trigger_price: number;
  opening_price: number; drop_pct: number;
}
interface TraderState {
  symbol: string; opening_price: number | null;
  last_price: number | null; status: string;
  is_running: boolean; orders: Order[];
  drop_threshold_pct: number; buy_amount_usd: number;
  price_history: PricePoint[];
}
interface Account {
  cash?: number; portfolio_value?: number;
  buying_power?: number; error?: string;
}
interface SymbolResult { symbol: string; name: string; }

function App() {
  const [trader, setTrader] = useState<TraderState | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(false);

  const [symbol, setSymbol] = useState("");
  const [threshold, setThreshold] = useState("");
  const [buyAmount, setBuyAmount] = useState("");
  const [settingSaved, setSettingSaved] = useState(false);
  const [settingError, setSettingError] = useState("");

  // 자동완성
  const [suggestions, setSuggestions] = useState<SymbolResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const symbolRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await axios.get(`${API}/status`);
      setTrader(res.data.trader);
      setAccount(res.data.account);
      setSymbol((s) => s || res.data.trader.symbol);
      setThreshold((s) => s || String(res.data.trader.drop_threshold_pct));
      setBuyAmount((s) => s || String(res.data.trader.buy_amount_usd));
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (symbolRef.current && !symbolRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSymbolChange = (val: string) => {
    const upper = val.toUpperCase();
    setSymbol(upper);
    setSettingError("");

    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (upper.length < 1) { setSuggestions([]); setShowSuggestions(false); return; }

    searchTimer.current = setTimeout(async () => {
      try {
        const res = await axios.get(`${API}/search-symbol?q=${upper}`);
        setSuggestions(res.data.results);
        setShowSuggestions(true);
      } catch { setSuggestions([]); }
    }, 300);
  };

  const handleSelectSymbol = (s: SymbolResult) => {
    setSymbol(s.symbol);
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const handleSaveSettings = async () => {
    setSettingError("");
    try {
      await axios.post(`${API}/settings`, {
        symbol: symbol || undefined,
        drop_threshold_pct: threshold ? parseFloat(threshold) : undefined,
        buy_amount_usd: buyAmount ? parseFloat(buyAmount) : undefined,
      });
      setSettingSaved(true);
      setTimeout(() => setSettingSaved(false), 2000);
      await fetchStatus();
    } catch (e: any) {
      setSettingError(e.response?.data?.detail ?? "저장 실패");
    }
  };

  const handleStart = async () => {
    setLoading(true);
    await axios.post(`${API}/start`);
    await fetchStatus();
    setLoading(false);
  };

  const handleStop = async () => {
    setLoading(true);
    await axios.post(`${API}/stop`);
    await fetchStatus();
    setLoading(false);
  };

  const dropPct =
    trader?.opening_price && trader?.last_price
      ? ((trader.last_price - trader.opening_price) / trader.opening_price) * 100
      : null;

  return (
    <div className="app">
      <header className="header">
        <h1>🤖 Auto Trader</h1>
        <span className="subtitle">{trader?.symbol ?? "AAPL"} 자동매매 시스템</span>
      </header>

      <div className="grid top-grid">
        {/* 계좌 정보 */}
        <div className="card">
          <h2>💰 계좌 정보</h2>
          {account?.error ? <p className="error">{account.error}</p> : (
            <div className="stat-list">
              <Stat label="현금 잔고" value={account?.cash != null ? `$${account.cash.toLocaleString()}` : "-"} />
              <Stat label="총 자산" value={account?.portfolio_value != null ? `$${account.portfolio_value.toLocaleString()}` : "-"} />
              <Stat label="주문 가능 금액" value={account?.buying_power != null ? `$${account.buying_power.toLocaleString()}` : "-"} />
            </div>
          )}
        </div>

        {/* 모니터링 현황 */}
        <div className="card">
          <h2>📊 모니터링 현황</h2>
          <div className="stat-list">
            <Stat label="종목" value={trader?.symbol ?? "-"} />
            <Stat label="시가" value={trader?.opening_price != null ? `$${trader.opening_price}` : "미조회"} />
            <Stat label="현재가" value={trader?.last_price != null ? `$${trader.last_price}` : "-"} />
            <Stat
              label="등락률"
              value={dropPct !== null ? `${dropPct.toFixed(2)}%` : "-"}
              color={dropPct !== null ? (dropPct < 0 ? "#ef4444" : "#22c55e") : undefined}
            />
            <Stat
              label="매수 조건"
              value={trader?.drop_threshold_pct != null && trader?.buy_amount_usd != null
                ? `-${trader.drop_threshold_pct}% 하락 시 $${trader.buy_amount_usd}`
                : "-"}
            />
          </div>
        </div>

        {/* 제어판 */}
        <div className="card control-card">
          <h2>⚙️ 제어판</h2>
          <div className="status-badge" style={{ background: trader?.is_running ? "#22c55e" : "#6b7280" }}>
            {trader?.status ?? "연결중..."}
          </div>
          <div className="buttons">
            <button className="btn btn-start" onClick={handleStart} disabled={loading || !!trader?.is_running}>▶ 시작</button>
            <button className="btn btn-stop" onClick={handleStop} disabled={loading || !trader?.is_running}>■ 정지</button>
          </div>
          <p className="hint">* 30초마다 가격 체크 / 5초마다 화면 갱신</p>
        </div>
      </div>

      {/* 설정 패널 */}
      <div className="card settings-card">
        <h2>🔧 매매 설정</h2>
        <div className="settings-grid">
          {/* 종목 심볼 + 자동완성 */}
          <div className="setting-item" ref={symbolRef}>
            <label>종목 심볼</label>
            <div className="autocomplete-wrap">
              <input
                value={symbol}
                onChange={(e) => handleSymbolChange(e.target.value)}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                placeholder="AAPL"
                autoComplete="off"
              />
              {showSuggestions && suggestions.length > 0 && (
                <ul className="suggestions">
                  {suggestions.map((s) => (
                    <li key={s.symbol} onMouseDown={() => handleSelectSymbol(s)}>
                      <span className="sug-symbol">{s.symbol}</span>
                      <span className="sug-name">{s.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="setting-item">
            <label>하락 조건 (%)</label>
            <input type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="1" step="0.1" min="0.1" />
          </div>
          <div className="setting-item">
            <label>매수 금액 (USD)</label>
            <input type="number" value={buyAmount} onChange={(e) => setBuyAmount(e.target.value)} placeholder="1.0" step="0.5" min="1" />
          </div>
          <div className="setting-item setting-btn-wrap">
            <button className={`btn ${settingSaved ? "btn-saved" : "btn-save"}`} onClick={handleSaveSettings}>
              {settingSaved ? "✓ 저장됨" : "저장"}
            </button>
          </div>
        </div>
        {settingError && <p className="error" style={{ marginTop: 8 }}>⚠ {settingError}</p>}
      </div>

      {/* 가격 차트 */}
      <div className="card chart-card">
        <h2>📈 실시간 가격 차트 ({trader?.symbol})</h2>
        {!trader?.price_history?.length ? (
          <p className="empty">자동매매 시작 후 가격 데이터가 쌓이면 차트가 표시됩니다.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trader.price_history} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} />
              <YAxis
                domain={["auto", "auto"]}
                tick={{ fill: "#64748b", fontSize: 11 }}
                tickLine={false} axisLine={false}
                tickFormatter={(v) => `$${v}`}
              />
              <Tooltip
                contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8 }}
                labelStyle={{ color: "#94a3b8" }}
                itemStyle={{ color: "#60a5fa" }}
                formatter={(v: any) => [`$${v}`, "가격"]}
              />
              {trader.opening_price && (
                <ReferenceLine y={trader.opening_price} stroke="#f59e0b" strokeDasharray="4 4"
                  label={{ value: "시가", fill: "#f59e0b", fontSize: 11 }} />
              )}
              {trader.opening_price && trader.drop_threshold_pct && (
                <ReferenceLine
                  y={trader.opening_price * (1 - trader.drop_threshold_pct / 100)}
                  stroke="#ef4444" strokeDasharray="4 4"
                  label={{ value: "매수선", fill: "#ef4444", fontSize: 11 }}
                />
              )}
              <Line type="monotone" dataKey="price" stroke="#60a5fa" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* 주문 내역 */}
      <div className="card orders-card">
        <h2>📋 자동매수 내역 ({trader?.orders?.length ?? 0}건) <span className="persisted-badge">재시작 후에도 유지</span></h2>
        {!trader?.orders?.length ? (
          <p className="empty">아직 자동매수가 실행되지 않았습니다.</p>
        ) : (
          <table>
            <thead>
              <tr><th>시간</th><th>종목</th><th>시가</th><th>매수가</th><th>하락률</th><th>금액</th></tr>
            </thead>
            <tbody>
              {[...trader.orders].reverse().map((o) => (
                <tr key={o.id}>
                  <td>{o.time}</td><td>{o.symbol}</td>
                  <td>${o.opening_price}</td><td>${o.trigger_price}</td>
                  <td style={{ color: "#ef4444" }}>{o.drop_pct}%</td>
                  <td>${o.amount_usd}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <span className="value" style={color ? { color } : undefined}>{value}</span>
    </div>
  );
}

export default App;
