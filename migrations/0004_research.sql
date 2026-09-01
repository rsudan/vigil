-- Document-grounded amendments and peer-strategy research.

create table if not exists amendments (
  id                serial primary key,
  strategy_id       integer not null references strategies (id) on delete cascade,
  user_id           text not null,
  intensity         text not null check (intensity in ('watch', 'amend', 'refresh', 'reset')),
  location          text not null default '',
  original_excerpt  text not null default '',
  proposed_text     text not null,
  rationale         text not null default '',
  assumption_id     integer references assumptions (id) on delete set null,
  source            text not null default 'monitor' check (source in ('monitor', 'peer')),
  created_at        timestamptz not null default now()
);
create index if not exists amendments_strategy_idx on amendments (strategy_id, user_id, created_at desc);

create table if not exists peer_research (
  id              serial primary key,
  strategy_id     integer not null references strategies (id) on delete cascade,
  user_id         text not null,
  recency_years   integer not null default 5,
  query           text not null default '',
  summary         text not null default '',
  created_at      timestamptz not null default now()
);
create index if not exists peer_research_strategy_idx on peer_research (strategy_id, user_id, created_at desc);

create table if not exists peer_findings (
  id              serial primary key,
  research_id     integer not null references peer_research (id) on delete cascade,
  country         text not null default '',
  title           text not null,
  year            text not null default '',
  url             text not null default '',
  idea            text not null default '',
  relevance       text not null default '',
  intensity       text not null default 'watch',
  category        integer
);
create index if not exists peer_findings_research_idx on peer_findings (research_id);
