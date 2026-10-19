import { sql, ensureSchema, sendError } from '../lib/db.js';

// GET    /api/deck?id=1            → 차수 + 단어 목록
// PATCH  /api/deck?id=1 {name}     → 차수 이름 바꾸기
// DELETE /api/deck?id=1            → 사진으로 만든 차수 삭제
export default async function handler(req, res) {
  const id = Number.parseInt(req.query.id, 10);
  if (!Number.isInteger(id) || id < 1) return sendError(res, 400, '차수 번호가 올바르지 않아요.');
  try {
    await ensureSchema();
    const [deck] = await sql`select id, name, source, source_file, created_at from decks where id = ${id}`;
    if (!deck) return sendError(res, 404, '해당 차수를 찾을 수 없어요.');

    if (req.method === 'GET') {
      const words = await sql`select position, no_label, word, reading, meaning, example, example_ko, section
        from words where deck_id = ${id} order by position`;
      return res.status(200).json({ deck, words });
    }
    if (req.method === 'PATCH') {
      const name = String(req.body?.name ?? '').trim().slice(0, 40);
      if (!name) return sendError(res, 400, '차수 이름을 입력해 주세요.');
      const [updated] = await sql`update decks set name = ${name} where id = ${id} returning id, name`;
      return res.status(200).json({ deck: updated });
    }
    if (req.method === 'DELETE') {
      if (deck.source !== 'photo') return sendError(res, 403, '기본 차수는 삭제할 수 없어요.');
      await sql`delete from decks where id = ${id}`;
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'GET, PATCH, DELETE');
    return sendError(res, 405, '지원하지 않는 요청이에요.');
  } catch (e) {
    console.error(e);
    return sendError(res, 500, 'DB 처리 중 오류가 났어요. 잠시 후 다시 시도해 주세요.');
  }
}
