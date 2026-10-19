import { neon } from '@neondatabase/serverless';

export const sql = neon(process.env.DATABASE_URL);

export async function ensureSchema() {
  await sql`create table if not exists decks (
    id serial primary key,
    name text not null,
    source text not null default 'photo',
    source_file text,
    created_at timestamptz not null default now()
  )`;
  await sql`create table if not exists words (
    id serial primary key,
    deck_id integer not null references decks(id) on delete cascade,
    position integer not null,
    no_label text not null default '',
    word text not null,
    reading text not null default '',
    meaning text not null,
    example text not null default '',
    example_ko text not null default '',
    section text not null default ''
  )`;
  await sql`create index if not exists words_deck_idx on words(deck_id, position)`;
}

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// Validates and normalizes word rows coming from the client or the seed files.
export function normalizeWords(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map(w => ({
      no: clean(w.no, 10),
      word: clean(w.word, 40),
      reading: clean(w.reading, 60),
      meaning: clean(w.meaning, 120),
      example: clean(w.example, 200),
      example_ko: clean(w.example_ko, 200),
      section: clean(w.section, 60),
    }))
    .filter(w => w.word && w.meaning)
    .slice(0, 300);
}

export async function insertDeck({ name, source, sourceFile = null, words }) {
  const [deck] = await sql`insert into decks (name, source, source_file)
    values (${name}, ${source}, ${sourceFile}) returning id, name, source, source_file, created_at`;
  if (words.length) {
    const col = k => words.map(w => w[k]);
    await sql`insert into words (deck_id, position, no_label, word, reading, meaning, example, example_ko, section)
      select ${deck.id}, * from unnest(
        ${words.map((_, i) => i + 1)}::int[], ${col('no')}::text[], ${col('word')}::text[], ${col('reading')}::text[],
        ${col('meaning')}::text[], ${col('example')}::text[], ${col('example_ko')}::text[], ${col('section')}::text[])`;
  }
  return { ...deck, word_count: words.length };
}

export function sendError(res, status, message) {
  res.status(status).json({ error: message });
}
