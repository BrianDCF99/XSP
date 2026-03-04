- each strategy gets their own emoji for all notifications
- as default for template 🎯 this will be used
- TICKER is a placeholder for the actual ticker that is clickable to go into exchange app directly to the ticker futures page
- if multiple coins have a funding event it should be a single message with all the coins

## /info strategyName Command
🐦‍🔥 StrategyName V#

Leverage: #x
Margin: $ (could be min($, cash * 1%) kinda thing so the whole thing included)

Entry:
    Sell Ratio <= 0.2
    Volume >= 1,000,000
    Live trades < 15

Exit:
    Take Profit: +20% leveraged
    ΔSR: 0.1
    Replacement Threshold: -5%


## /strategyName Command
🐦‍🔥 StrategyName V#
📈 Open Positions

1. TICKER - Bybit: E: $priceatEntrty | C: $currPrice
      E: $priceAtEntry | PNL: currPNL% / $currPNL | DD - HH:MM (time since Entry)
      C: $currPrice | TP: $takeProfit | L: $liquidation

2. TICKER - Bybit: E: $priceatEntrty | C: $currPrice
      E: $priceAtEntry | PNL: currPNL% / $currPNL  | DD - HH:MM (time since Entry)
      C: $currPrice | TP: $takeProfit | L: $liquidation

3. TICKER - Bybit: E: $priceatEntrty | C: $currPrice
      E: $priceAtEntry | PNL: currPNL% / $currPNL  | DD - HH:MM (time since Entry)
      C: $currPrice | TP: $takeProfit | L: $liquidation

4. ... etc

Live Stats: (this line bold)

PNL:  % | $
Unrealized PNL: $ | %

Entries: #entries | O: #opentrades | M: #missed trades
Winners: #winners | Losers: #losers  | Win %: %
Replaced: #replaced| Liq'd: #liquidations

Eq: $currentEquity | Cash: $(currEq-marginInUse)
M: $marginInUse | N: $openNotional

Net Funding: $


## Funding Update
🐦‍🔥 StrategyName V#
💸 Fudnding Update:

1. TICKER: $funding | Net: $netFunding (+ or -, NET as in accumulation for all the funding updates while the trade was open)

2. TICKER: $funding | Net: $netFunding

Account Update:
Eq: $currentEquity | Cash: $(currEq-marginInUse)
M: $marginInUse | N: $openNotional


## Exit Available
🐦‍🔥 StrategyName V#
✅(❌ - for loss)EXIT: Reason (Each strat has own exit reasons)

TICKER - Bybit: E: $priceatEntrty | C: $currPrice
    E: $priceAtEntry | PNL: currPNL% / $currPNL  | DD - HH:MM (time since Entry)
    C: $currPrice | TP: $takeProfit | L: $liquidation

*** Closed | Refresh *** Buttons


## Exit Confirmed
🐦‍🔥 StrategyName V#
✅(❌ - for loss)EXIT: Reason (Each strat has own exit reasons)

TICKER:
PNL: $ | % (Realized pnl including the entry and exit fees slippages and stuff)
Exit Slippage: x.xx bps
Roundtrip Slippage: x.xx bps
Funding: $ (could be - to indicate net negative)

Account Update:
Eq: $currentEquity | Cash: $(currEq-marginInUse)
M: $marginInUse | N: $openNotional


## Entry Available
🐦‍🔥 StrategyName V#
🟢 Entry Available:

TICKER:
Bybit: E: $priceAtAlert
Mexc:  E: $priceAtAlert

Margin: $MarginToPut

    x.xxxx
    x,xxx,xxx
    #

*** Opened | Refresh *** Buttons


## Replacement Available
🐦‍🔥 StrategyName V#
🚨 Replacement:

Loser: TICKER - Bybit: E: $priceatEntrty | C: $currPrice
    E: $priceAtEntry | PNL: currPNL% / $currPNL  | DD - HH:MM (time since Entry)
    C: $currPrice | TP: $takeProfit | L: $liquidation

New:
TICKER:
Bybit: E: $priceAtAlert
Mexc:  E: $priceAtAlert

Margin: $MarginToPut

    x.xxxx
    x,xxx,xxx
    currPNL%

*** Opened | Refresh *** Buttons


## Entry Confirmed
🐦‍🔥 StrategyName V#
🍀 Opened Trade:

TICKER
E: $entryPrice | RE: $realizedPrice
TP: $takeProfit | L: $liquidation

Entry Slippage: x.xx bps

Account Update:
Eq: $currentEquity | Cash: $(currEq-marginInUse)
M: $marginInUse | N: $openNotional


## Waiting For Confirmation
🐦‍🔥 StrategyName V#
⏳ Waiting for trade confirmation:

TICKER


## External Position Detected
🐦‍🔥 StrategyName V#
🧭 External Position Detected:

TICKER
E: $entryPrice | TP: $takeProfit | L: $liquidation

*** Track | Do Not Track *** Buttons


## /refresh Command
bot poll mexc for my recent trades
