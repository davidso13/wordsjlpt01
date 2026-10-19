import Anthropic from '@anthropic-ai/sdk';
import { normalizeWords, sendError } from '../lib/db.js';

// POST /api/recognize {image: base64, mediaType} → 사진 속 단어 목록 (아직 저장하지 않음)
const SCHEMA = {
  type: 'object',
  properties: {
    words: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          no: { type: 'string', description: '사진에 단어 번호가 있으면 그 번호, 없으면 빈 문자열' },
          word: { type: 'string', description: '사진에 적힌 그대로의 일본어 표기 (한자/가나)' },
          reading: { type: 'string', description: '히라가나 읽기' },
          meaning: { type: 'string', description: '한국어 뜻' },
          example: { type: 'string', description: '단어를 그대로 포함한 짧은 일본어 예문' },
          example_ko: { type: 'string', description: '예문의 한국어 해석' },
        },
        required: ['no', 'word', 'reading', 'meaning', 'example', 'example_ko'],
        additionalProperties: false,
      },
    },
  },
  required: ['words'],
  additionalProperties: false,
};

const PROMPT = `이 사진은 일본어 단어장, 교재, 필기 노트 중 하나입니다. 사진에 있는 일본어 어휘 항목을 모두 순서대로 뽑아 주세요.

각 항목마다:
- word: 사진에 적힌 표기 그대로 (한자가 있으면 한자로)
- reading: 히라가나 읽기. 사진에 후리가나가 있으면 그것을 쓰고, 없으면 표준 읽기를 쓰세요. 가타카나 단어도 히라가나로 적습니다.
- meaning: 한국어 뜻. 사진에 한국어 뜻이 적혀 있으면 그대로 옮기고, 없으면 JLPT 단어장 스타일의 짧은 한국어 뜻을 쓰세요.
- example: word를 표기 그대로 포함하는 JLPT N4 수준의 짧고 자연스러운 일본어 예문 하나
- example_ko: 예문의 자연스러운 한국어 해석
- no: 사진에 항목 번호가 있으면 그 숫자, 없으면 빈 문자열

예문, 문법 설명, 제목처럼 어휘 항목이 아닌 글은 빼세요. 일본어 어휘가 하나도 없으면 words를 빈 배열로 돌려주세요.`;

const client = new Anthropic();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendError(res, 405, '지원하지 않는 요청이에요.');
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return sendError(res, 503, '사진 인식 기능이 아직 설정되지 않았어요. 관리자가 ANTHROPIC_API_KEY를 등록해야 해요.');
  }
  const image = String(req.body?.image ?? '');
  const mediaType = String(req.body?.mediaType ?? 'image/jpeg');
  if (!image || !['image/jpeg', 'image/png', 'image/webp'].includes(mediaType)) {
    return sendError(res, 400, 'JPG, PNG, WEBP 사진만 올릴 수 있어요.');
  }
  if (image.length > 4_000_000) return sendError(res, 413, '사진이 너무 커요. 더 작은 사진으로 다시 시도해 주세요.');

  try {
    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: PROMPT },
        ],
      }],
    });
    if (response.stop_reason === 'refusal') return sendError(res, 422, '이 사진은 인식할 수 없었어요. 다른 사진으로 시도해 주세요.');
    if (response.stop_reason === 'max_tokens') return sendError(res, 422, '단어가 너무 많아요. 사진을 나눠서 찍어 주세요.');
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const words = normalizeWords(JSON.parse(text).words);
    return res.status(200).json({ words });
  } catch (e) {
    console.error(e);
    if (e instanceof Anthropic.RateLimitError) return sendError(res, 429, '요청이 많아요. 잠시 후 다시 시도해 주세요.');
    if (e instanceof Anthropic.AuthenticationError) return sendError(res, 503, '사진 인식 API 키가 올바르지 않아요.');
    if (e instanceof Anthropic.BadRequestError) return sendError(res, 400, '사진을 처리하지 못했어요. 다른 사진으로 시도해 주세요.');
    if (e instanceof Anthropic.APIError) return sendError(res, 502, '사진 인식 서버에 문제가 있어요. 잠시 후 다시 시도해 주세요.');
    if (e instanceof SyntaxError) return sendError(res, 502, '인식 결과를 읽지 못했어요. 다시 시도해 주세요.');
    return sendError(res, 500, '사진 인식 중 오류가 났어요.');
  }
}
