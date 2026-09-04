-- Record how much of the source text the extraction actually read.
alter table strategies add column if not exists extraction_note text not null default '';
