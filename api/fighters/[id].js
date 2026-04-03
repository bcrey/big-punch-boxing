const { getPool } = require('../../lib/db');

module.exports = async function handler(req, res) {
  const { id } = req.query;

  if (req.method === 'PUT') {
    try {
      const { name, imageData, crop } = req.body;
      await getPool().query(
        `UPDATE fighters SET name = $1, image_data = $2, crop = $3, updated_at = NOW() WHERE id = $4`,
        [name || 'New Fighter', imageData || null, crop ? JSON.stringify(crop) : null, id]
      );
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error('PUT error:', err);
      res.status(500).json({ error: 'Failed to update fighter' });
    }
  } else if (req.method === 'DELETE') {
    try {
      await getPool().query('DELETE FROM fighters WHERE id = $1', [id]);
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error('DELETE error:', err);
      res.status(500).json({ error: 'Failed to delete fighter' });
    }
  } else {
    res.setHeader('Allow', 'PUT, DELETE');
    res.status(405).end();
  }
};
