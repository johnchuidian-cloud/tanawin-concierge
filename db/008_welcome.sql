-- Welcome card (John, 2026-09-01): a greeting at the very top of the guest
-- view, above the reorderable cards.
--
-- Stored as content rather than hardcoded in the page, like every other
-- guest-visible string: Lexi can reword it from /staff without a deploy, and
-- blanking it hides the card. The guest page pins it above the layout order
-- and gives it no rail button — a greeting is first by definition, and it
-- isn't a destination anyone navigates back to.
insert into public.concierge_content (key, value, last_reviewed) values
  ('welcome', '{"message": "Welcome to Tanawin! We''re glad you''re here!"}', null)
on conflict (key) do nothing;
