-- Vigil living-strategy monitor schema

create table if not exists profiles (
  user_id      text primary key,
  display_name text,
  email        text,
  role         text not null default 'member' check (role in ('admin', 'member')),
  created_at   timestamptz not null default now()
);

create table if not exists api_credentials (
  id            serial primary key,
  owner_user_id text not null,
  provider      text not null check (provider in ('xai', 'exa', 'jina')),
  scope         text not null check (scope in ('personal', 'org')),
  secret        text not null,
  last_four     text not null,
  label         text,
  created_at    timestamptz not null default now(),
  unique (owner_user_id, provider, scope)
);
create index if not exists api_credentials_owner_idx on api_credentials (owner_user_id);

create table if not exists api_credential_grants (
  credential_id   integer not null references api_credentials (id) on delete cascade,
  grantee_user_id text not null,
  granted_by      text not null,
  created_at      timestamptz not null default now(),
  primary key (credential_id, grantee_user_id)
);
create index if not exists api_credential_grants_grantee_idx on api_credential_grants (grantee_user_id);

create table if not exists strategies (
  id             serial primary key,
  user_id        text not null,
  title          text not null,
  domain         text not null default '',
  vision         text not null default '',
  horizon_start  date,
  horizon_end    date,
  delivery_rag   text not null default 'unrated' check (delivery_rag in ('green', 'amber', 'red', 'unrated')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists strategies_user_id_idx on strategies (user_id);

create table if not exists assumptions (
  id                 serial primary key,
  strategy_id        integer not null references strategies (id) on delete cascade,
  user_id            text not null,
  claim              text not null,
  origin             text not null default 'implicit' check (origin in ('stated', 'implicit')),
  status             text not null default 'untested' check (status in ('holding', 'weakening', 'broken', 'untested')),
  implied_intensity  text not null default 'amend' check (implied_intensity in ('watch', 'amend', 'refresh', 'reset')),
  owner_label        text not null default '',
  last_evidence_at   timestamptz,
  status_changed_at  timestamptz not null default now(),
  sort_order         integer not null default 0
);
create index if not exists assumptions_strategy_idx on assumptions (strategy_id, user_id);

create table if not exists signals (
  id                    serial primary key,
  strategy_id           integer not null references strategies (id) on delete cascade,
  user_id               text not null,
  name                  text not null,
  category              integer not null check (category between 1 and 10),
  secondary_category    integer check (secondary_category is null or (secondary_category between 1 and 10)),
  layer                 text not null default 'rotating' check (layer in ('sentinel', 'rotating', 'interrupt')),
  materiality           integer not null default 3 check (materiality between 1 and 5),
  velocity              integer not null default 3 check (velocity between 1 and 5),
  confidence            integer not null default 3 check (confidence between 1 and 5),
  cadence               text not null default 'monthly',
  baseline              text not null default '',
  current_value         text not null default '',
  unit                  text not null default '',
  threshold_watch       text not null default '',
  threshold_amend       text not null default '',
  threshold_refresh     text not null default '',
  threshold_reset       text not null default '',
  false_positive_guard  text not null default '',
  owner_label           text not null default '',
  status                text not null default 'active' check (status in ('active', 'parked', 'retired')),
  last_evidence_at      timestamptz,
  created_at            timestamptz not null default now()
);
create index if not exists signals_strategy_idx on signals (strategy_id, user_id);

create table if not exists assumption_signals (
  assumption_id integer not null references assumptions (id) on delete cascade,
  signal_id     integer not null references signals (id) on delete cascade,
  primary key (assumption_id, signal_id)
);

create table if not exists evidence (
  id             serial primary key,
  strategy_id    integer not null references strategies (id) on delete cascade,
  user_id        text not null,
  signal_id      integer references signals (id) on delete set null,
  assumption_id  integer references assumptions (id) on delete set null,
  note           text not null,
  source_url     text not null default '',
  direction      text not null default 'supporting' check (direction in ('supporting', 'weakening')),
  created_at     timestamptz not null default now()
);
create index if not exists evidence_strategy_idx on evidence (strategy_id, user_id);

create table if not exists interrupts (
  id           serial primary key,
  strategy_id  integer not null references strategies (id) on delete cascade,
  user_id      text not null,
  name         text not null,
  red_line     text not null,
  fired_at     timestamptz,
  review_by    timestamptz,
  status       text not null default 'armed' check (status in ('armed', 'open', 'closed')),
  created_at   timestamptz not null default now()
);
create index if not exists interrupts_strategy_idx on interrupts (strategy_id, user_id);

create table if not exists decisions (
  id             serial primary key,
  strategy_id    integer not null references strategies (id) on delete cascade,
  user_id        text not null,
  intensity      text not null check (intensity in ('watch', 'amend', 'refresh', 'reset', 'no-change')),
  summary        text not null,
  rationale      text not null,
  signal_id      integer,
  assumption_id  integer,
  decided_at     timestamptz not null default now()
);
create index if not exists decisions_strategy_idx on decisions (strategy_id, user_id, decided_at desc);

create table if not exists cliffs (
  id           serial primary key,
  strategy_id  integer not null references strategies (id) on delete cascade,
  user_id      text not null,
  name         text not null,
  cliff_date   date not null,
  kind         text not null default 'review' check (kind in ('fiscal', 'legal', 'scenario', 'review'))
);
create index if not exists cliffs_strategy_idx on cliffs (strategy_id, user_id);
