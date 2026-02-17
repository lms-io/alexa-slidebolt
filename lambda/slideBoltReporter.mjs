import { db, DATA_TABLE } from './lib/dynamo.mjs';
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { getValidAlexaToken } from './lib/alexa/tokens.mjs';

export const handler = async (event) => {
  console.log(`REPORTER_TRIGGER: Processing ${event.Records.length} records`);

  for (const record of event.Records) {
    const isRemove = record.eventName === 'REMOVE';
    if (record.eventName !== 'MODIFY' && record.eventName !== 'INSERT' && !isRemove) continue;

    const oldImage = record.dynamodb.OldImage ? unmarshall(record.dynamodb.OldImage) : null;
    const newImage = record.dynamodb.NewImage ? unmarshall(record.dynamodb.NewImage) : null;

    const image = isRemove ? oldImage : newImage;
    const pk = image?.pk || oldImage?.pk;
    const sk = image?.sk || oldImage?.sk;

    // 1. Filter: Only care about devices
    if (!sk?.startsWith('DEVICE#')) {
      console.log(`SKIP: Not a device item (${sk})`);
      continue;
    }

    const clientId = image?.clientId || oldImage?.clientId;
    const deviceId = sk.replace('DEVICE#', '');

    // 2. Filter: Deduplication (only report if state actually changed — skip for deletes)
    if (!isRemove) {
      const oldStatus = oldImage?.status;
      const newStatus = newImage?.status;

      // Detect Soft Delete (active -> deleted)
      const isSoftDelete = oldStatus === 'active' && newStatus === 'deleted';

      if (!isSoftDelete) {
        const oldStateStr = JSON.stringify(oldImage?.state || {});
        const newStateStr = JSON.stringify(newImage?.state || {});

        if (oldStateStr === newStateStr) {
          console.log(`SKIP: No state change for ${clientId}/${deviceId}`);
          continue;
        }
      } else {
        console.log(`SOFT_DELETE_DETECTED: ${clientId}/${deviceId}`);
      }
    }

    const isReportingDelete = isRemove || (newImage?.status === 'deleted' && oldImage?.status === 'active');
    console.log(`${isReportingDelete ? 'DELETE' : 'CHANGE'}_DETECTED: ${clientId}/${deviceId}`);

    // 3. Enrichment: Fetch Client Metadata (Tokens/Owner)
    try {
      const metaPk = `CLIENT#${clientId}`;
      console.log(`ENRICH_START: Fetching ${metaPk} METADATA`);
      const metaRes = await db(DATA_TABLE).get({ pk: metaPk, sk: 'METADATA' });
      const meta = metaRes.Item;

      if (!meta) {
        console.warn(`ENRICH_FAIL: No metadata found for ${metaPk}`);
        continue;
      }

      const userId = meta.ownerUserId;
      if (!userId) {
        console.log(`ENRICH_SKIP: No ownerUserId for ${clientId}`);
        continue;
      }

      // 4. Alexa Proactive Reporting (Convenience Feature)
      try {
        const accessToken = await getValidAlexaToken(userId);
        if (!accessToken) {
          console.log(`PROACTIVE_SKIP: No valid Alexa token for userId=${userId}`);
          continue;
        }

        let report;

        if (isReportingDelete) {
          console.log(`PROACTIVE_START: Sending DeleteReport for ${deviceId}`);

          report = {
            event: {
              header: {
                namespace: "Alexa.Discovery",
                name: "DeleteReport",
                payloadVersion: "3",
                messageId: `${Date.now()}-${deviceId}`
              },
              payload: {
                endpoints: [{ endpointId: deviceId }],
                scope: { type: "BearerToken", token: accessToken }
              }
            }
          };
        } else {
          console.log(`PROACTIVE_START: Sending ChangeReport for ${deviceId}`);

          report = {
            event: {
              header: {
                namespace: "Alexa",
                name: "ChangeReport",
                payloadVersion: "3",
                messageId: `${Date.now()}-${deviceId}`
              },
              endpoint: {
                scope: { type: "BearerToken", token: accessToken },
                endpointId: deviceId
              },
              payload: {
                change: {
                  cause: { type: "PHYSICAL_INTERACTION" },
                  properties: newImage.state?.properties || []
                }
              }
            }
          };
        }

        const alexaRes = await fetch("https://api.amazonalexa.com/v3/events", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`
          },
          body: JSON.stringify(report)
        });

        if (!alexaRes.ok) {
          const errBody = await alexaRes.text();
          console.warn(`PROACTIVE_FAIL: Alexa Gateway returned ${alexaRes.status} body=${errBody}`);
        } else {
          console.log(`PROACTIVE_SUCCESS: ${isRemove ? 'DeleteReport' : 'ChangeReport'} sent for ${deviceId} status=${alexaRes.status}`);
        }

      } catch (alexaErr) {
        // SILENT FAILURE: Do not break the pipeline if Alexa reporting fails
        console.error(`PROACTIVE_ERROR: Silent failure for ${deviceId}: ${alexaErr.message}`);
      }

    } catch (err) {
      console.error(`ERROR_PROCESSING_RECORD: ${err.message}`);
    }
  }

  return { statusCode: 200, body: "ok" };
};
