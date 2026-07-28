-- social-suite: unified D1 schema
--
-- Merges two earlier prototypes' tables, replaces
-- the single-keyword design with unlimited comment codes, and adds the punch
-- list: carousels, a recurring posting schedule, drafts, Instagram Insights,
-- owned click tracking, timed follow-ups, contact tagging, backups, and health
-- heartbeats.
--
-- IMPORTANT: no access token appears in this file, ever. Tokens are stored
-- encrypted in the accounts table and written there by an authenticated
-- dashboard call, never by SQL. If you ever find yourself pasting an IGAA...
-- string into this file, stop: that is the exact bug this build exists to fix.
--
-- Safe to re-run. Run with: npm run db:migrate

-- ===========================================================================
-- accounts
-- ===========================================================================
CREATE TABLE IF NOT EXISTS accounts (
  id                     TEXT PRIMARY KEY,      -- your own short handle, e.g. 'account_one'
  label                  TEXT NOT NULL,
  ig_user_id             TEXT NOT NULL UNIQUE,  -- Instagram professional account id from Meta
  -- Long-lived access token, AES-GCM encrypted with the TOKEN_ENC_KEY secret.
  -- NULL until you paste a token into the dashboard. Never plaintext.
  token_ciphertext       TEXT,
  token_expires_at       TEXT,
  token_last_error       TEXT,
  status                 TEXT NOT NULL DEFAULT 'paused' CHECK (status IN ('active', 'paused')),
  -- Independent kill switch for the reply half, so you can keep posting while
  -- the DM side waits on Meta App Review.
  dm_enabled             INTEGER NOT NULL DEFAULT 0,
  -- Posting schedule slots are written in this timezone, and the calendar
  -- reads in it. IANA name, e.g. 'America/New_York'.
  timezone               TEXT NOT NULL DEFAULT 'America/New_York',
  -- When 1, anything pushed in by a skill or the API lands as a draft and will
  -- not publish until you approve it. Your safety catch on autonomous posting.
  require_approval       INTEGER NOT NULL DEFAULT 0,
  -- Hard ceiling on AI-written DM replies per day. Bounds the Anthropic bill
  -- if the account ever gets flooded. 0 means no AI replies at all.
  max_ai_replies_per_day INTEGER NOT NULL DEFAULT 200,
  created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===========================================================================
-- posts
-- ===========================================================================
CREATE TABLE IF NOT EXISTS posts (
  id                 TEXT PRIMARY KEY,
  account_id         TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  caption            TEXT,
  -- Single-media posts use media_key. Carousels use media_keys, a JSON array of
  -- 2 to 10 R2 keys in slide order, and leave media_key as the first slide so
  -- the calendar thumbnail still works.
  media_key          TEXT NOT NULL,
  media_keys         TEXT,
  media_type         TEXT NOT NULL DEFAULT 'IMAGE'
                     CHECK (media_type IN ('IMAGE', 'VIDEO', 'REELS', 'STORIES', 'CAROUSEL')),
  scheduled_time     TEXT NOT NULL,
  -- 'draft' waits for your approval and is never published by the cron.
  status             TEXT NOT NULL DEFAULT 'scheduled'
                     CHECK (status IN ('draft', 'scheduled', 'publishing', 'published', 'failed')),
  attempts           INTEGER NOT NULL DEFAULT 0,
  -- Set when a transient Meta error (rate limit, 5xx) sends a post back to the
  -- queue. The publisher skips the row until this time passes: backoff, so a
  -- blip does not burn all three attempts in 45 minutes.
  next_attempt_at    TEXT,
  -- Text posted as a public comment on our own post right after publishing,
  -- e.g. hashtags, or "comment MAP for the breakdown".
  first_comment      TEXT,
  container_id       TEXT,
  published_media_id TEXT,
  published_url      TEXT,
  -- Set the moment Instagram confirms the post is live. Insights refresh reads
  -- this, not created_at, so a draft held for approval for weeks before being
  -- published still gets its performance numbers pulled afterward.
  published_at       TEXT,
  error              TEXT,
  source             TEXT DEFAULT 'manual',    -- 'manual' | 'claude' | 'skill' | 'queue'
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_due ON posts (status, scheduled_time);
CREATE INDEX IF NOT EXISTS idx_posts_account_time ON posts (account_id, scheduled_time);

-- Reach, saves, follows and so on, pulled from Instagram Insights for published
-- posts. Refreshed daily for anything published in the last 30 days, because
-- these numbers keep moving for a while after a post goes out.
CREATE TABLE IF NOT EXISTS post_insights (
  post_id        TEXT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  account_id     TEXT NOT NULL,
  reach          INTEGER,
  impressions    INTEGER,
  likes          INTEGER,
  comments       INTEGER,
  saved          INTEGER,
  shares         INTEGER,
  profile_visits INTEGER,
  follows        INTEGER,
  total_interactions INTEGER,
  raw            TEXT NOT NULL DEFAULT '{}',
  fetched_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_insights_account ON post_insights (account_id, fetched_at DESC);

-- ===========================================================================
-- slots: the recurring posting schedule
--
-- "Tuesday 09:00, Thursday 09:00, Saturday 11:00" is three rows. Adding content
-- to the queue drops it into the next free slot, so you stop hand-picking times.
-- Times are wall-clock in the account's timezone and converted to UTC at
-- assignment, which means they stay correct across daylight saving.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS slots (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0 = Sunday
  hour        INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
  minute      INTEGER NOT NULL DEFAULT 0 CHECK (minute BETWEEN 0 AND 59),
  label       TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (account_id, weekday, hour, minute)
);

-- ===========================================================================
-- triggers: the comment codes
-- ===========================================================================
CREATE TABLE IF NOT EXISTS triggers (
  id                    TEXT PRIMARY KEY,
  account_id            TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  keyword               TEXT NOT NULL,
  label                 TEXT,
  reply_template        TEXT NOT NULL,          -- {{link}} is substituted
  link                  TEXT,                   -- the real destination URL
  -- Optional public reply posted in the comment thread itself, e.g.
  -- "sent, check your DMs". This is what ManyChat does alongside the private
  -- reply, and it is what feeds the post back into the algorithm.
  public_reply_text     TEXT,
  -- One timed follow-up. Sent this many hours after the code fires, and
  -- cancelled automatically if the person replies in the meantime.
  followup_text         TEXT,
  followup_delay_hours  INTEGER NOT NULL DEFAULT 20,
  followup_active       INTEGER NOT NULL DEFAULT 0,
  -- Everyone who uses this code gets tagged with this, so you can segment
  -- later without guessing where a contact came from.
  tag                   TEXT,
  match_mode            TEXT NOT NULL DEFAULT 'word' CHECK (match_mode IN ('word', 'contains')),
  priority              INTEGER NOT NULL DEFAULT 100,
  active                INTEGER NOT NULL DEFAULT 1,
  ig_media_id           TEXT,                   -- restrict to one post, optional
  hit_count             INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (account_id, keyword)
);

CREATE INDEX IF NOT EXISTS idx_triggers_lookup ON triggers (account_id, active, priority);

-- ===========================================================================
-- short_links and link_clicks: owned attribution
--
-- Codes send a short link through this Worker instead of the raw URL. The
-- Worker counts the click and redirects. That answers "which code actually
-- drives bookings" with data you own, needing no Meta permission at all.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS short_links (
  code        TEXT PRIMARY KEY,                 -- the /r/<code> path segment
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  target_url  TEXT NOT NULL,                    -- where it actually goes, UTMs already applied
  trigger_id  TEXT,                             -- which code owns it, if any
  label       TEXT,
  clicks      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_shortlinks_trigger ON short_links (trigger_id);

CREATE TABLE IF NOT EXISTS link_clicks (
  id           TEXT PRIMARY KEY,
  code         TEXT NOT NULL,
  account_id   TEXT NOT NULL,
  contact_id   TEXT,                            -- known when the link went out via a DM
  referer      TEXT,
  user_agent   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_clicks_code ON link_clicks (code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clicks_account ON link_clicks (account_id, created_at DESC);

-- ===========================================================================
-- contacts, conversations, messages
-- ===========================================================================
CREATE TABLE IF NOT EXISTS contacts (
  id                   TEXT PRIMARY KEY,
  account_id           TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ig_scoped_id         TEXT NOT NULL,
  username             TEXT,
  tags                 TEXT NOT NULL DEFAULT '[]',   -- JSON array, for segmentation
  note                 TEXT,
  first_seen_at        TEXT NOT NULL DEFAULT (datetime('now')),
  last_interaction_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (account_id, ig_scoped_id)
);

CREATE INDEX IF NOT EXISTS idx_contacts_recent ON contacts (account_id, last_interaction_at DESC);

CREATE TABLE IF NOT EXISTS conversations (
  id          TEXT PRIMARY KEY,
  contact_id  TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL CHECK (channel IN ('dm', 'comment')),
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'escalated', 'closed')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (contact_id, channel)
);

CREATE TABLE IF NOT EXISTS messages (
  id               TEXT PRIMARY KEY,
  conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction        TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  body             TEXT NOT NULL,
  source           TEXT CHECK (source IN ('keyword_trigger', 'ai_generated', 'human', 'system', 'followup')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_source_time ON messages (source, created_at);

-- ===========================================================================
-- scheduled_sends: the timed follow-up queue
--
-- One row per pending follow-up. The 15 minute cron sends anything due, and
-- cancels anything where the person has replied since, because chasing someone
-- who already answered is the fastest way to look like a bot.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS scheduled_sends (
  id               TEXT PRIMARY KEY,
  account_id       TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  recipient_id     TEXT NOT NULL,               -- Instagram scoped user id
  body             TEXT NOT NULL,
  send_after       TEXT NOT NULL,
  -- Set when the follow-up was queued. If the contact sends anything after
  -- this time, the follow-up is cancelled instead of sent.
  queued_at        TEXT NOT NULL DEFAULT (datetime('now')),
  trigger_id       TEXT,
  -- 'sending' is a claim, not a resting state: set atomically right before the
  -- actual send so two overlapping cron passes cannot both pick up and send
  -- the same follow-up, the same way posts are claimed before publishing.
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'sending', 'sent', 'cancelled', 'failed')),
  result           TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sends_due ON scheduled_sends (status, send_after);

-- ===========================================================================
-- resources and guardrails
-- ===========================================================================
CREATE TABLE IF NOT EXISTS resources (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  topic       TEXT NOT NULL,
  content     TEXT NOT NULL,
  links       TEXT NOT NULL DEFAULT '[]',
  keywords    TEXT NOT NULL DEFAULT '[]',
  active      INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_resources_account ON resources (account_id, active);

CREATE TABLE IF NOT EXISTS guardrails (
  account_id           TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  voice                TEXT NOT NULL DEFAULT 'Direct. Short declarative sentences. No em dashes or en dashes. Receipts over adjectives. Never hype.',
  banned_topics        TEXT NOT NULL DEFAULT '[]',
  must_include         TEXT NOT NULL DEFAULT '[]',
  escalate_conditions  TEXT NOT NULL DEFAULT '["complaint","refund request","angry or hostile tone","pricing negotiation","legal threat"]',
  reply_length_cap     INTEGER NOT NULL DEFAULT 300,
  fallback_line        TEXT NOT NULL DEFAULT 'Good question. Let me get you a real answer, someone will follow up shortly.',
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===========================================================================
-- events_log, idempotency, rate limiting, heartbeats
-- ===========================================================================
CREATE TABLE IF NOT EXISTS events_log (
  id           TEXT PRIMARY KEY,
  account_id   TEXT,
  -- The raw Instagram scoped user id an event is about, when there is one.
  -- Independent of contacts.id: a comment that never matched a code never
  -- creates a contacts row, but its text still names a real person, so Meta's
  -- data-deletion callback purges by this column directly rather than only
  -- cascading from a contacts row that might not exist.
  ig_scoped_id TEXT,
  event_type   TEXT NOT NULL,
  payload      TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_recent ON events_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_account ON events_log (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON events_log (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_scoped ON events_log (ig_scoped_id);

-- Meta retries webhook deliveries. Without this, one retried comment sends the
-- same DM two or three times. The PRIMARY KEY does the work.
CREATE TABLE IF NOT EXISTS processed_events (
  event_key   TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_processed_age ON processed_events (created_at);

CREATE TABLE IF NOT EXISTS sends (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL,
  kind        TEXT NOT NULL,                    -- 'private_reply' | 'dm' | 'followup' | 'public_reply'
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sends_window ON sends (account_id, created_at DESC);

-- Heartbeats. A Cloudflare cron that stops firing fails silently, so the app
-- records every pass here and shows a banner when a heartbeat goes stale. This
-- is how a dead scheduler becomes visible without an external alerting service.
CREATE TABLE IF NOT EXISTS system_state (
  key         TEXT PRIMARY KEY,                 -- 'last_publish_pass', 'last_daily_pass', ...
  value       TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Meta requires a data deletion request callback for these permissions. Every
-- request is recorded so the status URL can answer honestly.
CREATE TABLE IF NOT EXISTS deletion_requests (
  confirmation_code  TEXT PRIMARY KEY,
  ig_scoped_id       TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'completed',
  rows_deleted       INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===========================================================================
-- Seed. No tokens here, on purpose. Both accounts start paused with replies
-- off: you turn each on from the app once you have tested it. Fail safe.
--
-- EDIT THIS BLOCK before your first `npm run db:migrate`. There is no in-app
-- way to add an account -- this seed is how you tell the app which Instagram
-- account(s) it manages. `id` is your own short handle (used in API calls and
-- URLs); `ig_user_id` is the numeric id Meta assigns your professional
-- account. If you don't know it yet, leave the placeholder: the dashboard's
-- "paste your token" step (README, Part G1) will reject a mismatched token
-- and tell you the real id in the error message, and the top-level setup
-- guide shows the one-line command to fix it afterward. Only need one
-- account? Delete the second row (and its matching guardrails/triggers rows
-- below).
-- ===========================================================================
INSERT OR IGNORE INTO accounts (id, label, ig_user_id, status, dm_enabled) VALUES
  ('account_one', 'My Business',        'REPLACE_WITH_YOUR_IG_USER_ID_1', 'paused', 0),
  ('account_two', 'My Second Account',  'REPLACE_WITH_YOUR_IG_USER_ID_2', 'paused', 0);

INSERT OR IGNORE INTO guardrails (account_id) VALUES ('account_one'), ('account_two');

-- Example comment codes, on account_one. The link is deliberately a
-- placeholder: the Worker refuses to send any reply whose link still
-- contains 'REPLACE_ME', so a half-configured code fails loudly in the log
-- instead of DMing a dead URL. Edit the keyword, reply, and link to your own,
-- or delete these two rows and add your own codes from the app's Codes tab.
INSERT OR IGNORE INTO triggers (id, account_id, keyword, label, reply_template, link, priority, tag, public_reply_text) VALUES
  ('trg_map',   'account_one', 'MAP',   'Example booking link',
   'Here is the link for your area. {{link}}', 'https://REPLACE_ME.example.com/map', 10, 'map-lead', 'Sent, check your DMs.'),
  ('trg_audit', 'account_one', 'AUDIT', 'Example free-offer link',
   'Sending that over now. {{link}}', 'https://REPLACE_ME.example.com/audit', 20, 'audit-lead', 'Sent, check your DMs.');
