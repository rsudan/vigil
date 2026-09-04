-- Living-document mechanics: sharing, threshold crossings, decision keys,
-- verified excerpts, document language, and a reading history on evidence.

create table if not exists strategy_members (
  strategy_id  integer not null references strategies (id) on delete cascade,
  user_id      text not null,
  role         text not null default 'editor' check (role in ('editor', 'viewer')),
  added_by     text not null,
  created_at   timestamptz not null default now(),
  primary key (strategy_id, user_id)
);
create index if not exists strategy_members_user_idx on strategy_members (user_id);

alter table strategies add column if not exists language text not null default '';

alter table signals add column if not exists crossed_level text not null default 'none';
alter table signals drop constraint if exists signals_crossed_level_check;
alter table signals add constraint signals_crossed_level_check
  check (crossed_level in ('none', 'watch', 'amend', 'refresh', 'reset'));
alter table signals add column if not exists updated_at timestamptz not null default now();

alter table evidence add column if not exists reading text not null default '';

alter table decisions add column if not exists item_key text not null default '';
create index if not exists decisions_item_idx on decisions (strategy_id, item_key, decided_at desc);

alter table amendments add column if not exists excerpt_verified boolean;
