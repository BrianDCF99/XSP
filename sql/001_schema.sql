-- LiveTrader base schema
create extension if not exists pgcrypto;

-- Enums
do $$
begin
  if not exists (select 1 from pg_type where typname = 'lt_run_status') then
    create type lt_run_status as enum ('RUNNING', 'SUCCESS', 'FAILED');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'lt_strategy_run_status') then
    create type lt_strategy_run_status as enum ('RUNNING', 'SUCCESS', 'FAILED');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'lt_side') then
    create type lt_side as enum ('LONG', 'SHORT');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'lt_position_status') then
    create type lt_position_status as enum ('OPEN', 'CLOSED', 'LIQUIDATED', 'REPLACED');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'lt_position_event_type') then
    create type lt_position_event_type as enum ('ENTRY', 'EXIT', 'REPLACE', 'LIQUIDATION', 'FUNDING');
  end if;
end $$;

-- Top-level cycle runs
create table if not exists lt_runs (
  id uuid primary key default gen_random_uuid(),
  exchange text not null,
  status lt_run_status not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_message text
);

create index if not exists idx_lt_runs_started_at on lt_runs (started_at desc);
create index if not exists idx_lt_runs_exchange_status on lt_runs (exchange, status);

-- Market snapshot payloads are archived locally in NDJSON only (not persisted in DB).

-- Strategy run per cycle
create table if not exists lt_strategy_runs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references lt_runs(id) on delete cascade,
  strategy_name text not null,
  status lt_strategy_run_status not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_message text
);

create index if not exists idx_lt_strategy_runs_run_id on lt_strategy_runs (run_id);
create index if not exists idx_lt_strategy_runs_strategy_time on lt_strategy_runs (strategy_name, started_at desc);

-- Outbound messages
create table if not exists lt_strategy_messages (
  id bigserial primary key,
  cycle_run_id uuid not null references lt_runs(id) on delete cascade,
  strategy_run_id uuid not null references lt_strategy_runs(id) on delete cascade,
  strategy_name text not null,
  message_type text not null,
  symbol text,
  body text not null,
  telegram_message_id bigint,
  created_at timestamptz not null default now()
);

alter table lt_strategy_messages
  add column if not exists manual_alert_id uuid;

create index if not exists idx_lt_strategy_messages_strategy_time on lt_strategy_messages (strategy_name, created_at desc);
create index if not exists idx_lt_strategy_messages_cycle on lt_strategy_messages (cycle_run_id);
create index if not exists idx_lt_strategy_messages_manual_alert_id on lt_strategy_messages (manual_alert_id);

-- Manual action alerts (entry/exit/replacement available messages with button actions)
create table if not exists lt_manual_alerts (
  id uuid primary key default gen_random_uuid(),
  cycle_run_id uuid references lt_runs(id) on delete set null,
  strategy_name text not null,
  kind text not null,
  primary_symbol text not null,
  secondary_symbol text,
  reason text,
  status text not null default 'PENDING',
  requested_action text,
  payload jsonb not null default '{}'::jsonb,
  telegram_message_id bigint,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_checked_at timestamptz,
  confirmed_at timestamptz
);

create index if not exists idx_lt_manual_alerts_strategy_time on lt_manual_alerts (strategy_name, created_at desc);
create index if not exists idx_lt_manual_alerts_status_time on lt_manual_alerts (status, created_at desc);
create index if not exists idx_lt_manual_alerts_symbol_status on lt_manual_alerts (primary_symbol, status);

-- Coins each strategy tracks
create table if not exists lt_tracked_symbols (
  strategy_name text not null,
  symbol text not null,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (strategy_name, symbol)
);

-- Position lifecycle (state table)
create table if not exists lt_positions (
  id uuid primary key,
  strategy_name text not null,
  symbol text not null,
  exchange text not null,
  side lt_side not null,
  status lt_position_status not null,
  entry_time timestamptz not null,
  entry_price numeric(30, 12) not null,
  qty numeric(30, 12),
  leverage numeric(12, 4),
  margin_usd numeric(30, 12),
  notional_usd numeric(30, 12),
  take_profit_price numeric(30, 12),
  entry_sell_ratio numeric(18, 8),
  entry_slippage_bps numeric(18, 8),
  exit_time timestamptz,
  exit_price numeric(30, 12),
  pnl_pct numeric(18, 8),
  pnl_usd numeric(30, 12),
  funding_usd numeric(30, 12),
  reason text,
  exit_slippage_bps numeric(18, 8),
  roundtrip_slippage_bps numeric(18, 8),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_lt_positions_strategy_status on lt_positions (strategy_name, status);
create index if not exists idx_lt_positions_symbol_status on lt_positions (symbol, status);
create index if not exists idx_lt_positions_entry_time on lt_positions (entry_time desc);
create unique index if not exists idx_lt_positions_open_unique
  on lt_positions (strategy_name, symbol)
  where status = 'OPEN';

alter table lt_positions
  add column if not exists take_profit_price numeric(30, 12);

alter table lt_positions
  add column if not exists entry_sell_ratio numeric(18, 8);

alter table lt_positions
  add column if not exists entry_slippage_bps numeric(18, 8);

-- Immutable event ledger
create table if not exists lt_position_events (
  id bigserial primary key,
  cycle_run_id uuid not null references lt_runs(id) on delete cascade,
  strategy_name text not null,
  symbol text not null,
  exchange text not null,
  side lt_side not null,
  event_type lt_position_event_type not null,
  event_time timestamptz not null,
  price numeric(30, 12) not null,
  qty numeric(30, 12),
  leverage numeric(12, 4),
  margin_usd numeric(30, 12),
  notional_usd numeric(30, 12),
  pnl_pct numeric(18, 8),
  pnl_usd numeric(30, 12),
  reason text,
  funding_usd numeric(30, 12),
  take_profit_price numeric(30, 12),
  entry_sell_ratio numeric(18, 8),
  entry_slippage_bps numeric(18, 8),
  exit_slippage_bps numeric(18, 8),
  roundtrip_slippage_bps numeric(18, 8),
  created_at timestamptz not null default now()
);

create index if not exists idx_lt_position_events_strategy_time on lt_position_events (strategy_name, event_time desc);
create index if not exists idx_lt_position_events_symbol_time on lt_position_events (symbol, event_time desc);
create index if not exists idx_lt_position_events_event_type on lt_position_events (event_type, event_time desc);

alter table lt_position_events
  add column if not exists take_profit_price numeric(30, 12);

alter table lt_position_events
  add column if not exists entry_sell_ratio numeric(18, 8);

-- Strategy-level account snapshots
create table if not exists lt_account_snapshots (
  id bigserial primary key,
  strategy_name text not null,
  observed_at timestamptz not null,
  equity_usd numeric(30, 12) not null,
  cash_usd numeric(30, 12) not null,
  margin_in_use_usd numeric(30, 12) not null,
  open_notional_usd numeric(30, 12) not null,
  unrealized_pnl_usd numeric(30, 12) not null,
  realized_pnl_usd numeric(30, 12) not null,
  winners int not null,
  losers int not null,
  liquidations int not null,
  replaced int not null,
  entries int not null,
  exits int not null,
  open_positions int not null,
  missed int not null,
  net_funding_usd numeric(30, 12) not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_lt_account_snapshots_strategy_time on lt_account_snapshots (strategy_name, observed_at desc);

-- Keep lt_positions.updated_at fresh
create or replace function lt_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_lt_positions_touch_updated_at on lt_positions;
create trigger trg_lt_positions_touch_updated_at
before update on lt_positions
for each row execute function lt_touch_updated_at();

drop trigger if exists trg_lt_manual_alerts_touch_updated_at on lt_manual_alerts;
create trigger trg_lt_manual_alerts_touch_updated_at
before update on lt_manual_alerts
for each row execute function lt_touch_updated_at();
