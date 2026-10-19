import { sql, ensureSchema, normalizeWords, insertDeck, sendError } from '../lib/db.js';

// GET  /api/decks          → 차수 목록
// POST /api/decks {name, words[]} → 새 차수 저장
export default async function handler(req, res) {
  try {
    await ensureSchema();
    if (req.method === 'GET') {
      const decks = await sql`select d.id, d.name, d.source, d.source_file, d.created_at, count(w.id)::int as word_count
        from decks d left join words w on w.deck_id = d.id
        group by d.id order by d.created_at, d.id`;
      return res.status(200).json({ decks });
    }
    if (req.method === 'POST') {
      const name = String(req.body?.name ?? '').trim().slice(0, 40);
      const words = normalizeWords(req.body?.words);
      if (!name) return sendError(res, 400, '차수 이름을 입력해 주세요.');
      if (!words.length) return sendError(res, 400, '저장할 단어가 없어요. 단어와 뜻이 모두 있는 줄이 하나 이상 필요해요.');
      const deck = await insertDeck({ name, source: 'photo', words });
      return res.status(201).json({ deck });
    }
    res.setHeader('Allow', 'GET, POST');
    return sendError(res, 405, '지원하지 않는 요청이에요.');
  } catch (e) {
    console.error(e);
    return sendError(res, 500, 'DB 처리 중 오류가 났어요. 잠시 후 다시 시도해 주세요.');
  }
}
