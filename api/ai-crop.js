const Anthropic = require('@anthropic-ai/sdk');

const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_CHARS = 4 * 1024 * 1024;

const OUTLINE_SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    outline: {
      type: 'array',
      items: {
        type: 'object',
        properties: { x: { type: 'number' }, y: { type: 'number' } },
        required: ['x', 'y'],
        additionalProperties: false
      }
    }
  },
  required: ['found', 'outline'],
  additionalProperties: false
};

const prompt = (width, height) => `This photo becomes a paper cut-out head for a boxing game, so the outline must contain the person's entire head and nothing below the chin.

Trace the outline of the main person's whole head:
- Include the very top of the skull. A bald or shaved scalp is part of the head; so is all hair. Never cut through either.
- Include both ears, and glasses or headwear that sit on the head.
- Follow the jaw down around the chin. Exclude the neck, shoulders, clothing and background.
- Hug the edge closely. Where you are unsure, sit just outside the head rather than inside it.

The image is ${width} x ${height} pixels, with x running right and y running down from the top-left corner. Return 24 to 40 points in pixel coordinates, going clockwise and starting at the top of the head. If there are several people, outline the largest face. If there is no head, set found to false and return an empty outline.`;

let client;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }
  const { image, mediaType, width, height } = req.body || {};
  if (typeof image !== 'string' || !image || image.length > MAX_IMAGE_CHARS || !MEDIA_TYPES.includes(mediaType) ||
      !(width > 0) || !(height > 0)) {
    return res.status(400).json({ error: 'Send a JPEG, PNG or WebP image (base64) with its width and height.' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'AI cropping is not set up on the server yet (ANTHROPIC_API_KEY is missing).' });
  }

  try {
    client ||= new Anthropic();
    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      output_config: { effort: 'high', format: { type: 'json_schema', schema: OUTLINE_SCHEMA } },
      // A safety-classifier decline is retried on a fallback model in the same call.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: prompt(width, height) }
        ]
      }]
    });
    if (response.stop_reason === 'refusal') return res.status(422).json({ error: 'The AI declined to outline this photo.' });
    if (response.stop_reason === 'max_tokens') return res.status(502).json({ error: 'The AI response was cut off. Try again.' });
    const text = response.content.find(block => block.type === 'text')?.text;
    const result = JSON.parse(text || '{}');
    // Return fractions of the image so the browser can map them onto the full-size photo.
    const outline = result.found ? result.outline
      .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
      .map(p => ({ x: Math.min(1, Math.max(0, p.x / width)), y: Math.min(1, Math.max(0, p.y / height)) })) : [];
    res.status(200).json({ outline });
  } catch (err) {
    console.error('ai-crop error:', err);
    if (err instanceof Anthropic.AuthenticationError) return res.status(503).json({ error: 'AI cropping is not set up correctly on the server.' });
    if (err instanceof Anthropic.RateLimitError) return res.status(429).json({ error: 'AI cropping is busy. Try again in a moment.' });
    res.status(502).json({ error: 'AI cropping failed. Try again, or outline the head by hand.' });
  }
};
