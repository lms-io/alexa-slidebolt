import { db, DATA_TABLE } from '../dynamo.mjs';

/**
 * Exchanges an Alexa Grant Code for Access/Refresh tokens.
 * ALWAYS returns success to the caller (SmartHome Lambda),
 * but logs errors internally.
 */
export async function handleAcceptGrant(userId, directive) {
  const code = directive.payload?.grant?.code;
  const clientId = process.env.ALEXA_CLIENT_ID;
  const clientSecret = process.env.ALEXA_CLIENT_SECRET;

  const successResponse = {
    event: {
      header: {
        namespace: "Alexa.Authorization",
        name: "AcceptGrant.Response",
        payloadVersion: "3",
        messageId: directive.header.messageId + "-rsp"
      },
      payload: {}
    }
  };

  if (!code) {
    console.error("ACCEPT_GRANT_FAIL: Missing code in payload");
    return successResponse;
  }

  if (!clientId || !clientSecret) {
    console.error("ACCEPT_GRANT_FAIL: ALEXA_CLIENT_ID or ALEXA_CLIENT_SECRET not set in environment");
    return successResponse;
  }

  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);

    const res = await fetch("https://api.amazon.com/auth/o2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`ACCEPT_GRANT_FAIL: Amazon Token Exchange failed status=${res.status} body=${errorText}`);
      return successResponse;
    }

    const tokens = await res.json();
    console.log(`ACCEPT_GRANT_SUCCESS: Tokens received for userId=${userId}`);

    // Update the USER record with tokens
    await db(DATA_TABLE).update(
      { pk: `USER#${userId}`, sk: 'METADATA' },
      "SET alexaAccessToken = :at, alexaRefreshToken = :rt, alexaTokenExpiresAt = :exp",
      null,
      {
        ":at": tokens.access_token,
        ":rt": tokens.refresh_token,
        ":exp": new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      }
    );

  } catch (err) {
    console.error(`ACCEPT_GRANT_ERROR: ${err.message}`);
  }

  return successResponse;
}

/**
 * Refreshes an Alexa Access Token if it's expired.
 * Fails silently by returning null if refresh fails.
 */
export async function getValidAlexaToken(userId) {
  try {
    const res = await db(DATA_TABLE).get({ pk: `USER#${userId}`, sk: 'METADATA' });
    const user = res.Item;

    if (!user || !user.alexaRefreshToken) {
      console.log(`TOKEN_REFRESH_SKIP: No refresh token for user=${userId}`);
      return null;
    }

    // Check if still valid (with 5 min buffer)
    const expiresAt = user.alexaTokenExpiresAt ? new Date(user.alexaTokenExpiresAt).getTime() : 0;
    if (Date.now() < (expiresAt - 300000)) {
      return user.alexaAccessToken;
    }

    console.log(`TOKEN_REFRESH_START: Refreshing token for user=${userId}`);

    const clientId = process.env.ALEXA_CLIENT_ID;
    const clientSecret = process.env.ALEXA_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      console.error("TOKEN_REFRESH_FAIL: Missing credentials");
      return null;
    }

    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', user.alexaRefreshToken);
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);

    const refreshRes = await fetch("https://api.amazon.com/auth/o2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });

    if (!refreshRes.ok) {
      const errText = await refreshRes.text();
      console.error(`TOKEN_REFRESH_FAIL: status=${refreshRes.status} body=${errText}`);
      return null;
    }

    const tokens = await refreshRes.json();

    // Update DB
    await db(DATA_TABLE).update(
      { pk: `USER#${userId}`, sk: 'METADATA' },
      "SET alexaAccessToken = :at, alexaRefreshToken = :rt, alexaTokenExpiresAt = :exp",
      null,
      {
        ":at": tokens.access_token,
        ":rt": tokens.refresh_token,
        ":exp": new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      }
    );

    return tokens.access_token;

  } catch (err) {
    console.error(`TOKEN_REFRESH_ERROR: ${err.message}`);
    return null;
  }
}
