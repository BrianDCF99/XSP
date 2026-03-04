# Extreme Sell Pressure V19

## Account Information
- Leverage: 5x
- Signal Source: Bybit (sell ratio + volume + Bybit alert prices)
- Execution Source: MEXC (manual fills, account source of truth, MEXC prices for PNL/TP/Liq)
- Starting Equity: Live MEXC equity at strategy start
- Cash: Equity - Margin in use
- Margin: min(500, Cash*0.01)
- Concurrent Trade Cap: 15

## Entry Conditions
- Sell Ratio <= 0.2
- Volume >= 1,000,000
- Live trades < Concurrent Cap

## Replacement Condition
- Replacement Threshold: -5%
- When new alert come in, if Live Trades == CAP, worst trade with PNL <= -5% will be replaced 
- If no trades are under -5% pnl *At the moment alert comes in* no replacement will be made

## Exit Conditions
- Take Profit: +20% leveraged (4% unleveraged calculated from realized costs not what was put throuhg) 
- Sell Ratio Delta from entry: 0.1 
- Replacement


## Conditions not included
- Time out: 48 hours ( NOT INCLUDED )
- 
