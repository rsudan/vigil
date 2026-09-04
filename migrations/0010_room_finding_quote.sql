-- The quotation a candidate carries is checked against the text the search
-- returned, the way an amendment's excerpt is checked against the stored
-- document. true = found; false = not found; null = nothing to check.
alter table room_findings add column if not exists quote_verified boolean;
