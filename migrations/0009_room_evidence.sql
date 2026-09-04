-- The rooms read the document and the world, without either colouring a verdict.
--
-- jurisdiction: which country or organisation the strategy belongs to. A room
-- cannot ask the web "has the money moved here" without it, and nothing in the
-- schema held it before. Extracted from the document, editable in Settings.
alter table strategies add column if not exists jurisdiction text not null default '';

-- What the uploaded document says in each room: verbatim sentences with the page
-- they came from. Written by lexical search, no model, so every row is quotable
-- and locatable. Replaced wholesale each time the document is read.
create table if not exists room_passages (
  id           serial primary key,
  strategy_id  integer not null references strategies (id) on delete cascade,
  document_id  integer not null references strategy_documents (id) on delete cascade,
  category     integer not null check (category between 1 and 10),
  rank         integer not null default 0,
  locator      text not null default '',
  quote        text not null,
  terms_hit    integer not null default 0,
  read_at      timestamptz not null default now()
);
create index if not exists room_passages_strategy_idx on room_passages (strategy_id, category, rank);

-- When each room was last read, including the rooms where the document said
-- nothing. Without this a room cannot tell "not read yet" from "silent".
create table if not exists room_reads (
  strategy_id  integer not null references strategies (id) on delete cascade,
  category     integer not null check (category between 1 and 10),
  read_at      timestamptz not null default now(),
  passages     integer not null default 0,
  -- false when the room's terms matched nothing anywhere in the document, which
  -- is a failed search, not a silent document.
  terms_matched boolean not null default true,
  primary key (strategy_id, category)
);

-- What the world says in a room: one row per candidate returned by a search the
-- person asked for. Append-only; a dismissed candidate is kept, because the
-- record of what was proposed and declined is part of the audit trail.
create table if not exists room_findings (
  id             serial primary key,
  strategy_id    integer not null references strategies (id) on delete cascade,
  user_id        text not null,
  category       integer not null check (category between 1 and 10),
  title          text not null default '',
  url            text not null default '',
  published_date text not null default '',
  quote          text not null default '',
  why            text not null default '',
  query          text not null default '',
  searched_at    timestamptz not null default now(),
  status         text not null default 'proposed' check (status in ('proposed', 'kept', 'dismissed')),
  decided_by     text,
  decided_at     timestamptz,
  rationale      text not null default ''
);
create index if not exists room_findings_strategy_idx on room_findings (strategy_id, category, searched_at desc);
