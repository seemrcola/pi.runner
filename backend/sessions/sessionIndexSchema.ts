import type { DatabaseSync } from 'node:sqlite'

export function ensureSessionIndexSchema(db: DatabaseSync): void {
  db.exec(`
    create table if not exists sessions (
      id text not null,
      source_path text primary key,
      source_mtime real not null,
      source_size integer not null,
      title text not null,
      workspace_path text,
      kind text not null,
      created_at real not null,
      updated_at real not null,
      messages_json text not null,
      last_indexed_at real not null,
      parser_version integer not null default 1,
      is_placeholder integer not null default 0
    );
    create index if not exists sessions_updated_at_idx on sessions(updated_at desc);
    create table if not exists session_view_overrides (
      session_path text primary key,
      view_kind text not null,
      workspace_path text,
      updated_at real not null
    );
    create table if not exists hidden_sessions (
      session_path text primary key,
      hidden_at real not null
    );
    create table if not exists hidden_workspaces (
      workspace_path text primary key,
      hidden_at real not null
    );
    create table if not exists workspace_view_states (
      workspace_path text primary key,
      is_pinned integer not null default 0,
      is_collapsed integer not null default 0,
      pinned_at real,
      updated_at real not null
    );
    create table if not exists message_image_attachments (
      session_path text not null,
      message_id text not null,
      position integer not null,
      prompt_text text,
      mime_type text not null,
      file_path text not null,
      sha256 text not null,
      created_at real not null,
      primary key (session_path, message_id, position)
    );
    create index if not exists message_image_attachments_session_idx
      on message_image_attachments(session_path, message_id);
  `)

  ensureColumn(db, 'sessions', 'is_placeholder', 'integer not null default 0')
  ensureColumn(db, 'sessions', 'parser_version', 'integer not null default 1')
  ensureColumn(db, 'message_image_attachments', 'prompt_text', 'text')
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const rows = db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>
  if (rows.some((row) => row.name === column)) return
  db.exec(`alter table ${table} add column ${column} ${definition}`)
}
