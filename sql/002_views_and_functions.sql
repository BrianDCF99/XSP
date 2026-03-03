-- Analytics views and convenience function

create or replace view lt_strategy_win_rate as
select
  strategy_name,
  count(*) filter (where status in ('CLOSED', 'REPLACED', 'LIQUIDATED')) as closed_positions,
  count(*) filter (where status in ('CLOSED', 'REPLACED', 'LIQUIDATED') and coalesce(pnl_usd, 0) > 0) as winners,
  count(*) filter (where status in ('CLOSED', 'REPLACED', 'LIQUIDATED') and coalesce(pnl_usd, 0) <= 0) as losers,
  case
    when count(*) filter (where status in ('CLOSED', 'REPLACED', 'LIQUIDATED')) = 0 then 0
    else round(
      (
        count(*) filter (where status in ('CLOSED', 'REPLACED', 'LIQUIDATED') and coalesce(pnl_usd, 0) > 0)::numeric
        / count(*) filter (where status in ('CLOSED', 'REPLACED', 'LIQUIDATED'))::numeric
      ) * 100,
      4
    )
  end as win_rate_pct
from lt_positions
group by strategy_name;

create or replace view lt_strategy_live_stats as
select
  p.strategy_name,
  count(*) filter (where p.status = 'OPEN') as open_positions,
  coalesce(sum(case when p.status = 'OPEN' then p.margin_usd else 0 end), 0) as margin_in_use_usd,
  coalesce(sum(case when p.status = 'OPEN' then p.notional_usd else 0 end), 0) as open_notional_usd,
  coalesce(sum(case when p.status in ('CLOSED', 'REPLACED', 'LIQUIDATED') then p.pnl_usd else 0 end), 0) as realized_pnl_usd,
  coalesce(sum(case when p.status in ('CLOSED', 'REPLACED', 'LIQUIDATED') then p.funding_usd else 0 end), 0) as net_funding_usd,
  count(*) filter (where p.status = 'LIQUIDATED') as liquidations,
  count(*) filter (where p.status = 'REPLACED') as replaced
from lt_positions p
group by p.strategy_name;

create or replace view lt_recent_liquidations as
select
  strategy_name,
  symbol,
  exchange,
  event_time,
  price,
  pnl_pct,
  pnl_usd,
  reason
from lt_position_events
where event_type = 'LIQUIDATION'
order by event_time desc;

create or replace view lt_recent_funding as
select
  strategy_name,
  symbol,
  event_time,
  funding_usd,
  pnl_usd,
  reason
from lt_position_events
where event_type = 'FUNDING'
order by event_time desc;

create or replace function lt_strategy_summary(p_strategy_name text)
returns table (
  strategy_name text,
  open_positions bigint,
  margin_in_use_usd numeric,
  open_notional_usd numeric,
  realized_pnl_usd numeric,
  net_funding_usd numeric,
  closed_positions bigint,
  winners bigint,
  losers bigint,
  win_rate_pct numeric,
  liquidations bigint,
  replaced bigint
)
language sql
as $$
  select
    live.strategy_name,
    live.open_positions,
    live.margin_in_use_usd,
    live.open_notional_usd,
    live.realized_pnl_usd,
    live.net_funding_usd,
    wr.closed_positions,
    wr.winners,
    wr.losers,
    wr.win_rate_pct,
    live.liquidations,
    live.replaced
  from lt_strategy_live_stats live
  join lt_strategy_win_rate wr
    on wr.strategy_name = live.strategy_name
  where live.strategy_name = p_strategy_name;
$$;
