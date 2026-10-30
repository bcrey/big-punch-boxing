// Publishing workflow shared by the owner's publish endpoint, the emailed review page and the admin panel.
const email = require('./email');
const { reviewToken } = require('./auth');

async function loadFighter(pool, id) {
  const result = await pool.query(
    'SELECT id, name, image_data, crop, body_style, owner_email, visibility, submitted_at, reviewed_at FROM fighters WHERE id = $1 AND deleted_at IS NULL',
    [id]);
  return result.rows[0] || null;
}

// Marks the fighter pending and tells the admin. Mail failures are logged, never fatal: the admin panel still lists it.
async function submitForReview(pool, fighter) {
  await pool.query("UPDATE fighters SET visibility = 'pending', submitted_at = NOW(), reviewed_at = NULL, updated_at = NOW() WHERE id = $1", [fighter.id]);
  if (!email.configured() || !fighter.owner_email) return;
  try {
    await email.reviewRequest({ fighter, ownerEmail: fighter.owner_email, token: reviewToken(fighter.id) });
  } catch (error) {
    console.error('review request email failed:', error.message);
  }
}

async function decide(pool, fighter, approved) {
  await pool.query("UPDATE fighters SET visibility = $2, reviewed_at = NOW(), updated_at = NOW() WHERE id = $1",
    [fighter.id, approved ? 'public' : 'rejected']);
  if (!email.configured() || !fighter.owner_email) return;
  try {
    await email.reviewResult({ fighter, ownerEmail: fighter.owner_email, approved });
  } catch (error) {
    console.error('review result email failed:', error.message);
  }
}

module.exports = { loadFighter, submitForReview, decide };
