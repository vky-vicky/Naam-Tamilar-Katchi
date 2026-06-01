import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let initialized = false;

try {
  // Try multiple paths to find serviceAccountKey.json
  const possiblePaths = [
    path.resolve(process.cwd(), 'serviceAccountKey.json'),
    path.resolve(__dirname, '../../serviceAccountKey.json'),
    path.resolve(__dirname, '../../../serviceAccountKey.json'),
  ];

  let serviceAccountPath: string | null = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      serviceAccountPath = p;
      break;
    }
  }

  if (serviceAccountPath) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('🔥 Firebase Admin initialized successfully');
    initialized = true;
  } else {
    console.warn('⚠️ serviceAccountKey.json not found in any of:', possiblePaths);
    console.warn('   Push notifications will be disabled');
  }
} catch (error) {
  console.error('Error initializing Firebase Admin:', error);
}

/**
 * Gets all child location IDs for a given location
 */
export async function getChildLocationIdsForFCM(parentId: number): Promise<number[]> {
  const locations = await (prisma as any).location.findMany({
    select: { id: true, parentId: true },
  });
  const childrenByParent = new Map<number, number[]>();

  for (const location of locations) {
    if (location.parentId === null || location.parentId === undefined) continue;
    const siblings = childrenByParent.get(location.parentId) || [];
    siblings.push(location.id);
    childrenByParent.set(location.parentId, siblings);
  }

  const ids: number[] = [];
  const queue = [...(childrenByParent.get(parentId) || [])];

  while (queue.length > 0) {
    const id = queue.shift()!;
    ids.push(id);
    queue.push(...(childrenByParent.get(id) || []));
  }

  return ids;
}

/**
 * Sends a push notification to all users/members in a given location tree
 */
export async function sendNotificationToLocation(
  locationId: number, 
  title: string, 
  body: string, 
  data: any = {}
) {
  if (!initialized) {
    console.log(`[FCM Simulation] Would send to location ${locationId}: ${title}`);
    return;
  }

  try {
    const childIds = await getChildLocationIdsForFCM(locationId);
    const targetLocations = [locationId, ...childIds];

    const users = await (prisma as any).user.findMany({
      where: { locationId: { in: targetLocations }, fcmToken: { not: null } },
      select: { fcmToken: true }
    });

    const members = await (prisma as any).member.findMany({
      where: { locationId: { in: targetLocations }, fcmToken: { not: null } },
      select: { fcmToken: true }
    });

    const tokens = [
      ...users.map((u: any) => u.fcmToken as string),
      ...members.map((m: any) => m.fcmToken as string)
    ].filter((t: any) => t && t.trim() !== '');

    const uniqueTokens = Array.from(new Set<string>(tokens as string[]));

    if (uniqueTokens.length === 0) {
      console.log(`[FCM] No FCM tokens found for location ${locationId} and its children.`);
      return;
    }

    // Convert data values to strings (FCM requirement)
    const stringData: Record<string, string> = {};
    for (const key in data) {
      if (data[key] !== null && data[key] !== undefined) {
        stringData[key] = String(data[key]);
      }
    }
    stringData['click_action'] = 'FLUTTER_NOTIFICATION_CLICK';

    // FCM has a limit of 500 tokens per multicast request
    const batchSize = 500;
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < uniqueTokens.length; i += batchSize) {
      const batchTokens = uniqueTokens.slice(i, i + batchSize);
      const message = {
        notification: {
          title,
          body
        },
        data: stringData,
        android: {
          priority: 'high' as const,
          notification: {
            sound: 'default',
            channelId: 'high_importance_channel',
            priority: 'high' as const,
          }
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
            }
          }
        },
        tokens: batchTokens
      };

      console.log('[FCM] Sending Multicast Payload:', JSON.stringify({
        notification: message.notification,
        data: message.data,
        android: message.android,
        apns: message.apns,
        tokenCount: batchTokens.length
      }, null, 2));

      const response = await admin.messaging().sendEachForMulticast(message);
      successCount += response.successCount;
      failureCount += response.failureCount;

      console.log(`[FCM] Multicast Response: Success Count = ${response.successCount}, Failure Count = ${response.failureCount}`);
      response.responses.forEach((res, idx) => {
        if (!res.success) {
          console.error(`[FCM] Failed Token [${batchTokens[idx]}]:`, res.error);
        } else {
          console.log(`[FCM] Success Token [${batchTokens[idx]}]: Message ID = ${res.messageId}`);
        }
      });
    }

    console.log(`[FCM] Notifications sent summary: ${successCount} success, ${failureCount} failed.`);
  } catch (error) {
    console.error('[FCM] Error sending FCM notification:', error);
  }
}

/**
 * Sends a push notification to a specific community
 */
export async function sendNotificationToCommunity(
  communityId: number, 
  title: string, 
  body: string, 
  data: any = {}
) {
  if (!initialized) return;

  try {
    const communityMembers = await (prisma as any).communityMember.findMany({
      where: { communityId },
      include: {
        member: {
          select: { fcmToken: true }
        }
      }
    });

    const tokens = communityMembers
      .map((cm: any) => cm.member?.fcmToken)
      .filter((t: any) => t && t.trim() !== '');

    const uniqueTokens = Array.from(new Set<string>(tokens as string[]));

    if (uniqueTokens.length === 0) return;

    const stringData: Record<string, string> = {};
    for (const key in data) {
      if (data[key] !== null && data[key] !== undefined) {
        stringData[key] = String(data[key]);
      }
    }
    stringData['click_action'] = 'FLUTTER_NOTIFICATION_CLICK';

    const batchSize = 500;
    for (let i = 0; i < uniqueTokens.length; i += batchSize) {
      const batchTokens = uniqueTokens.slice(i, i + batchSize);
      const message = {
        notification: { title, body },
        data: stringData,
        android: {
          priority: 'high' as const,
          notification: {
            sound: 'default',
            channelId: 'high_importance_channel',
            priority: 'high' as const,
          }
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
            }
          }
        },
        tokens: batchTokens
      };

      console.log('[FCM] Sending Community Multicast Payload:', JSON.stringify({
        notification: message.notification,
        data: message.data,
        tokenCount: batchTokens.length
      }, null, 2));

      const response = await admin.messaging().sendEachForMulticast(message);
      console.log(`[FCM] Community Multicast Response: Success = ${response.successCount}, Failure = ${response.failureCount}`);
      response.responses.forEach((res, idx) => {
        if (!res.success) {
          console.error(`[FCM] Community Token Failed [${batchTokens[idx]}]:`, res.error);
        } else {
          console.log(`[FCM] Community Token Success [${batchTokens[idx]}]: Message ID = ${res.messageId}`);
        }
      });
    }
  } catch (error) {
    console.error('[FCM] Error sending to community:', error);
  }
}

/**
 * Sends a push notification to a single FCM token (e.g. for individual approvals)
 */
export async function sendNotificationToToken(
  token: string,
  title: string,
  body: string,
  data: any = {}
) {
  if (!initialized) return;

  try {
    const stringData: Record<string, string> = {};
    for (const key in data) {
      if (data[key] !== null && data[key] !== undefined) {
        stringData[key] = String(data[key]);
      }
    }
    stringData['click_action'] = 'FLUTTER_NOTIFICATION_CLICK';

    console.log('[FCM] Sending Single Token Payload:', JSON.stringify({
      token,
      title,
      body,
      data: stringData
    }, null, 2));

    const response = await admin.messaging().send({
      token,
      notification: { title, body },
      data: stringData,
      android: {
        priority: 'high' as const,
        notification: {
          sound: 'default',
          channelId: 'high_importance_channel',
          priority: 'high' as const,
        }
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          }
        }
      }
    });
    console.log('[FCM] Sent notification to token successfully. Message ID:', response);
  } catch (error) {
    console.error('[FCM] Error sending FCM notification to token:', error);
  }
}

