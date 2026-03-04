# LiveTrader

LiveTrader is a config-driven live futures runner with strict separation between:

- Core bot logic (exchange puller, scheduler, storage, strategy execution, notifications)
- Strategy logic (isolated in `strategies/<name>/strategy.(ts|js)` and executed in worker threads)

The root `config.yaml` intentionally contains no strategy rules. It only contains runtime/bot settings and the list of active strategy folders.

## Key Guarantees

- Fixed dual-source model: Bybit for signals, MEXC for execution/account state
- Strategy activation is YAML-only (`strategies.active`)
- Strategy execution is offloaded to worker threads
- Main strategy loop never writes market payloads to local files
- Market snapshots are local-only (never persisted to Supabase)
- Strategy events/statistics are persisted to Supabase tables/views
- Entry/exit actions are manual-trade aware: bot alerts + Telegram buttons + exchange reconciliation (no API order placement)
- Boot flow reconciles actual exchange history and persists detected offline closes before status publishing

## Layout

- `config.yaml`: runtime configuration (no strategy internals)
- `.env.example`: required secrets
- `sql/`: Supabase schema and analytics views
- `src/`: core runtime modules (small SRP units)
- `strategies/<name>/strategy.md`: strategy spec
- `strategies/<name>/telegram.md`: telegram spec
- `strategies/<name>/strategy.(ts|js)`: strategy entry function
- `TG_Messages.md`: root telegram template source-of-truth

## Run

1. Install dependencies

```bash
npm install
```

2. Fill environment variables

```bash
cp .env.example .env
```

3. Apply SQL scripts to Supabase in order

- `sql/001_schema.sql`
- `sql/002_views_and_functions.sql`

or run:

- `sql/000_apply_all.sql`

4. Start

```bash
npm run dev
```

## Deploy

- Systemd unit: `deploy/livetrader.service`
- PM2 ecosystem: `deploy/pm2.ecosystem.config.cjs`

## Scheduler

Controlled by `scheduler.cadence`:

- `unit: minute` + `every: 1` + `offsetSeconds: 15` => every minute at `:15`
- `unit: hour` + `every: 1` + `offsetSeconds: 15` => every hour at `00:00:15`
- `offsetSeconds` is the tuning knob for your data-release sweet spot (change in `config.yaml`, no code change needed)

## Futures Collector

- Main strategy collection merges:
  - `exchange.signal.futuresEndpoints` (Bybit signal metrics)
  - `exchange.execution.futuresEndpoints` (MEXC execution prices/contracts)
- Strategy/refresh/status logic reads from this merged snapshot and applies source-aware parsing.
- This path is read-only and does not write local market archives.

## Boot Recovery

At startup, before the normal scheduler loop:

- Open positions are loaded from DB.
- For MEXC manual mode, exchange open-positions + history are polled and real offline closes are persisted to DB.
- A fresh snapshot is fetched for current price/status rendering.
- Offline reconciliation checks are evaluated for still-open positions (`TP_BOOT_RECON`, `LIQ_BOOT_RECON`).
- Telegram strategy-template messages are sent:
  - Exit-confirmed messages for any positions detected as closed while bot was offline
  - `/strategyName`-style open-position snapshot
  - `Manual Action Required` section listing symbols that should have been sold while the bot was offline

## Strategy Contract

Each strategy module exports:

```ts
export async function entry(input: StrategyWorkerInput): Promise<StrategyWorkerOutput>
```

The input market snapshot is treated as read-only by contract. The strategy returns messages and state events only.

## Live Account Source

- Account/equity/cash/margin values prefer live exchange snapshot extraction when account endpoints are configured.
- In MEXC manual-execution mode, `/strategy` and confirmation/reconciliation flows pull account state from MEXC private endpoints.
- In MEXC manual-execution mode, strict source-of-truth is enforced for equity/cash/margin/notional/unrealized.
- Status PNL baseline uses the first recorded live snapshot equity for the strategy.

## Telegram Commands

Enabled when `telegram.enabled: true`.

- `/info <strategy_folder_name>`
- `/<strategy_folder_name>`
- `/refresh` (reconcile recent manual actions against exchange history)

## Telegram Transport Hardening

Telegram network handling is config-driven and retried automatically:

- `telegram.apiBaseUrl` (default `https://api.telegram.org`)
- `telegram.requestTimeoutMs` (per request timeout)
- `telegram.maxRetries` (network + 5xx/429 retries)
- `telegram.retryBaseDelayMs` + `telegram.retryMaxDelayMs` (exponential backoff window)
- `telegram.getUpdatesLongPollSeconds` (Telegram long-poll timeout; `0` keeps short-poll behavior)
- `telegram.preferIpv4` (forces process DNS resolution to `ipv4first`)

Security note: Telegram bot token is redacted in runtime request-error logs.

## Manual Action Flow

- Strategy sends `Entry Available`, `Exit Available`, `Replacement Available` messages with inline buttons.
- Entry/Replacement buttons: `Opened`, `Refresh`.
- Exit buttons: `Closed`, `Refresh`.
- `Opened` / `Closed` triggers exchange polling for real fills.
- If fill is not visible yet, bot sends waiting notice and keeps polling (`manualExecution.pendingPollMs`).
- Hourly auto-reconciliation runs via `manualExecution.autoRefreshMinutes`.
- If reconciliation detects a close without a prior exit alert, reason is recorded and sent as `manual exit`.

## Required Env Tags

- `MEXC_API_KEY=`
- `MEXC_API_SECRET=`

MEXC transport values are config-driven in `config.yaml`:

- `exchange.execution.privateApi.baseUrl`
- `exchange.execution.privateApi.recvWindowMs`

Example (default strategy):

- `/info xsp`
- `/xsp`
