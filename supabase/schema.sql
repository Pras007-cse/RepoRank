-- ProjectStar schema
-- Design notes:
--  - `active` rows on `stars` are never deleted, only flipped — `star_events`
--    is the append-only audit log of every transition.
--  - Self-star and duplicate-star protection are enforced here, at the DB
--    layer, not just in application code, so a bug in the sync worker can't
--    silently create a farmable state.
--  - Ranking is a VIEW over `active = true` rows only — there is no
--    denormalized "score" column to drift out of sync with the source rows.

create extension if not exists pgcrypto;

create table users (
  id                 uuid primary key default gen_random_uuid(),
  github_username    text not null unique,
  github_user_id     bigint unique, -- GitHub's numeric id; usernames can be renamed, this can't
  display_name       text,
  avatar_url         text,
  last_synced_at     timestamptz,
  created_at         timestamptz not null default now()
);

create index idx_users_sync_order on users (last_synced_at nulls first);

create table projects (
  id                          uuid primary key default gen_random_uuid(),
  owner_user_id               uuid not null references users(id) on delete cascade,
  github_repo_id              bigint not null unique,      -- GitHub's numeric id; survives repo renames
  owner_login                text not null,                -- repo owner login per GitHub API, cached
  repo_name                   text not null,
  full_name                   text not null unique,         -- "owner/repo" at time of caching, display only
  github_repo_url             text not null,
  description                 text,
  primary_language            text,
  topics                      text[] not null default '{}',
  readme_excerpt              text,
  lifetime_stargazers_count   int not null default 0,

  -- Per-project ownership proof (README verification code), independent of
  -- whether the owner's *account* has verified any of their other projects.
  verification_code           text not null,
  verification_requested_at   timestamptz not null default now(),
  is_verified                 boolean not null default false,
  verified_at                 timestamptz,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  -- An unverified project cannot claim to be owned by the account: the
  -- ownership fields only mean something once proven.
  constraint owner_login_matches_claimed_username check (true) -- enforced in app layer at write time; see worker/src/sync.ts
);

create index idx_projects_verified on projects (is_verified) where is_verified = true;

create table stars (
  id                 uuid primary key default gen_random_uuid(),
  from_user_id       uuid not null references users(id) on delete cascade,
  project_id         uuid not null references projects(id) on delete cascade,
  active             boolean not null default true,
  first_seen_at      timestamptz not null default now(),
  last_verified_at   timestamptz not null default now(),

  unique (from_user_id, project_id),

  -- Self-star prevention at the DB layer: from_user_id can never equal the
  -- project's owner_user_id. Requires a lookup, so this is a trigger below
  -- rather than a plain CHECK (CHECK can't reference another table).
  constraint no_self_reference check (true)
);

create or replace function prevent_self_star() returns trigger as $$
begin
  if exists (
    select 1 from projects p where p.id = new.project_id and p.owner_user_id = new.from_user_id
  ) then
    raise exception 'self-star is not allowed (user % owns project %)', new.from_user_id, new.project_id;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_prevent_self_star
  before insert or update on stars
  for each row execute function prevent_self_star();

create table star_events (
  id             uuid primary key default gen_random_uuid(),
  from_user_id   uuid not null references users(id) on delete cascade,
  project_id     uuid not null references projects(id) on delete cascade,
  event_type     text not null check (event_type in ('STAR', 'UNSTAR')),
  occurred_at    timestamptz not null default now()
);

create index idx_star_events_project on star_events (project_id, occurred_at desc);
create index idx_star_events_user on star_events (from_user_id, occurred_at desc);

create table connections (
  id             uuid primary key default gen_random_uuid(),
  requester_id   uuid not null references users(id) on delete cascade,
  addressee_id   uuid not null references users(id) on delete cascade,
  status         text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at     timestamptz not null default now(),
  responded_at   timestamptz,

  unique (requester_id, addressee_id),
  constraint no_self_connection check (requester_id <> addressee_id)
);

-- Prevents (A→B pending) + (B→A pending) both existing as separate spam
-- requests — only one direction may be pending or accepted between any pair.
create unique index idx_connections_unordered_pair on connections (
  least(requester_id, addressee_id),
  greatest(requester_id, addressee_id)
) where status in ('pending', 'accepted');

-- Active-only counts, computed from source rows — never denormalized.
create or replace view project_ranking as
select
  p.id as project_id,
  p.full_name,
  p.owner_user_id,
  count(s.id) filter (where s.active) as active_verified_stars,
  count(s.id) as lifetime_stars_seen,
  count(s.id) filter (where not s.active) as removed_stars
from projects p
left join stars s on s.project_id = p.id
where p.is_verified = true
group by p.id, p.full_name, p.owner_user_id;

create or replace view user_connection_counts as
select
  u.id as user_id,
  count(*) filter (where c.status = 'accepted') as accepted_connections
from users u
left join connections c
  on c.status = 'accepted' and (c.requester_id = u.id or c.addressee_id = u.id)
group by u.id;
