-- Assessment with a basis. Delivery ratings carry who, when, and on what report;
-- evidence records whether a person or an accepted model draft produced it; a
-- neutral direction exists for work-order notes on untested bets.

create table if not exists delivery_ratings (
  id            serial primary key,
  strategy_id   integer not null references strategies (id) on delete cascade,
  user_id       text not null,
  rag           text not null check (rag in ('green', 'amber', 'red', 'unrated')),
  basis         text not null,
  source_label  text not null default '',
  source_url    text not null default '',
  as_of         date,
  method        text not null default 'person' check (method in ('person', 'desk')),
  created_at    timestamptz not null default now()
);
create index if not exists delivery_ratings_strategy_idx on delivery_ratings (strategy_id, created_at desc);

alter table evidence add column if not exists method text not null default 'person';
alter table evidence drop constraint if exists evidence_method_check;
alter table evidence add constraint evidence_method_check check (method in ('person', 'desk'));
alter table evidence drop constraint if exists evidence_direction_check;
alter table evidence add constraint evidence_direction_check
  check (direction in ('supporting', 'weakening', 'neutral'));

-- Colours set before a basis was required get a rating row that says so.
insert into delivery_ratings (strategy_id, user_id, rag, basis)
select s.id, s.user_id, s.delivery_rag,
       'Rated before Vigil recorded a basis for delivery ratings. Re-rate from the latest progress report.'
from strategies s
where s.delivery_rag <> 'unrated'
  and not exists (select 1 from delivery_ratings r where r.strategy_id = s.id);
