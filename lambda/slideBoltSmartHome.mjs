import { errorResponse } from './lib/alexa/response.mjs';
import { getUserProfile } from './lib/alexa/auth.mjs';
import { handleDiscovery } from './features/alexa/discovery.mjs';
import { handleReportState } from './features/alexa/reportState.mjs';
import { handleControl } from './features/alexa/control.mjs';
import { db, USERS_TABLE } from './lib/dynamo.mjs';

const TEST_ALEXA_TOKEN = process.env.TEST_ALEXA_TOKEN;

export const handler = async (event) => {
  const d = event?.directive;
  const header = d?.header || {};
  const ns = header.namespace;
  const name = header.name;
  
  // 1. Authenticate & Identify User
  let token;
  if (ns === "Alexa.Discovery") {
    token = d?.payload?.scope?.token;
  } else {
    token = d?.endpoint?.scope?.token;
  }

  if (!token) {
    return errorResponse("INVALID_AUTHORIZATION_CREDENTIAL", "Missing bearer token");
  }

  let userId = null;
  let profile = null;

  // Test Bypass: If token starts with "user-", treat it as the userId directly
  // Enhanced format: "user-<id>|<email>"
  if (token.startsWith("user-")) {
    const parts = token.split('|');
    userId = parts[0];
    const email = parts[1] || `${userId}@example.com`;
    console.log(`TEST_MODE: userId=${userId} email=${email}`);
    profile = { user_id: userId, email: email };
  } else if (TEST_ALEXA_TOKEN && token === TEST_ALEXA_TOKEN) {
    console.log("TEST_MODE: Bypassing Auth");
    userId = "test-user-id"; 
  } else {
    profile = await getUserProfile(token);
    if (!profile || !profile.user_id) {
      return errorResponse("INVALID_AUTHORIZATION_CREDENTIAL", "Invalid token");
    }
    userId = profile.user_id;
  }

  const userEmail = profile?.email;
  console.log(`REQ: ${ns}.${name} user=${userId} email=${userEmail}`);

  // 2. Step A: Check for existing User-to-Client mapping
  let mappingRes = await db(USERS_TABLE).get({ pk: `user#${userId}` });
  let mapping = mappingRes.Item;

  // 3. Step B: Auto-Claim Logic (if no mapping exists)
  if (!mapping && userEmail) {
    console.log(`CLAIM_PROCESS: No mapping for ${userId}. Checking email ${userEmail}...`);
    
    // Query GSI to find a client waiting for this email
    const emailLookup = await db(USERS_TABLE).query(
      "ownerEmail = :e",
      { ":e": userEmail },
      "OwnerEmailIndex"
    );

    const candidate = emailLookup.Items?.[0];

    if (candidate) {
      const targetClientId = candidate.clientId;
      console.log(`CLAIM_MATCH: Found client ${targetClientId} for email ${userEmail}`);

      // SUCCESS: First time claim (ownerUserId is missing or null)
      if (!candidate.ownerUserId) {
        console.log(`CLAIM_SUCCESS: user=${userId} claiming client=${targetClientId}`);
        
        // Atomic update to set ownerUserId (ensure we are the first to claim)
        try {
          await db(USERS_TABLE).update(
            { pk: candidate.pk },
            "SET ownerUserId = :u, lastSeen = :now",
            null,
            { ":u": userId, ":now": new Date().toISOString() },
            "attribute_not_exists(ownerUserId)"
          );
          // Add :null to values
          // Wait, I can't pass :null if I don't define it. 
          // Let's just use attribute_not_exists or a simple check if I am the first.
          
          // Better yet, since we are using docClient, just check truthiness.
          
          const newMapping = {
            pk: `user#${userId}`,
            clientId: targetClientId,
            email: userEmail,
            mappedAt: new Date().toISOString()
          };
          await db(USERS_TABLE).put(newMapping);
          
          mapping = newMapping;
          console.log(`CLAIM_FINALIZED: user=${userId} <-> client=${targetClientId}`);
        } catch (err) {
          if (err.name === 'ConditionalCheckFailedException') {
            console.error(`CLAIM_RACE_LOST: client ${targetClientId} already claimed`);
            return errorResponse("ACCEPT_GRANT_FAILED", "Security: House already claimed by another account.");
          }
          throw err;
        }
      } else if (candidate.ownerUserId === userId) {
        // ALREADY CLAIMED BY THIS USER
        console.log(`CLAIM_RECOVER: userId matched ownerUserId. Mapping ensured.`);
        const newMapping = {
          pk: `user#${userId}`,
          clientId: targetClientId,
          email: userEmail,
          mappedAt: new Date().toISOString()
        };
        await db(USERS_TABLE).put(newMapping);
        mapping = newMapping;
      } else {
        // FAIL: Claimed by someone else
        console.error(`CLAIM_DENIED: email ${userEmail} already claimed by userId ${candidate.ownerUserId}`);
        return errorResponse("ACCEPT_GRANT_FAILED", "Security: House already claimed by another account.");
      }
    }
  }

  // 4. Final Validation
  if (!mapping || !mapping.clientId) {
    console.warn(`USER_UNMAPPED: userId=${userId} email=${userEmail}`);
    return errorResponse("ACCEPT_GRANT_FAILED", "No house assigned to this email.");
  }

  // Update last seen info
  if (profile && profile.email && mapping.email !== profile.email) {
    await db(USERS_TABLE).update(
      { pk: `user#${userId}` },
      "SET email = :e, lastSeen = :now",
      null,
      { ":e": profile.email, ":now": new Date().toISOString() }
    );
  }

  const clientId = mapping.clientId;
  console.log(`PROCEED: user=${userId} -> client=${clientId}`);

  // 5. Dispatch
  if (ns === "Alexa.Discovery" && name === "Discover") {
    return await handleDiscovery(clientId);
  }

  if (ns === "Alexa" && name === "ReportState") {
    return await handleReportState(clientId, d);
  }

  if (ns.startsWith("Alexa.") && ns.endsWith("Controller")) {
    return await handleControl(clientId, d);
  }

  return errorResponse("INVALID_DIRECTIVE", "Unhandled directive: " + ns + "." + name);
};
