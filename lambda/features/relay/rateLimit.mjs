import { db, DEVICES_TABLE } from '../../lib/dynamo.mjs';

export async function checkRateLimit(clientId) {
  const windowKey = new Date().toISOString().substring(0, 16); 
  const sk = `rate#${windowKey}`;
  const ttl = Math.floor(Date.now() / 1000) + 120; 

  const limit = 120; 

  try {
    await db(DEVICES_TABLE).update(
      { clientId: clientId, sk: sk },
      "ADD #count :one SET #ttl = :ttl",
      { "#count": "count", "#ttl": "ttl" },
      {
        ":one": 1,
        ":ttl": ttl,
        ":limit": limit
      },
      "attribute_not_exists(#count) OR #count < :limit"
    );
    return true;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return false;
    }
    throw err;
  }
}
