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
    console.log('🔥 Firebase Admin initialized successfully via file');
    initialized = true;
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log('🔥 Firebase Admin initialized successfully via env var');
      initialized = true;
    } catch (envError) {
      console.error('Error parsing FIREBASE_SERVICE_ACCOUNT_JSON env var:', envError);
    }
  } else {
    console.warn('⚠️ serviceAccountKey.json not found in any of:', possiblePaths);
    console.warn('   and FIREBASE_SERVICE_ACCOUNT_JSON env var not set.');
    console.warn('   Push notifications will be disabled');
  }
} catch (error) {
  console.error('Error initializing Firebase Admin:', error);
}

/**
 * Gets all child location IDs for a given location
 */
export async function getChildLocationIdsForFCM(parentId: number): Promise<number[]> {
  const numericParentId = Number(parentId);
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
  const queue = [...(childrenByParent.get(numericParentId) || [])];

  while (queue.length > 0) {
    const id = queue.shift()!;
    ids.push(id);
    queue.push(...(childrenByParent.get(id) || []));
  }

  return ids;
}

/**
 * Gets all ancestor location IDs for a given location
 */
export async function getAncestorLocationIdsForFCM(locationId: number): Promise<number[]> {
  const ids: number[] = [];
  let currentId: number | null = Number(locationId);
  while (currentId) {
    const loc: { parentId: number | null } | null = await (prisma as any).location.findUnique({
      where: { id: currentId },
      select: { parentId: true }
    });
    if (!loc) break;
    if (loc.parentId) ids.push(loc.parentId);
    currentId = loc.parentId;
  }
  return ids;
}

/**
 * Formats data payload for FCM
 */
function formatDataPayload(data: any): Record<string, string> {
  const stringData: Record<string, string> = {};
  for (const key in data) {
    if (data[key] !== null && data[key] !== undefined) {
      stringData[key] = String(data[key]);
    }
  }
  stringData['click_action'] = 'FLUTTER_NOTIFICATION_CLICK';
  return stringData;
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
  const numericLocationId = Number(locationId);
  if (!initialized) {
    console.log(`[FCM Simulation] Would send to location ${numericLocationId}: ${title}`);
    return;
  }

  try {
    const childIds = await getChildLocationIdsForFCM(numericLocationId);
    const ancestorIds = await getAncestorLocationIdsForFCM(numericLocationId);
    const targetLocations = Array.from(new Set([numericLocationId, ...childIds, ...ancestorIds]));

    console.log(`[FCM] Target locations for notification: ${targetLocations.join(', ')}`);

    const [users, members, superAdminUsers, superAdminMembers] = await Promise.all([
      (prisma as any).user.findMany({
        where: { locationId: { in: targetLocations }, fcmToken: { not: null } },
        select: { fcmToken: true }
      }),
      (prisma as any).member.findMany({
        where: { locationId: { in: targetLocations }, fcmToken: { not: null } },
        select: { fcmToken: true }
      }),
      (prisma as any).user.findMany({
        where: { role: 'SUPER_ADMIN', fcmToken: { not: null } },
        select: { fcmToken: true }
      }),
      (prisma as any).member.findMany({
        where: { role: { in: ['SUPER_ADMIN', 'Super Admin'] }, fcmToken: { not: null } },
        select: { fcmToken: true }
      })
    ]);

    console.log(`[FCM] Found tokens — Users: ${users.length}, Members: ${members.length}, SuperAdminUsers: ${superAdminUsers.length}`);

    const tokens = [
      ...users.map((u: any) => u.fcmToken as string),
      ...members.map((m: any) => m.fcmToken as string),
      ...superAdminUsers.map((u: any) => u.fcmToken as string),
      ...superAdminMembers.map((m: any) => m.fcmToken as string)
    ].filter((t: any) => t && t.trim() !== '');

    const uniqueTokens = Array.from(new Set<string>(tokens as string[]));

    if (uniqueTokens.length === 0) {
      console.warn(`[FCM] ⚠️ No FCM tokens found for location ${numericLocationId}. Notification NOT sent.`);
      console.warn(`[FCM] ⚠️ Make sure members have called updateFcmToken after login!`);
      return;
    }

    console.log(`[FCM] Sending "${title}" to ${uniqueTokens.length} unique device(s)...`);
    const stringData = formatDataPayload(data);
    const batchSize = 500;

    for (let i = 0; i < uniqueTokens.length; i += batchSize) {
      const batchTokens = uniqueTokens.slice(i, i + batchSize);
      const message = {
        notification: { title, body },
        data: stringData,
        android: {
          priority: 'high' as const,
          notification: { sound: 'default', channelId: 'high_importance_channel', priority: 'max' as const }
        },
        apns: { payload: { aps: { sound: 'default', badge: 1 } } },
        tokens: batchTokens
      };

      const response = await admin.messaging().sendEachForMulticast(message);
      console.log(`[FCM] ✅ Sent batch ${Math.floor(i/batchSize)+1}: Success=${response.successCount}, Failure=${response.failureCount}`);
      response.responses.forEach((res, idx) => {
        if (!res.success) {
          console.error(`[FCM] ❌ Token failed [${batchTokens[idx]?.substring(0,20)}...]: ${res.error?.message}`);
          // Clean up invalid tokens
          if (res.error?.code === 'messaging/registration-token-not-registered' ||
              res.error?.code === 'messaging/invalid-registration-token') {
            const badToken = batchTokens[idx];
            if (badToken) {
              (prisma as any).member.updateMany({ where: { fcmToken: badToken }, data: { fcmToken: null } }).catch(() => {});
              (prisma as any).user.updateMany({ where: { fcmToken: badToken }, data: { fcmToken: null } }).catch(() => {});
            }
          }
        }
      });
    }
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
            priority: 'max' as const,
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
          priority: 'max' as const,
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

