create extension if not exists vector;

create table documents (
  id uuid primary key default gen_random_uuid(),
  collection text not null,
  filename text not null,
  kind text not null check (kind in ('pdf', 'md', 'txt')),
  sha256 text not null,
  ingest_version int not null,
  created_at timestamptz not null default now(),
  unique (collection, filename)
);

create table chunks (
  id bigint generated always as identity primary key,
  document_id uuid not null references documents (id) on delete cascade,
  ord int not null,
  locator text not null,
  content text not null,
  embedding vector(1024) not null,
  tsv tsvector generated always as (to_tsvector('english', content)) stored,
  unique (document_id, ord)
);
create index on chunks using hnsw (embedding vector_cosine_ops);
create index on chunks using gin (tsv);

create table usage_windows (
  bucket text not null,
  window_start timestamptz not null,
  count bigint not null default 0,
  primary key (bucket, window_start)
);
