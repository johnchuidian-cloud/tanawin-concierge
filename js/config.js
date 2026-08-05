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
