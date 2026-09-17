// Tanawin Concierge — public client config.
// Concierge shares the MENU Supabase project so room access codes validate
// against the same `rooms` table (suite connection #6). The anon key is safe
// to ship: guests can only call concierge_bootstrap (which requires a valid
// room code) — there are no anon table policies on Concierge's tables.

const SUPABASE_URL = 'https://lkeuiquqogtevsgvaddf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxrZXVpcXVxb2d0ZXZzZ3ZhZGRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzNDIxNDUsImV4cCI6MjA5ODkxODE0NX0.nw_5E2F2OsQhT3DlRcigO8Vm9uYkgM80UqB7dMx5X8w';

// Public asset base for the swappable Sinagtala map + future content photos.
const ASSETS_BASE = `${SUPABASE_URL}/storage/v1/object/public/concierge-assets`;

// Where "Order food" hands off to (suite: Menu stays the ordering app).
// The room code is passed along so the guest never retypes it.
const MENU_URL = 'https://tanawin-menu.tanawinbnb.workers.dev';

const HUB_URL = 'https://tanawin-hub.tanawinbnb.workers.dev';

// Every reorderable section of the guest page, in the default order. The
// guest page and the editor's "Section order" block BOTH read this one list.
// They used to keep separate copies, and the editor's lacked 'requests' and
// 'feedback': when Lexi saved her order on 2026-09-01 those two cards were
// left out, so guests got them appended at the very bottom. Add a new section
// here and nowhere else.
const SECTION_ORDER = ['wifi', 'house_rules', 'requests', 'pool_hours',
  'getting_around', 'key_info', 'menu_card', 'contact', 'feedback'];
