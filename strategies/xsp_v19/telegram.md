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

1. TICKER              DD - HH:MM (time since Entry)
      Bybit: E: $priceatEntrty | C: $currPrice

      E: $priceAtEntry | PNL: currPNL% | PNL: $currPNL
      C: $currPrice | TP: $takeProfit | L: $liquidation

2. TICKER              DD - HH:MM (time since Entry)
      Bybit: E: $priceatEntrty | C: $currPrice

      E: $priceAtEntry | PNL: currPNL% | PNL: $currPNL
      C: $currPrice | TP: $takeProfit | L: $liquidation

3. TICKER              DD - HH:MM (time since Entry)
      Bybit: E: $priceatEntrty | C: $currPrice

      E: $priceAtEntry | PNL: currPNL% | PNL: $currPNL
      C: $currPrice | TP: $takeProfit | L: $liquidation

4. ... etc


Live Stats: (this line bold)

PNL:   % | $
U-PNL: % | $

Entries: #entries | O: #opentrades | M: #missed trades
Winners: #winners | Losers: #losers  |  (win%)%
Replaced: #replaced | Liq'd: #liquidations

Eq: $currentEquity | Cash: $(currEq-marginInUse)
M: $marginInUse | N: $openNotional

Net Funding: $


## Funding Update
🐦‍🔥 StrategyName V#                                                
💸 Fudnding Update:

1. TICKER | $funding | Net: $netFunding (+ or -, NET as in accumulation for all the funding updates while the trade was open)

2. TICKER | $funding | Net: $netFunding


Account Update: (this line bold)

Eq: $currentEquity | Cash: $(currEq-marginInUse)
M: $marginInUse | N: $openNotional

Net Funding: $


## Exit Available
🐦‍🔥 StrategyName V#                                                
✅(❌ - for loss)EXIT ALERT: Reason (Each strat has own exit reasons)

TICKER              DD - HH:MM (time since Entry)
    Bybit: E: $priceatEntrty | C: $currPrice

    E: $priceAtEntry | PNL: currPNL% | PNL: $currPNL
    C: $currPrice | TP: $takeProfit | L: $liquidation

*** Closed | Refresh *** Buttons


## Exit Confirmed
🐦‍🔥 StrategyName V#                                                
✅(❌ - for loss)CLOSED: Reason (Each strat has own exit reasons)

TICKER
Time: DD - HH:MM (time since Entry)
Entry: $Margin
Exit:  $ExitMargin

PNL: $ | % (Realized pnl including the entry and exit fees slippages and stuff)

Ex(Slippage): x.xx | En: x.xx | RT(Round trip slippage): x.xx 
Funding: $ (could be - to indicate net negative)


Account Update: (this line bold)

Eq: $currentEquity | Cash: $(currEq-marginInUse)
M: $marginInUse | N: $openNotional\

Net Funding: $


## Entry Available
🐦‍🔥 StrategyName V#                                                
🟢 Entry Available:

TICKER
    Bybit:  E: $priceAtAlert
    Mexc:  E: $priceAtAlert

    Margin: $MarginToPut
    TP: $TPestimateOnMexcPrice
    Liq'd: $liquidationPrice

    SR:           x.xx
    Vol:          x.xx M
    Opened: #

*** Opened | Decline | Refresh *** Buttons


## Replacement Available
🐦‍🔥 StrategyName V#                                                
🚨 Replacement:

Close:
TICKER              DD - HH:MM (time since Entry)
    Bybit: E: $priceatEntrty | C: $currPrice

    E: $priceAtEntry | PNL: currPNL% / $currPNL
    C: $currPrice | TP: $takeProfit | L: $liquidation

Open:
TICKER
    Bybit:  E: $priceAtAlert
    Mexc:  E: $priceAtAlert

    Margin: $MarginToPut

    SR:           x.xx
    Vol:          x.xx M
    Opened: #

*** Opened | Refresh *** Buttons


## Entry Confirmed
🐦‍🔥 StrategyName V#                                                
🍀 Opened Trade:

TICKER
    E: $entryPrice | RE: $realizedPrice
    TP: $takeProfit | L: $liquidation

    Entry Slippage: x.xx bps


Account Update: (this line bold)

Eq: $currentEquity | Cash: $(currEq-marginInUse)
M: $marginInUse | N: $openNotional

Net Funding: $


## Waiting For Confirmation
🐦‍🔥 StrategyName V#                                                
⏳ Waiting for trade confirmation:

1. TICKER
2. TICKER
3. TICKER


## External Position Detected
🐦‍🔥 StrategyName V#                                                
🧭 External Position Detected:

TICKER
    E: $entryPrice | TP: $takeProfit | L: $liquidation

    SR:           x.xx
    Vol:          x.xx M
    Opened: #
*** Track | Do Not Track *** Buttons


## /refresh Command
bot poll mexc for my recent trades



## /sig Symbol command
🐦‍🔥 StrategyName V#                                                
🫆 TICKER

    Bybit: $currPrice
    Mexc:  $currPrice

    SR:           x.xx
    Vol:          x.xx M

Symbol Summary:
    Trades: #numOfTrades
    Wins: #numOfWins
    Loses #numOfLoses
    Liq'd: #numOfLiqd
    Win %: win%

    Total PNL: $PNL
    Total Funding: $Funding


## /close command
- Coins will appear in the text as long as one signal is with in .1 Sell raio or 300,000 volume from threshold 

🐦‍🔥 StrategyName V#                                                
👀 Close Symbols

1. TICKER
    Bybit: $currPrice
    Mexc:  $currPrice
    SR:           x.xx
    Vol:          x.xx M

2. TICKER
    Bybit: $currPrice
    Mexc:  $currPrice
    SR:           x.xx
    Vol:          x.xx M

3. TICKER
    Bybit: $currPrice
    Mexc:  $currPrice
    SR:           x.xx
    Vol:          x.xx M
