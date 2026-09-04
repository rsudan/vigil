-- Red lines get a room. Null means "not named": it reads as room 8 (Risks),
-- the method's home for red lines agreed in advance, until someone sets it.
-- Cliffs take their room from their kind (fiscal → Resources, legal → Mandate,
-- review → Assumptions, scenario → Risks) and need no column.
alter table interrupts add column if not exists category integer
  check (category is null or (category between 1 and 10));
