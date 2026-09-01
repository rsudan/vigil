-- Wider BYOK set, selected model, stored document chunks, extract preference.

alter table api_credentials drop constraint if exists api_credentials_provider_check;
alter table api_credentials add constraint api_credentials_provider_check
  check (provider in ('xai', 'openai', 'anthropic', 'openrouter', 'gemini', 'perplexity', 'exa', 'jina'));

alter table api_credentials add column if not exists selected_model text;

create table if not exists user_preferences (
  user_id           text primary key,
  extract_provider  text not null default 'xai',
  extract_model     text not null default 'grok-4-fast',
  updated_at        timestamptz not null default now()
);

create table if not exists strategy_documents (
  id          serial primary key,
  strategy_id integer not null references strategies (id) on delete cascade,
  user_id     text not null,
  filename    text not null,
  kind        text not null default 'text',
  char_count  integer not null default 0,
  page_count  integer,
  created_at  timestamptz not null default now()
);
create index if not exists strategy_documents_strategy_idx on strategy_documents (strategy_id, user_id);

create table if not exists document_chunks (
  id          serial primary key,
  document_id integer not null references strategy_documents (id) on delete cascade,
  chunk_index integer not null,
  heading     text not null default '',
  body        text not null
);
create index if not exists document_chunks_doc_idx on document_chunks (document_id, chunk_index);
