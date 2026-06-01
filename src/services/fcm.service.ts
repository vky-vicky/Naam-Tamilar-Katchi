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
  const result: number[] = [];
  const children = await (prisma as any).location.findMany({
    where: { parentId },
    select: { id: true }
  });

  for (const child of children) {
    result.push(child.id);
    const subChildren = await getChildLocationIdsForFCM(child.id);
    result.push(...subChildren);
  }
  return result;
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
        tokens: batchTokens
      };

      const response = await admin.messaging().sendEachForMulticast(message);
      successCount += response.successCount;
      failureCount += response.failureCount;
    }

    console.log(`[FCM] Notifications sent: ${successCount} success, ${failureCount} failed.`);
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
      await admin.messaging().sendEachForMulticast({
        notification: { title, body },
        data: stringData,
        tokens: batchTokens
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

    await admin.messaging().send({
      token,
      notification: { title, body },
      data: stringData
    });
    console.log('[FCM] Sent notification to token successfully');
  } catch (error) {
    console.error('[FCM] Error sending FCM notification to token:', error);
  }
}

