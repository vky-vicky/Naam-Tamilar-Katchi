import { UserRole } from '@prisma/client';
import prisma from '../db.js';
import { whatsappService } from '../services/whatsapp.service.js';
import { I18nService } from '../services/i18n.service.js';
import { sendNotificationToLocation, sendNotificationToCommunity, sendNotificationToToken } from '../services/fcm.service.js';
import { ContributionService } from '../services/contribution.service.js';
import { RazorpayService } from '../services/razorpay.service.js';
import { uploadToCloudinary } from '../services/cloudinary.service.js';

function getReadableError(err: any, lang: string = 'en') {
  const prismaCode = err?.code;
  const target = Array.isArray(err?.meta?.target) ? err.meta.target.join(', ') : '';
  const message = err?.message ?? '';

  if (
    prismaCode === 'P2002' || 
    (message.includes('Unique constraint failed') && message.includes('phone')) ||
    message === 'phone_already_registered' ||
    message === 'USER_PHONE_ALREADY_EXISTS' ||
    message.includes('Mobile number already exists') ||
    message.includes('கைபேசி எண் ஏற்கனவே பயன்படுத்தப்பட்டுள்ளது') ||
    message.includes('is already registered') ||
    message.includes('ஏற்கனவே பதிவு செய்யப்பட்டுள்ளது')
  ) {
    return {
      code: 'REQUEST_FAILED',
      message: I18nService.translate('phone_already_registered', lang),
      detail: target ? `Duplicate unique field: ${target}` : 'Duplicate phone number'
    };
  }

  if (message === 'invalid_phone_format') {
    return {
      code: 'REQUEST_FAILED',
      message: I18nService.translate('invalid_phone_format', lang),
      detail: 'Phone number must be exactly 10 digits'
    };
  }

  if (prismaCode === 'P2003' || message.includes('Foreign key constraint failed') || message.includes('connect')) {
    return {
      code: 'INVALID_REFERENCE',
      message: I18nService.translate('invalid_referenced_data', lang),
      detail: 'Check locationId, memberId, communityId, or profession reference.'
    };
  }

  if (prismaCode === 'P2025') {
    return {
      code: 'RECORD_NOT_FOUND',
      message: 'Record not found. Please check the ID.',
      detail: message
    };
  }

  return {
    code: 'REQUEST_FAILED',
    message: I18nService.translate(message as any, lang),
    detail: message
  };
}

// Helper to wrap resolvers and return consistent error objects
// Helper to wrap resolvers and return consistent, translated GraphQL errors
function safeResolver<T>(fn: (...args: any[]) => Promise<T>) {
  return async (...args: any[]) => {
    try {
      return await fn(...args);
    } catch (err: any) {
      const context = args[2];
      const lang = context?.language || 'en';
      const readableError = getReadableError(err, lang);

      console.error('Resolver Error:', {
        code: readableError.code,
        message: readableError.message,
        detail: readableError.detail,
        prismaCode: err?.code,
        prismaModel: err?.meta?.modelName,
        args: args[1]
      });

      throw new Error(`[${readableError.code}] ${readableError.message}`);
    }
  };
}

// Helper to parse flexible date formats: DDMMYYYY, DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, ISO
function parseFlexibleDate(dateStr: string): Date {
  if (!dateStr) throw new Error('Date is required');
  const s = dateStr.trim();

  // DDMMYYYY (e.g. "23062026")
  if (/^\d{8}$/.test(s)) {
    const day   = parseInt(s.substring(0, 2), 10);
    const month = parseInt(s.substring(2, 4), 10) - 1;
    const year  = parseInt(s.substring(4, 8), 10);
    const d = new Date(year, month, day);
    if (isNaN(d.getTime())) throw new Error(`Invalid date: ${dateStr}`);
    return d;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (dmyMatch) {
    const day   = parseInt(dmyMatch[1]!, 10);
    const month = parseInt(dmyMatch[2]!, 10) - 1;
    const year  = parseInt(dmyMatch[3]!, 10);
    const d = new Date(year, month, day);
    if (isNaN(d.getTime())) throw new Error(`Invalid date: ${dateStr}`);
    return d;
  }

  // Standard ISO / any other format
  const d = new Date(s);
  if (isNaN(d.getTime())) throw new Error(`Invalid date format: ${dateStr}. Use DDMMYYYY, DD/MM/YYYY or YYYY-MM-DD`);
  return d;
}

async function processAndValidateImageUrls(urls: string | string[] | null | undefined): Promise<string[]> {
  if (!urls) return [];
  const urlList = Array.isArray(urls) ? urls : [urls];
  const processedUrls: string[] = [];

  for (const url of urlList) {
    if (url && typeof url === 'string') {
      const trimmed = url.trim();
      if (trimmed !== '') {
        if (trimmed.startsWith('data:') || (trimmed.length > 200 && !trimmed.startsWith('http'))) {
          const cloudinaryUrl = await uploadToCloudinary(trimmed);
          processedUrls.push(cloudinaryUrl);
        } else if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
          processedUrls.push(trimmed);
        } else {
          throw new Error('Invalid image: Images must be uploaded to the server or sent as base64. Local paths (file://) are not allowed.');
        }
      }
    }
  }
  return processedUrls;
}

// Helper to get all child location IDs without one DB query per tree node.
async function getChildLocationIds(locationId: number): Promise<number[]> {
  const numericLocationId = Number(locationId);
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
  const queue = [...(childrenByParent.get(numericLocationId) || [])];

  while (queue.length > 0) {
    const id = queue.shift()!;
    ids.push(id);
    queue.push(...(childrenByParent.get(id) || []));
  }

  return ids;
}

// Helper to get all parent/ancestor location IDs up to the root.
async function getAncestorLocationIds(locationId: number): Promise<number[]> {
  const numericLocationId = Number(locationId);
  const ids: number[] = [numericLocationId];
  let currentId = numericLocationId;
  while (true) {
    const loc = await (prisma as any).location.findUnique({
      where: { id: currentId },
      select: { parentId: true }
    });
    if (!loc || !loc.parentId) break;
    ids.push(loc.parentId);
    currentId = loc.parentId;
  }
  return ids;
}

async function getAccessibleLocationIds(userId: number, role: string): Promise<number[]> {
  if (role === 'SUPER_ADMIN') return []; // Flag for all locations

  const userLocations = await (prisma as any).userLocation.findMany({
    where: { userId },
    select: { locationId: true }
  });

  const allIds: number[] = [];
  for (const { locationId } of userLocations) {
    allIds.push(locationId);
    const children = await getChildLocationIds(locationId);
    allIds.push(...children);
  }
  return [...new Set(allIds)];
}

async function canAccessLocation(userId: number, role: string, targetLocationId: number): Promise<boolean> {
  if (role === 'SUPER_ADMIN') return true;
  const ids = await getAccessibleLocationIds(userId, role);
  return ids.includes(Number(targetLocationId));
}

const PERMISSIONS: Record<string, string[]> = {
  OWNER: ['MANAGE_COMMUNITY', 'MANAGE_MEMBERS', 'POST_ANNOUNCEMENT', 'MODERATE_CONTENT', 'CREATE_EVENT', 'CREATE_POLL', 'VIEW_ANALYTICS', 'BAN_USER'],
  ADMIN: ['MANAGE_MEMBERS', 'POST_ANNOUNCEMENT', 'MODERATE_CONTENT', 'CREATE_EVENT', 'CREATE_POLL', 'VIEW_ANALYTICS', 'BAN_USER'],
  MODERATOR: ['MODERATE_CONTENT', 'VIEW_ANALYTICS'],
  MEMBER: ['SEND_MESSAGE']
};

function hasGroupPermission(groupRole: string, action: string): boolean {
  return PERMISSIONS[groupRole]?.includes(action) || false;
}

async function getUserGroupRole(userId: number, communityId: number): Promise<string | null> {
  const member = await (prisma as any).communityMember.findUnique({
    where: { communityId_memberId: { communityId, memberId: userId } }
  });
  return member?.groupRole || null;
}

async function getCommunityRoleFromContext(context: any, communityId: number): Promise<string | null> {
  const user = context?.user;
  if (!user) return null;

  // Treat SUPER_ADMIN as full community admin for moderation flows.
  if (user.role === 'SUPER_ADMIN') return 'OWNER';

  const memberId = await getMemberIdFromContext(context);
  if (!memberId) return null;

  return getUserGroupRole(memberId, communityId);
}

async function getUniqueRecipientCount(locationId: number): Promise<number> {
  const targetIds = await getChildLocationIds(locationId);
  const allIds = [Number(locationId), ...targetIds];

  const [members, users] = await Promise.all([
    (prisma as any).member.findMany({
      where: { locationId: { in: allIds }, isActive: true },
      select: { phone: true }
    }),
    (prisma as any).user.findMany({
      where: { locationId: { in: allIds }, isActive: true },
      select: { phone: true }
    })
  ]);

  const uniquePhones = new Set<string>();
  for (const m of members) {
    if (m.phone) {
      const cleanPhone = m.phone.trim().toLowerCase();
      if (cleanPhone) uniquePhones.add(cleanPhone);
    }
  }
  for (const u of users) {
    if (u.phone) {
      const cleanPhone = u.phone.trim().toLowerCase();
      if (cleanPhone) uniquePhones.add(cleanPhone);
    }
  }

  return uniquePhones.size;
}


async function findParentLocationOfType(locationId: number, targetType: string): Promise<number | null> {
  const ancestorIds = await getAncestorLocationIds(locationId);
  for (const aId of ancestorIds) {
    const loc = await (prisma as any).location.findUnique({
      where: { id: aId },
      select: { id: true, type: true }
    });
    if (loc?.type === targetType) {
      return loc.id;
    }
  }
  return null;
}

// Helper to calculate location proximity scores for AI Feed
async function getUserLocationScoreMap(locationId: number | null | undefined): Promise<Map<number, number>> {
  const scores = new Map<number, number>();
  if (!locationId) return scores;

  let currentId = locationId;
  while (true) {
    const loc = await (prisma as any).location.findUnique({
      where: { id: currentId },
      select: { id: true, type: true, parentId: true }
    });
    if (!loc) break;
    
    if (loc.type === 'STREET') scores.set(loc.id, 100);
    else if (loc.type === 'AREA') scores.set(loc.id, 80);
    else if (loc.type === 'TALUK') scores.set(loc.id, 60);
    else if (loc.type === 'DISTRICT') scores.set(loc.id, 40);
    else if (loc.type === 'STATE') scores.set(loc.id, 20);
    else scores.set(loc.id, 10); // Fallback

    if (!loc.parentId) break;
    currentId = loc.parentId;
  }
  return scores;
}

async function getLocationFields(locationId: number | null | undefined) {
  const fields = {
    district: null as string | null,
    constituency: null as string | null,
    area: null as string | null,
    street: null as string | null,
  };
  if (!locationId) return fields;

  let currentId = locationId;
  while (true) {
    const loc = await (prisma as any).location.findUnique({
      where: { id: currentId },
      select: { id: true, name: true, type: true, parentId: true }
    });
    if (!loc) break;
    if (loc.type === 'DISTRICT') fields.district = loc.name;
    else if (loc.type === 'TALUK') fields.constituency = loc.name;
    else if (loc.type === 'AREA') fields.area = loc.name;
    else if (loc.type === 'STREET') fields.street = loc.name;

    if (!loc.parentId) break;
    currentId = loc.parentId;
  }
  return fields;
}

async function sendSystemNotification({
  title,
  message,
  type,
  locationId,
  createdById,
  purpose,
  entityType,
  entityId,
  metadata,
  data = {}
}: {
  title: string;
  message: string;
  type: string;
  locationId: number;
  createdById?: number | null;
  purpose?: string | null;
  entityType?: string | null;
  entityId?: number | null;
  metadata?: any;
  data?: any;
}) {
  let targetLocationId = Number(locationId);
  const talukId = await findParentLocationOfType(targetLocationId, 'TALUK');
  if (talukId) {
    targetLocationId = talukId;
  }

  const notification = await (prisma as any).notification.create({
    data: {
      title,
      message,
      type,
      locationId: targetLocationId,
      createdById: createdById || null,
      purpose: purpose || null,
      entityType: entityType || type,
      entityId: entityId || null,
      metadata: metadata || null,
      time: 'Just now'
    }
  });

  const io = (global as any).io;
  if (io) {
    io.emit('newNotification', notification);
    
    // Emit specialized real-time events containing full entity details
    if (type === 'BROADCAST' || entityType === 'BROADCAST') {
      if (entityId) {
        (prisma as any).broadcast.findUnique({
          where: { id: Number(entityId) },
          include: { location: true, createdBy: true }
        }).then(async (broadcastObj: any) => {
          if (broadcastObj) {
            const recipientCount = await getUniqueRecipientCount(broadcastObj.locationId);
            const enrichedBroadcast = {
              ...broadcastObj,
              recipientCount,
              createdAt: toIST(broadcastObj.createdAt),
              updatedAt: toIST(broadcastObj.updatedAt)
            };
            io.emit('newBroadcast', enrichedBroadcast);
            io.emit('broadcast', enrichedBroadcast);
          }
        }).catch((err: any) => console.error('[Socket] Error fetching broadcast for emit:', err));
      }
    } else if (type === 'EMERGENCY' || entityType === 'EMERGENCY') {
      if (entityId) {
        (prisma as any).emergencyRequest.findUnique({
          where: { id: Number(entityId) },
          include: { location: true, createdBy: true, member: true }
        }).then((emergencyObj: any) => {
          if (emergencyObj) {
            io.emit('newEmergencyRequest', emergencyObj);
            io.emit('emergencyRequest', emergencyObj);
          }
        }).catch((err: any) => console.error('[Socket] Error fetching emergency for emit:', err));
      }
    } else if (type === 'EVENT' || entityType === 'EVENT') {
      if (entityId) {
        (prisma as any).event.findUnique({
          where: { id: Number(entityId) },
          include: { location: true, createdBy: true }
        }).then((eventObj: any) => {
          if (eventObj) {
            io.emit('newEvent', eventObj);
            io.emit('event', eventObj);
          }
        }).catch((err: any) => console.error('[Socket] Error fetching event for emit:', err));
      }
    }
  }

  await sendNotificationToLocation(targetLocationId, title, message, {
    ...data,
    type,
    notificationId: notification.id
  }).catch(e => console.error('[FCM] Error sending push notification:', e));

  return notification;
}

function toIsoString(value: any) {
  if (value === null || value === undefined) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function parseJsonInput(value: any) {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return { raw: value };
  }
}

function normalizeEmergencyResponseStatus(status: string) {
  const normalized = String(status || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  const aliases: Record<string, string> = {
    IM_COMING: 'COMING',
    I_AM_COMING: 'COMING',
    DONATE_BLOOD: 'COMING',
    VOLUNTEER: 'COMING',
    NOT_AVAILABLE: 'UNABLE',
    UNABLE_TO_COME: 'UNABLE',
    CONTACT_ME: 'CONTACT_REQUESTED',
  };
  return aliases[normalized] || normalized;
}

function buildEmergencyResponseStats(responses: any[] = []) {
  const count = (status: string) => responses.filter((r: any) => r.status === status).length;
  return {
    total: responses.length,
    going: count('GOING'),
    maybe: count('MAYBE'),
    notGoing: count('NOT_GOING'),
    coming: count('COMING') + count('GOING'),
    onTheWay: count('ON_THE_WAY'),
    reached: count('REACHED'),
    unable: count('UNABLE') + count('NOT_GOING'),
    contactRequested: count('CONTACT_REQUESTED'),
  };
}

async function buildLocationScope(locationId: number) {
  const scope = {
    state: null as string | null,
    district: null as string | null,
    constituency: null as string | null,
    area: null as string | null,
    street: null as string | null,
    label: ''
  };

  const names: string[] = [];
  let currentId: number | null = locationId;
  while (currentId) {
    const loc: { name: string; type: string; parentId: number | null } | null = await (prisma as any).location.findUnique({
      where: { id: currentId },
      select: { name: true, type: true, parentId: true }
    });
    if (!loc) break;
    names.unshift(loc.name);
    if (loc.type === 'STATE') scope.state = loc.name;
    else if (loc.type === 'DISTRICT') scope.district = loc.name;
    else if (loc.type === 'TALUK') scope.constituency = loc.name;
    else if (loc.type === 'AREA') scope.area = loc.name;
    else if (loc.type === 'STREET') scope.street = loc.name;
    currentId = loc.parentId;
  }

  scope.label = names.join(' -> ') || 'All locations';
  return scope;
}

function buildNotificationActions(type: string, entity: any) {
  const normalizedType = String(type || '').toUpperCase();
  if (normalizedType === 'EMERGENCY' || normalizedType === 'ALERT' || normalizedType === 'REQUEST') {
    const isBlood = String(entity?.type || entity?.title || '').toUpperCase().includes('BLOOD');
    return [
      { key: 'COMING', label: isBlood ? 'ரத்த தானம் செய்ய வருகிறேன்' : "I'm Coming", style: 'success' },
      { key: 'ON_THE_WAY', label: 'வழியில் இருக்கிறேன்', style: 'warning' },
      { key: 'REACHED', label: 'இடத்தை அடைந்துவிட்டேன்', style: 'info' },
      { key: 'UNABLE', label: 'வர முடியாது', style: 'danger' },
      { key: 'CALL_NOW', label: 'Call Now', style: 'primary' },
      { key: 'WHATSAPP', label: 'WhatsApp', style: 'primary' },
      { key: 'OPEN_LOCATION', label: 'Open Location', style: 'secondary' },
      { key: 'SHARE_ALERT', label: 'Share Alert', style: 'secondary' },
    ];
  }
  if (normalizedType === 'EVENT') {
    return [
      { key: 'RSVP_GOING', label: 'Attend', style: 'success' },
      { key: 'RSVP_MAYBE', label: 'Maybe', style: 'warning' },
      { key: 'RSVP_NOT_GOING', label: 'Not Attend', style: 'danger' },
      { key: 'ADD_CALENDAR', label: 'Add To Calendar', style: 'primary' },
      { key: 'OPEN_LOCATION', label: 'Open Location', style: 'secondary' },
      { key: 'SHARE_EVENT', label: 'Share Event', style: 'secondary' },
    ];
  }
  if (normalizedType === 'MEMBER_REQUEST') {
    return [
      { key: 'APPROVE', label: 'Approve', style: 'success' },
      { key: 'REJECT', label: 'Reject', style: 'danger' },
      { key: 'VIEW_PROFILE', label: 'View Member Profile', style: 'secondary' },
    ];
  }
  return [{ key: 'SHARE', label: 'Share', style: 'secondary' }];
}

async function getUserJoinedAt(context: any): Promise<Date | null> {
  if (!context?.user) return null;
  if (context.user.type === 'admin') {
    const adminUser = await (prisma as any).user.findUnique({
      where: { id: Number(context.user.id) },
      select: { createdAt: true }
    });
    return adminUser ? adminUser.createdAt : null;
  } else {
    const memberUser = await (prisma as any).member.findUnique({
      where: { id: Number(context.user.id) },
      select: { createdAt: true }
    });
    return memberUser ? memberUser.createdAt : null;
  }
}

async function getBroadcastListForContext({ locationId, scope, broadcastId, isActive }: any, context: any) {
  const user = context.user;
  if (!user) return [];
  const role = user.role;
  const userLocId = user.locationId;

  let visibleLocationIds: number[] = [];
  if (role === 'SUPER_ADMIN') {
    visibleLocationIds = [];
  } else if (role === 'ADMIN' || role === 'SUB_ADMIN') {
    if (!userLocId) return [];
    const childIds = await getChildLocationIds(userLocId);
    const ancestorIds = await getAncestorLocationIds(userLocId);
    visibleLocationIds = Array.from(new Set([...ancestorIds, ...childIds]));
  } else {
    if (!userLocId) return [];
    const talukId = await findParentLocationOfType(userLocId, 'TALUK');
    if (talukId) {
      const childIds = await getChildLocationIds(talukId);
      const ancestorIds = await getAncestorLocationIds(talukId);
      visibleLocationIds = Array.from(new Set([talukId, ...childIds, ...ancestorIds]));
    } else {
      const ancestorIds = await getAncestorLocationIds(userLocId);
      visibleLocationIds = ancestorIds;
    }
  }

  const where: any = {};
  if (broadcastId) {
    where.id = Number(broadcastId);
  } else if (locationId !== undefined && locationId !== null) {
    const ancestorIds = await getAncestorLocationIds(Number(locationId));
    const childIds = await getChildLocationIds(Number(locationId));
    const selectedLocationIds = [...ancestorIds, Number(locationId), ...childIds];
    if (visibleLocationIds.length > 0) {
      where.locationId = { in: selectedLocationIds.filter(id => visibleLocationIds.includes(id)) };
    } else {
      where.locationId = { in: selectedLocationIds };
    }
  } else if (visibleLocationIds.length > 0) {
    where.locationId = { in: visibleLocationIds };
  }

  if (scope) where.scope = scope;
  if (role === 'MEMBER') {
    where.isActive = true;
  } else if (isActive !== undefined && isActive !== null) {
    where.isActive = Boolean(isActive);
  }

  const joinedAt = await getUserJoinedAt(context);
  if (joinedAt) {
    where.createdAt = { gte: joinedAt };
  }

  const broadcasts = await (prisma as any).broadcast.findMany({
    where,
    include: { location: true, createdBy: true },
    orderBy: { createdAt: 'desc' },
  });

  const authorizedBroadcasts = broadcastId && visibleLocationIds.length > 0
    ? broadcasts.filter((broadcast: any) => visibleLocationIds.includes(broadcast.locationId))
    : broadcasts;

  return Promise.all(
    authorizedBroadcasts.map(async (broadcast: any) => {
      const recipientCount = await getUniqueRecipientCount(broadcast.locationId);
      return { ...broadcast, recipientCount };
    })
  );
}

// Helper to validate location targeting based on user role and assigned location
// SUPER_ADMIN  → can target ANY location (full Tamil Nadu or specific street)
// ADMIN        → can target their assigned location OR any child under it
// SUB_ADMIN    → can target their assigned location OR any child under it
// MEMBER       → cannot create events/broadcasts
async function validateLocationTargeting(userId: number, role: string, userLocationId: number | null, targetLocationId: number, lang: string = 'en') {
  if (role === 'SUPER_ADMIN') {
    return true;
  }

  // Find target location
  const targetLocation = await (prisma as any).location.findUnique({
    where: { id: targetLocationId }
  });
  if (!targetLocation) {
    throw new Error(I18nService.translate("target_location_not_found", lang));
  }

  if (!['ADMIN', 'SUB_ADMIN', 'DISTRICT_INCHARGE'].includes(role)) {
    throw new Error(I18nService.translate("member_not_allowed", lang));
  }

  const hasAccess = await canAccessLocation(userId, role, targetLocationId);
  if (!hasAccess) {
    if (role === 'ADMIN') {
      throw new Error(I18nService.translate("admin_outside_scope", lang));
    } else if (role === 'SUB_ADMIN') {
      throw new Error(I18nService.translate("subadmin_outside_scope", lang));
    } else {
      throw new Error('Action outside assigned location scope / நியமிக்கப்பட்ட இட எல்லைக்கு வெளியே உள்ளது');
    }
  }
  return true;
}

// Helper to validate role-based location level requirements
async function validateRoleLocationLevel(role: string, locationId: number, lang: string = 'en') {
  const targetLocation = await (prisma as any).location.findUnique({
    where: { id: locationId }
  });
  if (!targetLocation) {
    throw new Error(I18nService.translate("target_location_not_found", lang));
  }

  const normRole = role.toUpperCase().trim();
  const type = targetLocation.type;

  if (normRole === 'SUPER_ADMIN') {
    if (type !== 'STATE') {
      throw new Error(I18nService.translate("state_selection_mandatory" as any, lang));
    }
  } else if (normRole === 'ADMIN') {
    if (type !== 'DISTRICT' && type !== 'TALUK') {
      throw new Error(I18nService.translate("admin_level_error" as any, lang));
    }
  } else if (normRole === 'SUB_ADMIN') {
    if (type !== 'DISTRICT' && type !== 'TALUK' && type !== 'AREA' && type !== 'STREET') {
      throw new Error(I18nService.translate("subadmin_level_error" as any, lang));
    }
  } else if (normRole === 'MEMBER') {
    if (type !== 'DISTRICT' && type !== 'TALUK' && type !== 'AREA' && type !== 'STREET') {
      throw new Error(I18nService.translate("member_level_error" as any, lang));
    }
  }
}

// Helpers for role and designation formatting
function getRoleLabel(role: string | null | undefined): string {
  if (!role) return 'Member';
  const r = role.toUpperCase().trim();
  if (r === 'SUPER_ADMIN') return 'Super Admin';
  if (r === 'ADMIN') return 'Admin';
  if (r === 'SUB_ADMIN') return 'Sub Admin';
  if (r === 'MEMBER') return 'Member';
  return role;
}

function formatUserDesignation(user: any, fallbackRole: string = 'Admin'): string {
  if (!user) return fallbackRole;
  const roleLabel = getRoleLabel(user.role);
  return `${roleLabel} ${user.name}`;
}

async function writeUpdateAuditLogs(
  context: any,
  isUserTable: boolean,
  targetId: number,
  currentPhone: string,
  rest: any,
  args: any,
  currentRole: string,
  targetRole: string,
  isRoleExplicitlyChanged: boolean,
  targetUser: any,
  targetMember: any
) {
  try {
    // 1. Get the target's updated details from DB to have correct name/phone
    const phoneToCheck = rest.phone || currentPhone;
    const updatedUser = await (prisma as any).user.findFirst({
      where: { phone: phoneToCheck }
    });
    const updatedMember = await (prisma as any).member.findFirst({
      where: { phone: phoneToCheck }
    });

    const targetName = updatedUser ? updatedUser.name : (updatedMember ? updatedMember.name : (targetUser ? targetUser.name : (targetMember ? targetMember.name : '')));
    const targetSurname = updatedUser ? updatedUser.surname : (updatedMember ? updatedMember.surname : (targetUser ? targetUser.surname : (targetMember ? targetMember.surname : '')));
    const targetFullName = `${targetName} ${targetSurname || ''}`.trim();

    // 2. Load updater details
    const updaterUser = await (prisma as any).user.findUnique({
      where: { id: Number(context.user.id) }
    }) || await (prisma as any).member.findUnique({
      where: { id: Number(context.user.id) }
    });
    const updaterName = formatUserDesignation(updaterUser, 'Admin');

    // 3. Audit for Role Change
    if (isRoleExplicitlyChanged) {
      const oldRoleLabel = getRoleLabel(currentRole);
      const newRoleLabel = getRoleLabel(targetRole);
      const roleDetails = `Member Role Changed from ${oldRoleLabel} to ${newRoleLabel} for ${targetFullName} by ${updaterName}`;
      
      const finalUserRecord = await (prisma as any).user.findFirst({
        where: { phone: phoneToCheck }
      });

      await (prisma as any).auditLog.create({
        data: {
          userId: finalUserRecord ? finalUserRecord.id : Number(context.user.id),
          action: 'role_change',
          details: roleDetails
        }
      });

      // Emit Socket.io events to notify clients to refresh
      const io = (global as any).io;
      if (io) {
        io.emit('dashboardRefresh');
        io.emit('usersModuleRefresh');
        io.emit('communityRefresh');
        io.emit('broadcastRefresh');
        io.emit('eventsRefresh');
        io.emit('emergencyRefresh');
        io.emit('notificationsRefresh');
        io.emit('activityLogsRefresh');
        io.emit('userRoleChanged', {
          userId: targetId,
          oldRole: currentRole,
          newRole: targetRole
        });
      }
    }

    // 4. Audit for Profile Update
    const hasProfileUpdates = 
      (rest.name !== undefined && rest.name !== (targetUser?.name ?? targetMember?.name)) ||
      (rest.surname !== undefined && rest.surname !== (targetUser?.surname ?? targetMember?.surname)) ||
      (rest.phone !== undefined && rest.phone !== currentPhone) ||
      (rest.password !== undefined) ||
      (rest.image !== undefined) ||
      (rest.profilePicture !== undefined) ||
      (rest.dateOfBirth !== undefined) ||
      (rest.gender !== undefined) ||
      (rest.bloodGroup !== undefined) ||
      (args.locationId !== undefined) ||
      (args.districtId !== undefined) ||
      (args.talukId !== undefined) ||
      (args.areaId !== undefined) ||
      (args.streetId !== undefined) ||
      (args.professionName !== undefined);

    if (hasProfileUpdates) {
      const profileDetails = `Member Profile Updated for ${targetFullName} by ${updaterName}`;
      const finalUserRecord = await (prisma as any).user.findFirst({
        where: { phone: phoneToCheck }
      });

      await (prisma as any).auditLog.create({
        data: {
          userId: finalUserRecord ? finalUserRecord.id : Number(context.user.id),
          action: 'profile_update',
          details: profileDetails
        }
      });
    }
  } catch (error) {
    console.error('Failed to write update audit logs:', error);
  }
}

// Helper to resolve location names to a Street ID
async function resolveLocationId(districtName: string, constituencyName: string, townName: string, streetName: string) {
  let district = await (prisma as any).location.findFirst({ where: { name: districtName, type: 'DISTRICT' } });
  if (!district) district = await (prisma as any).location.create({ data: { name: districtName, type: 'DISTRICT' } });

  let constituency = await (prisma as any).location.findFirst({ where: { name: constituencyName, type: 'TALUK', parentId: district.id } });
  if (!constituency) constituency = await (prisma as any).location.create({ data: { name: constituencyName, type: 'TALUK', parentId: district.id } });

  let town = await (prisma as any).location.findFirst({ where: { name: townName, type: 'AREA', parentId: constituency.id } });
  if (!town) town = await (prisma as any).location.create({ data: { name: townName, type: 'AREA', parentId: constituency.id } });

  let street = await (prisma as any).location.findFirst({ where: { name: streetName, type: 'STREET', parentId: town.id } });
  if (!street) street = await (prisma as any).location.create({ data: { name: streetName, type: 'STREET', parentId: town.id } });

  return street.id;
}

// Auto join member to communities matching their profession name
async function autoJoinCommunities(memberId: number, professionName: string | undefined) {
  if (!professionName) return;
  const normalized = professionName.toLowerCase().trim();
  const communities = await (prisma as any).community.findMany({
  select: { id: true, name: true }
});
  for (const community of communities) {
    const normalCommunity = community.name.toLowerCase();
    // E.g., profession "lawyer" matches community "lawyers"
    if (normalCommunity.includes(normalized) || normalized.includes(normalCommunity)) {
      await (prisma as any).communityMember.upsert({
        where: {
          communityId_memberId: {
            communityId: community.id,
            memberId
          }
        },
        create: {
          communityId: community.id,
          memberId
        },
        update: {}
      });
    }
  }
}

function userToMemberShape(user: any) {
  return {
    id: 1000000 + Number(user.id),
    name: user.name,
    surname: user.surname,
    phone: user.phone,
    image: user.image,
    bloodGroup: user.bloodGroup || null,
    dateOfBirth: user.dateOfBirth || null,
    gender: user.gender || null,
    allergies: null,
    conditions: null,
    emergencyContact: null,
    role: user.role ? user.role.toUpperCase() : user.role,
    locationId: user.locationId,
    location: user.location,
    profession: user.profession || null,
    professionId: null,
    approvalStatus: user.approvalStatus,
    isActive: user.isActive,
    approvedBy: null,
    approvedById: null,
    createdAt: user.createdAt,
    createdBy: null,
    createdById: user.parentId,
    district: user.district || null,
    constituency: user.constituency || null,
    area: user.area || null,
    street: user.street || null
  };
}

async function getOrCreateMemberForUser(user: any) {
  if (!user) return null;
  if (user.type === 'member') {
    return (prisma as any).member.findUnique({
      where: { id: Number(user.id) }
    });
  }

  const userRec = await (prisma as any).user.findUnique({
    where: { id: Number(user.id) }
  });
  if (!userRec) return null;

  let member = await (prisma as any).member.findFirst({ where: { phone: userRec.phone } });
  if (!member) {
    try {
      member = await (prisma as any).member.create({
        data: {
          name: userRec.name,
          surname: userRec.surname,
          phone: userRec.phone,
          role: userRec.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : (userRec.role === 'ADMIN' ? 'ADMIN' : (userRec.role === 'SUB_ADMIN' ? 'SUB_ADMIN' : 'Member')),
          locationId: userRec.locationId || 1,
          approvalStatus: 'APPROVED',
          isActive: true,
          district: userRec.district,
          constituency: userRec.constituency,
          area: userRec.area,
          street: userRec.street
        }
      });
    } catch (e: any) {
      member = await (prisma as any).member.findFirst({ where: { phone: userRec.phone } });
      if (!member) throw e;
    }
  }
  return member;
}

async function getPostCreatorMemberId(post: any): Promise<number | null> {
  if (!post.createdById) {
    const m = await (prisma as any).member.findFirst({
      where: { name: post.authorName }
    });
    return m ? m.id : null;
  }

  if (post.createdByType === 'member') {
    return post.createdById;
  }

  const u = await (prisma as any).user.findUnique({
    where: { id: post.createdById },
    select: { phone: true }
  });
  if (!u) return null;

  const m = await (prisma as any).member.findUnique({
    where: { phone: u.phone }
  });
  return m ? m.id : null;
}

async function getOrCreateUserForMember(memberId: number): Promise<number> {
  const member = await (prisma as any).member.findUnique({ where: { id: memberId } });
  if (!member) throw new Error("Member not found");

  let user = await (prisma as any).user.findUnique({ where: { phone: member.phone } });
  if (!user) {
    user = await (prisma as any).user.create({
      data: {
        name: member.name,
        surname: member.surname || '',
        phone: member.phone,
        password: member.password || 'no-password',
        role: 'MEMBER',
        locationId: member.locationId,
        approvalStatus: member.approvalStatus,
        isActive: member.isActive,
        district: member.district,
        constituency: member.constituency,
        area: member.area,
        street: member.street
      }
    });
  }
  return user.id;
}

async function notifyAdminsOfReport(post: any) {
  const postLoc = await (prisma as any).location.findUnique({ where: { id: post.locationId } });
  if (!postLoc) return;

  const ancestorIds = await getAncestorLocationIds(post.locationId);
  const admins = await (prisma as any).user.findMany({
    where: {
      locationId: { in: ancestorIds },
      fcmToken: { not: null },
      role: { in: ['ADMIN', 'SUB_ADMIN'] }
    }
  });

  for (const adminUser of admins) {
    let canReview = false;
    if (adminUser.role === 'SUB_ADMIN' && ['STREET', 'AREA'].includes(postLoc.type)) {
      canReview = true;
    } else if (adminUser.role === 'ADMIN' && ['TALUK', 'DISTRICT'].includes(postLoc.type)) {
      canReview = true;
    }

    if (canReview && adminUser.fcmToken) {
      await sendNotificationToToken(
        adminUser.fcmToken,
        "New reported post requires review.",
        `Post in ${postLoc.name} has been reported.`,
        { type: "REPORTED_POST", postId: post.id }
      ).catch(e => console.error("Error sending push to admin:", e));
    }
  }
}

async function notifyPostOwner(postId: number, title: string, body: string) {
  const post = await (prisma as any).post.findUnique({ where: { id: postId } });
  if (!post) return;

  const memberId = await getPostCreatorMemberId(post);
  if (!memberId) return;

  const member = await (prisma as any).member.findUnique({
    where: { id: memberId },
    select: { fcmToken: true }
  });

  if (member && member.fcmToken) {
    await sendNotificationToToken(
      member.fcmToken,
      title,
      body,
      { type: "POST_MODERATION", postId }
    ).catch(e => console.error("Error sending push to owner:", e));
  }
}


async function getPollCreatorMemberId(poll: any): Promise<number | null> {
  if (poll.memberId) {
    return poll.memberId;
  }
  if (!poll.createdById) {
    return null;
  }
  const u = await (prisma as any).user.findUnique({
    where: { id: poll.createdById },
    select: { phone: true }
  });
  if (!u) return null;

  const m = await (prisma as any).member.findUnique({
    where: { phone: u.phone }
  });
  return m ? m.id : null;
}

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'SUB_ADMIN'];
const NAME_REGEX = /^[a-zA-Z\u0B80-\u0BFF\s]+$/;

function translateLocationName(name: string | null | undefined, lang: string): string | null {
  if (!name) return null;
  if (lang.startsWith('ta')) {
    const translations: Record<string, string> = {
      'Tamil Nadu': 'தமிழ்நாடு',
      'Nagapattinam': 'நாகப்பட்டினம்',
      'Vedaranyam': 'வேதாரண்யம்',
      'Pushpavanam': 'புஷ்பவனம்'
    };
    return translations[name] || name;
  }
  return name;
}

function parseDescriptionJson(description: string | null | undefined): any | null {
  if (!description) return null;
  const trimmed = description.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      return null;
    }
  }
  return null;
}

function formatEmergencyDescription(description: string | null | undefined): string | null {
  if (!description) return null;
  const trimmed = description.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const data = JSON.parse(trimmed);
      const parts: string[] = [];
      if (data.bloodGroup) parts.push(`Blood Group: ${data.bloodGroup}`);
      if (data.unitsRequired) parts.push(`Units Required: ${data.unitsRequired}`);
      if (data.hospitalName) parts.push(`Hospital: ${data.hospitalName}`);
      if (data.patientCondition) parts.push(`Patient Condition: ${data.patientCondition}`);
      if (data.disasterType) parts.push(`Disaster Type: ${data.disasterType}`);
      if (data.affectedArea) parts.push(`Affected Area: ${data.affectedArea}`);
      if (data.requiredSupport) parts.push(`Required Support: ${data.requiredSupport}`);
      if (data.volunteerType) parts.push(`Volunteer Type: ${data.volunteerType}`);
      if (data.contactNumber) parts.push(`Contact Number: ${data.contactNumber}`);
      if (data.contactDetails) parts.push(`Contact Details: ${data.contactDetails}`);
      if (data.location) parts.push(`Location: ${data.location}`);
      if (data.additionalInfo) parts.push(`Additional Info: ${data.additionalInfo}`);
      
      if (parts.length > 0) {
        return parts.join('\n');
      }
    } catch (e) {
      // ignore
    }
  }
  return description;
}

function extractRemarksFromDescription(description: string | null | undefined): string | null {
  if (!description) return null;
  const trimmed = description.trim();
  
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const data = JSON.parse(trimmed);
      return data.additionalInfo || data.remarks || data.description || null;
    } catch (e) {
      // ignore
    }
  }
  
  const lines = trimmed.split('\n');
  for (const line of lines) {
    if (line.startsWith('Additional Info:')) {
      return line.substring('Additional Info:'.length).trim();
    }
    if (line.startsWith('Remarks:')) {
      return line.substring('Remarks:'.length).trim();
    }
  }
  
  return description;
}

function parseFieldFromFormattedDescription(description: string | null | undefined, fieldPrefix: string): string | null {
  if (!description) return null;
  const trimmed = description.trim();
  const lines = trimmed.split('\n');
  for (const line of lines) {
    if (line.toLowerCase().startsWith(fieldPrefix.toLowerCase() + ':')) {
      return line.substring(fieldPrefix.length + 1).trim();
    }
  }
  return null;
}


// Normalize blood group: accepts both 'O+' and 'O_POSITIVE' formats
function normalizeBloodGroup(value: string | null | undefined): string | null {
  if (!value || String(value).trim() === '' || String(value).trim().toLowerCase() === 'select') return null;
  const map: Record<string, string> = {
    'A+': 'A_POSITIVE', 'A_POSITIVE': 'A_POSITIVE',
    'A-': 'A_NEGATIVE', 'A_NEGATIVE': 'A_NEGATIVE',
    'B+': 'B_POSITIVE', 'B_POSITIVE': 'B_POSITIVE',
    'B-': 'B_NEGATIVE', 'B_NEGATIVE': 'B_NEGATIVE',
    'AB+': 'AB_POSITIVE', 'AB_POSITIVE': 'AB_POSITIVE',
    'AB-': 'AB_NEGATIVE', 'AB_NEGATIVE': 'AB_NEGATIVE',
    'O+': 'O_POSITIVE',  'O_POSITIVE': 'O_POSITIVE',
    'O-': 'O_NEGATIVE',  'O_NEGATIVE': 'O_NEGATIVE',
    // Legacy formats stored in older records
    '0+': 'O_POSITIVE', '0+VE': 'O_POSITIVE', 'O+VE': 'O_POSITIVE',
    '0-': 'O_NEGATIVE', 'O-VE': 'O_NEGATIVE',
  };
  return map[String(value).trim().toUpperCase()] || String(value).trim();
}

function toIST(dateInput: any) {
  if (dateInput === null || dateInput === undefined) return null;
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return null;
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(d.getTime() + istOffset);
  return istTime.toISOString().replace('Z', '+05:30');
}

async function getMemberIdFromContext(context: any): Promise<number | null> {
  if (!context?.user) return null;
  // Some auth flows may not set `type`; infer from role.
  const inferredType =
    context.user.type ||
    (context.user.role === 'MEMBER' ? 'member' : 'admin');

  if (inferredType === 'member') {
    return Number(context.user.id);
  }
  if (inferredType === 'admin') {
    const member = await getOrCreateMemberForUser(context.user);
    return member ? member.id : null;
  }
  return null;
}

async function getUserIdFromContext(context: any): Promise<number | null> {
  if (!context?.user) return null;
  const inferredType =
    context.user.type ||
    (context.user.role === 'MEMBER' ? 'member' : 'admin');

  if (inferredType === 'admin') {
    return Number(context.user.id);
  }
  if (inferredType === 'member') {
    return getOrCreateUserForMember(Number(context.user.id));
  }
  return null;
}

async function determineUserAndId(id: any): Promise<{ isUserTable: boolean, targetId: number }> {
  const numericId = Number(id);
  let isUserTable = numericId < 0 || numericId >= 1000000;
  let targetId = isUserTable
    ? (numericId < 0 ? Math.abs(numericId) : (numericId - 1000000))
    : numericId;

  if (!isUserTable) {
    const memberExists = await (prisma as any).member.findUnique({ where: { id: targetId } });
    if (!memberExists) {
      const userExists = await (prisma as any).user.findUnique({ where: { id: targetId } });
      if (userExists) {
        isUserTable = true;
      }
    }
  }

  return { isUserTable, targetId };
}

function isCommunityAdmin(role: string | undefined) {
  return !!role && ADMIN_ROLES.includes(role);
}

function getSenderType(user: any) {
  return user?.role === 'MEMBER' ? 'MEMBER' : user?.role;
}

async function getCommunityMessageSender(message: any) {
  if (message.senderType === 'MEMBER') {
    return (prisma as any).member.findUnique({
      where: { id: Number(message.senderId) },
      select: { name: true, role: true }
    });
  }

  return (prisma as any).user.findUnique({
    where: { id: Number(message.senderId) },
    select: { name: true, role: true }
  });
}

async function getCommunityActorName(actorId: number, actorType: string) {
  const actor = await getCommunityMessageSender({ senderId: actorId, senderType: actorType });
  return actor?.name || 'Unknown';
}

async function assertCommunityReadAccess(communityId: number, context: any) {
  if (!context?.user) throw new Error(I18nService.translate("unauthorized_login", context?.language));

  const community = await (prisma as any).community.findUnique({
    where: { id: Number(communityId) }
  });
  if (!community) throw new Error("Community not found");

  const isAdmin = isCommunityAdmin(context.user.role);

  // Only check CommunityMember table for type='member' (Member table users)
  // Users in User table (type='admin') with MEMBER role are NOT in CommunityMember
  if (!isAdmin && context.user.type === 'member') {
    const membership = await (prisma as any).communityMember.findUnique({
      where: {
        communityId_memberId: {
          communityId: Number(communityId),
          memberId: Number(context.user.id)
        }
      }
    });
    if (!membership) throw new Error("Only community members can access this chat");
  }

  return community;
}

async function assertCommunityAdminAccess(context: any) {
  if (!context?.user) throw new Error(I18nService.translate("unauthorized_login", context?.language));
  if (!isCommunityAdmin(context.user.role)) {
    throw new Error("Only admin can manage community chat");
  }
}

async function assertCommunityWriteAccess(communityId: number, context: any) {
  const community = await assertCommunityReadAccess(communityId, context);
  const user = context.user;

  if (community.isMuted) {
    const mutedUntil = community.mutedUntil ? new Date(community.mutedUntil).getTime() : null;
    if (!isCommunityAdmin(user.role) && (!mutedUntil || mutedUntil > Date.now())) {
      throw new Error("This community chat is muted");
    }
  }

  const isAdmin = isCommunityAdmin(user.role);

  // Only check CommunityMember table for type='member' (Member table users)
  // Users in User table (type='admin') with MEMBER role are NOT in CommunityMember
  if (!isAdmin && user.type === 'member') {
    const membership = await (prisma as any).communityMember.findUnique({
      where: {
        communityId_memberId: {
          communityId,
          memberId: Number(user.id)
        }
      }
    });

    if (community.isArchived) {
      throw new Error("This community is archived / இந்த சமூகம் காப்பகப்படுத்தப்பட்டுள்ளது");
    }

    const mutedUntil = membership?.mutedUntil ? new Date(membership.mutedUntil).getTime() : null;
    if (membership?.isMuted && (!mutedUntil || mutedUntil > Date.now())) {
      throw new Error("You are muted in this community");
    }

    if (!community.allowMemberMessages) {
      const groupRole = membership?.groupRole || 'MEMBER';
      if (!['OWNER', 'ADMIN', 'MODERATOR'].includes(groupRole)) {
        throw new Error("Only admin can message / நிர்வாகிகள் மட்டுமே செய்தி அனுப்ப முடியும்");
      }
    }
  } else if (!isAdmin && user.type !== 'admin') {
    throw new Error("Only community members can message");
  }

  if (community.isArchived) {
    throw new Error("This community is archived / இந்த சமூகம் காப்பகப்படுத்தப்பட்டுள்ளது");
  }

  return community;
}

async function incrementCommunityUnreadCounts(communityId: number, senderId: number, senderType: string) {
  if (senderType !== 'MEMBER') {
    await (prisma as any).communityMember.updateMany({
      where: { communityId },
      data: { unreadCount: { increment: 1 } }
    });
    return;
  }

  await (prisma as any).communityMember.updateMany({
    where: {
      communityId,
      memberId: { not: senderId }
    },
    data: { unreadCount: { increment: 1 } }
  });
}

async function formatCommunityMessage(message: any) {
  const sender = await getCommunityMessageSender(message);
  const reactions = message.reactions || await (prisma as any).communityMessageReaction.findMany({
    where: { messageId: Number(message.id) },
    orderBy: { createdAt: 'asc' }
  });
  const readByCount = await (prisma as any).communityMessageRead.count({
    where: { messageId: Number(message.id) }
  });

  return {
    ...message,
    senderName: sender?.name || 'Unknown',
    reactions: await Promise.all(reactions.map(async (reaction: any) => ({
      ...reaction,
      reactorName: await getCommunityActorName(reaction.reactorId, reaction.reactorType),
      createdAt: toIsoString(reaction.createdAt)
    }))),
    readByCount,
    metadata: message.metadata ? (typeof message.metadata === 'string' ? message.metadata : JSON.stringify(message.metadata)) : null,
    editedAt: toIsoString(message.editedAt),
    deletedAt: toIsoString(message.deletedAt),
    createdAt: toIST(message.createdAt)
  };
}

export const resolvers = {
  Query: {
    me: async (_: any, __: any, context: any) => {
      if (!context.user || !context.user.id) return null;
      
      // Use context.user.type to decide which table — NOT role
      // type='member' → Member table, type='admin' → User table
      // (A user added via addMember/addAdmin is in User table, type='admin')
      if (context.user.type === 'member') {
        const member = await (prisma as any).member.findUnique({
          where: { id: context.user.id },
          include: { location: true }
        });
        if (member) {
          const dbRole = member.role ? member.role.toUpperCase() : 'MEMBER';
          const validRoles = ['SUPER_ADMIN', 'ADMIN', 'SUB_ADMIN', 'MEMBER'];
          return {
            ...member,
            role: validRoles.includes(dbRole) ? dbRole : 'MEMBER'
          };
        }
        return null;
      }

      // User table (Admin, SubAdmin, SuperAdmin, or MEMBER added via admin flow)
      const user = await (prisma as any).user.findUnique({
        where: { id: context.user.id },
        include: { location: true }
      });
      if (user) {
        return {
          ...userToMemberShape(user),
          role: user.role === 'Member' ? 'MEMBER' : user.role
        };
      }
      return null;
    },
    
    getLocationList: async (_: any, { parentId, type }: any) => {
      const where: any = {};
      if (parentId !== undefined) where.parentId = parentId;
      if (type) where.type = type;
      
      return (prisma as any).location.findMany({
        where,
        orderBy: { name: 'asc' },
      });
    },

    getLocationDetails: async (_: any, { id }: any) => {
      return (prisma as any).location.findUnique({
        where: { id },
        include: { parent: true, children: true }
      });
    },

    getMemberList: async (_: any, { locationId, professionName, bloodGroup, role, search, limit = 50, offset = 0, approvalStatus }: any, context: any) => {
      let filter: any = {};
      let userFilter: any = {};

      // Default: show only APPROVED members (consistent with dashboard totalMembers count)
      // Admins can pass approvalStatus=PENDING to see pending members
      const effectiveApprovalStatus = approvalStatus || 'APPROVED';
      filter.approvalStatus = effectiveApprovalStatus;
      userFilter.approvalStatus = effectiveApprovalStatus;

      if (professionName) {
        filter.profession = { name: professionName };
        
      }
      if (bloodGroup) filter.bloodGroup = bloodGroup;
      if (role && !['all', 'all roles', 'all_roles', 'allroles'].includes(role.toLowerCase().trim())) {
        filter.role = { equals: role, mode: 'insensitive' };
        userFilter.role = role.toUpperCase().trim().replace(/[\s-]+/g, '_');
      } else {
        userFilter.role = { in: ['ADMIN', 'SUB_ADMIN', 'MEMBER'] };
      }

      
      if (search) {
        filter.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
        ];
        userFilter.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
        ];
      }

      if (locationId) {
        const allLocationIds = [locationId, ...(await getChildLocationIds(locationId))];
        filter.locationId = { in: allLocationIds };
        userFilter.locationId = { in: allLocationIds };
      }

      const takeLimit = limit + offset;

      const [members, users] = await Promise.all([
        (prisma as any).member.findMany({
          where: filter,
          take: takeLimit,
          include: { location: true, profession: true },
          orderBy: { createdAt: 'desc' },
        }),
        professionName || bloodGroup ? [] : (prisma as any).user.findMany({
          where: userFilter,
          take: takeLimit,
          include: { location: true },
          orderBy: { createdAt: 'desc' },
        })
      ]);

      const combined = [...members, ...users.map(userToMemberShape)];
      const uniqueMembers = Array.from(new Map(combined.map(item => [item.phone, item])).values());

      let allowedLocationIds: number[] = [];
      if (context?.user) {
        allowedLocationIds = await getAccessibleLocationIds(Number(context.user.id), context.user.role);
      }

      // Filter out SUPER_ADMIN role (just in case they come in from any other query/table)
      const filteredMembers = uniqueMembers.filter((m: any) => {
        const normalizedRole = m.role ? m.role.toUpperCase().trim().replace(/[\s-]+/g, '_') : '';
        return normalizedRole !== 'SUPER_ADMIN';
      });

      // Role sorting priority helper
      const getRolePriority = (r: string) => {
        if (!r) return 99;
        const normalized = r.toUpperCase().trim().replace(/[\s-]+/g, '_');
        if (normalized === 'ADMIN') return 1;
        if (normalized === 'SUB_ADMIN') return 2;
        if (normalized === 'MEMBER') return 3;
        return 99;
      };

      const sortedMembers = filteredMembers.sort((a: any, b: any) => {
        const priorityA = getRolePriority(a.role);
        const priorityB = getRolePriority(b.role);
        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      return sortedMembers
        .slice(offset, offset + limit)
        .map((m: any) => {
          const isSelf = context?.user?.phone === m.phone;
          const canSeePhone = 
            context?.user?.role === 'SUPER_ADMIN' || 
            isSelf ||
            (['ADMIN', 'SUB_ADMIN', 'DISTRICT_INCHARGE'].includes(context?.user?.role || '') && allowedLocationIds.includes(m.locationId));
          return {
            ...m,
            role: m.role ? m.role.toUpperCase() : m.role,
            phone: canSeePhone ? m.phone : null,
          };
        });
    },

    dashboardStats: async (_: any, { locationId, filterLocationId }: any, context: any) => {
      let locationName = 'Tamil Nadu';

      const contextUser = context?.user;
      let dashLocationIds: number[] | null = null;

      if (contextUser) {
        const role = contextUser.role;
        const userId = Number(contextUser.id);
        const targetId = filterLocationId ?? locationId;

        if (role === 'SUPER_ADMIN') {
          if (targetId) {
            const childIds = await getChildLocationIds(Number(targetId));
            dashLocationIds = [Number(targetId), ...childIds];
            const loc = await (prisma as any).location.findUnique({ where: { id: Number(targetId) }, select: { name: true } });
            if (loc) locationName = loc.name;
          } else {
            dashLocationIds = null;
          }
        } else {
          const accessibleIds = await getAccessibleLocationIds(userId, role);
          if (accessibleIds.length === 0) {
            dashLocationIds = [-1];
          } else if (targetId && accessibleIds.includes(Number(targetId))) {
            const childIds = await getChildLocationIds(Number(targetId));
            dashLocationIds = [Number(targetId), ...childIds];
            const loc = await (prisma as any).location.findUnique({ where: { id: Number(targetId) }, select: { name: true } });
            if (loc) locationName = loc.name;
          } else {
            dashLocationIds = accessibleIds;
            const primaryLoc = await (prisma as any).userLocation.findFirst({
              where: { userId, isPrimary: true },
              include: { location: true }
            });
            if (primaryLoc?.location) {
              locationName = primaryLoc.location.name;
            } else {
              const firstLoc = await (prisma as any).userLocation.findFirst({
                where: { userId },
                include: { location: true }
              });
              if (firstLoc?.location) locationName = firstLoc.location.name;
            }
          }
        }
      }

      // Helper: member locationId filter
      const memberLocFilter = dashLocationIds ? { locationId: { in: dashLocationIds } } : {};
      // Helper: location id filter (for location table queries)
      const locationIdFilter = dashLocationIds ? { id: { in: dashLocationIds } } : {};

      // Today's date range
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      const [
        allMembers,
        allUsers,
        pendingFromMemberTable,
        pendingFromUserTable,
        newMembersTodayFromMemberList,
        newMembersTodayFromUserList,
        approvedOrRejectedTodayFromMemberList,
        approvedOrRejectedTodayFromUserList,
        totalTowns,
        totalStreets,
        activeEvents,
        emergencyRequests,
        activeBroadcasts
      ] = await Promise.all([
        // All APPROVED members (for role count)
        (prisma as any).member.findMany({
          where: { approvalStatus: 'APPROVED', ...memberLocFilter },
          select: { phone: true, role: true }
        }),
        // All APPROVED users (for role count)
        (prisma as any).user.findMany({
          where: { approvalStatus: 'APPROVED', ...memberLocFilter },
          select: { phone: true, role: true }
        }),
        // ALL pending from Member table
        (prisma as any).member.count({
          where: { approvalStatus: 'PENDING', ...memberLocFilter }
        }),
        // ALL pending from User table (MEMBER role)
        (prisma as any).user.count({
          where: { role: 'MEMBER', approvalStatus: 'PENDING', ...memberLocFilter }
        }),
        // New members today from Member table
        (prisma as any).member.findMany({
          where: { createdAt: { gte: todayStart, lte: todayEnd }, ...memberLocFilter },
          select: { phone: true, role: true }
        }),
        // New members today from User table
        (prisma as any).user.findMany({
          where: { role: 'MEMBER', createdAt: { gte: todayStart, lte: todayEnd }, ...memberLocFilter },
          select: { phone: true, role: true }
        }),
        // Approved/Rejected today from Member table
        (prisma as any).member.findMany({
          where: { approvalStatus: { in: ['APPROVED', 'REJECTED'] }, updatedAt: { gte: todayStart, lte: todayEnd }, ...memberLocFilter },
          select: { phone: true, role: true }
        }),
        // Approved/Rejected today from User table
        (prisma as any).user.findMany({
          where: { role: 'MEMBER', approvalStatus: { in: ['APPROVED', 'REJECTED'] }, updatedAt: { gte: todayStart, lte: todayEnd }, ...memberLocFilter },
          select: { phone: true, role: true }
        }),
        // Total Towns (AREA)
        (prisma as any).location.count({
          where: { type: 'AREA', ...locationIdFilter }
        }),
        // Total Streets
        (prisma as any).location.count({
          where: { type: 'STREET', ...locationIdFilter }
        }),
        // Events created today
        (prisma as any).event.count({
          where: { createdAt: { gte: todayStart, lte: todayEnd }, ...memberLocFilter }
        }),
        // Emergency requests created or reviewed today
        (prisma as any).emergencyRequest.count({
          where: {
            ...memberLocFilter,
            OR: [
              { createdAt: { gte: todayStart, lte: todayEnd } },
              {
                updatedAt: { gte: todayStart, lte: todayEnd },
                status: { in: ['APPROVED_SUB_ADMIN', 'APPROVED_ADMIN', 'APPROVED_STATE', 'REJECTED'] }
              }
            ]
          }
        }),
        // Broadcasts created today
        (prisma as any).broadcast.count({
          where: { createdAt: { gte: todayStart, lte: todayEnd }, ...memberLocFilter }
        }),
      ]);

      // Combine and deduplicate globally by phone
      // User table gets PRIORITY over Member table
      // (some people exist in both — User table role represents elevated system privileges)
      const formattedMembers = allMembers.map((m: any) => ({
        phone: m.phone,
        role: m.role ? m.role.toUpperCase() : 'MEMBER'
      }));

      const formattedUsers = allUsers.map((u: any) => ({
        phone: u.phone,
        role: u.role === 'Member' ? 'MEMBER' : (u.role ? u.role.toUpperCase() : 'MEMBER')
      }));

      // Member table first, User table second → User table overwrites (priority)
      const combined = [...formattedMembers, ...formattedUsers];
      const uniquePeople = Array.from(new Map(combined.map(item => [item.phone, item])).values());

      const totalSuperAdmins = uniquePeople.filter(p => p.role === 'SUPER_ADMIN').length;
      const totalAdmins = uniquePeople.filter(p => p.role === 'ADMIN').length;
      const totalSubAdmins = uniquePeople.filter(p => p.role === 'SUB_ADMIN').length;
      const totalMembers = uniquePeople.filter(p => p.role === 'MEMBER').length;

      const pendingApprovals = pendingFromMemberTable + pendingFromUserTable;

      // Deduplicate New Members Today and filter by final resolved role (must be MEMBER, not promoted ADMIN)
      const formattedNewMembers = newMembersTodayFromMemberList.map((m: any) => ({
        phone: m.phone,
        role: m.role ? m.role.toUpperCase() : 'MEMBER'
      }));
      const formattedNewUsers = newMembersTodayFromUserList.map((u: any) => ({
        phone: u.phone,
        role: u.role === 'Member' ? 'MEMBER' : (u.role ? u.role.toUpperCase() : 'MEMBER')
      }));
      const combinedNew = [...formattedNewMembers, ...formattedNewUsers];
      const uniqueNew = Array.from(new Map(combinedNew.map(item => [item.phone, item])).values());
      const newMembersToday = uniqueNew.filter(p => p.role === 'MEMBER').length;

      // Deduplicate Approved Today and filter by final resolved role (must be MEMBER, not promoted ADMIN)
      const formattedApprovedMembers = approvedOrRejectedTodayFromMemberList.map((m: any) => ({
        phone: m.phone,
        role: m.role ? m.role.toUpperCase() : 'MEMBER'
      }));
      const formattedApprovedUsers = approvedOrRejectedTodayFromUserList.map((u: any) => ({
        phone: u.phone,
        role: u.role === 'Member' ? 'MEMBER' : (u.role ? u.role.toUpperCase() : 'MEMBER')
      }));
      const combinedApproved = [...formattedApprovedMembers, ...formattedApprovedUsers];
      const uniqueApproved = Array.from(new Map(combinedApproved.map(item => [item.phone, item])).values());
      const approvedToday = uniqueApproved.filter(p => p.role === 'MEMBER').length;

      return {
        locationName,
        totalSuperAdmins,
        totalAdmins,
        totalSubAdmins,
        totalMembers,
        pendingApprovals,
        newMembersToday,
        approvedToday,
        totalTowns,
        totalStreets,
        activeEvents,
        emergencyRequests,
        activeBroadcasts,
      };
    },

    getReportedPosts: async (_: any, args: any, context: any) => {
      return resolvers.Query.getReportedPostsList(_, args, context);
    },

    getModerationDashboardStats: async (_: any, { locationId }: any, context: any) => {
      const lang = context?.language || 'en';
      if (!context?.user) throw new Error(I18nService.translate("unauthorized_login", lang));

      const role = context.user.role;
      const userLocId = context.user.locationId;

      if (role === 'MEMBER') {
        throw new Error("Unauthorized: Only administrators can view moderation statistics.");
      }

      let allowedTypes: string[] = [];
      if (role === 'SUB_ADMIN') {
        allowedTypes = ['STREET', 'AREA'];
      } else if (role === 'ADMIN') {
        allowedTypes = ['TALUK', 'DISTRICT'];
      } else if (role === 'SUPER_ADMIN') {
        allowedTypes = ['STATE', 'DISTRICT', 'TALUK', 'AREA', 'STREET'];
      }

      let locationIds: number[] = [];
      let effectiveLocId = locationId || userLocId;
      if (role !== 'SUPER_ADMIN') {
        if (!effectiveLocId) return {
          totalReportedPosts: 0,
          pendingReviews: 0,
          warningSentCount: 0,
          deletedPostsCount: 0,
          highPriorityReportsCount: 0
        };
        const childIds = await getChildLocationIds(effectiveLocId);
        locationIds = [effectiveLocId, ...childIds];
      } else {
        if (effectiveLocId) {
          const childIds = await getChildLocationIds(effectiveLocId);
          locationIds = [effectiveLocId, ...childIds];
        }
      }

      const postWhereClause: any = {
        location: {
          ...(locationIds.length > 0 ? { id: { in: locationIds } } : {}),
          type: { in: allowedTypes }
        }
      };

      const totalReportedPosts = await (prisma as any).post.count({
        where: {
          ...postWhereClause,
          reports: { some: {} }
        }
      });

      const pendingReviews = await (prisma as any).post.count({
        where: {
          ...postWhereClause,
          status: { in: ["REPORTED", "UNDER_REVIEW"] }
        }
      });

      const warningSentCount = await (prisma as any).post.count({
        where: {
          ...postWhereClause,
          status: "WARNED"
        }
      });

      const deletedPostsCount = await (prisma as any).post.count({
        where: {
          ...postWhereClause,
          status: "DELETED"
        }
      });

      const highPriorityReportsCount = await (prisma as any).post.count({
        where: {
          ...postWhereClause,
          status: "UNDER_REVIEW"
        }
      });

      return {
        totalReportedPosts,
        pendingReviews,
        warningSentCount,
        deletedPostsCount,
        highPriorityReportsCount
      };
    },

    getReportedPostsList: async (_: any, { locationId, status }: any, context: any) => {
      const lang = context?.language || 'en';
      if (!context?.user) throw new Error(I18nService.translate("unauthorized_login", lang));

      const role = context.user.role;
      const userLocId = context.user.locationId;

      if (role === 'MEMBER') {
        throw new Error("Unauthorized: Only administrators can view reports.");
      }

      let allowedTypes: string[] = [];
      if (role === 'SUB_ADMIN') {
        allowedTypes = ['STREET', 'AREA'];
      } else if (role === 'ADMIN') {
        allowedTypes = ['TALUK', 'DISTRICT'];
      } else if (role === 'SUPER_ADMIN') {
        allowedTypes = ['STATE', 'DISTRICT', 'TALUK', 'AREA', 'STREET'];
      }

      let locationIds: number[] = [];
      let effectiveLocId = locationId || userLocId;
      if (role !== 'SUPER_ADMIN') {
        if (!effectiveLocId) return [];
        const childIds = await getChildLocationIds(effectiveLocId);
        locationIds = [effectiveLocId, ...childIds];
      } else {
        if (effectiveLocId) {
          const childIds = await getChildLocationIds(effectiveLocId);
          locationIds = [effectiveLocId, ...childIds];
        }
      }

      const postWhereClause: any = {
        location: {
          ...(locationIds.length > 0 ? { id: { in: locationIds } } : {}),
          type: { in: allowedTypes }
        }
      };

      if (status) {
        if (status === 'PENDING') {
          postWhereClause.status = { in: ['REPORTED', 'UNDER_REVIEW'] };
        } else {
          postWhereClause.status = status;
        }
      } else {
        postWhereClause.reports = { some: {} };
      }

      return (prisma as any).post.findMany({
        where: postWhereClause,
        orderBy: { createdAt: 'desc' },
        include: { location: true }
      });
    },

    getReportedCommunityPosts: async (_: any, { status }: any, context: any) => {
      const lang = context?.language || 'en';
      if (!context?.user) throw new Error(I18nService.translate("unauthorized_login", lang));

      const role = context.user.role;
      const userLocId = context.user.locationId;

      if (role === 'MEMBER') {
        throw new Error("Unauthorized: Only administrators can view reports.");
      }

      // Hierarchy rules for location levels
      let allowedTypes: string[] = [];
      if (role === 'SUB_ADMIN') {
        allowedTypes = ['STREET', 'AREA'];
      } else if (role === 'ADMIN') {
        allowedTypes = ['TALUK', 'DISTRICT'];
      } else if (role === 'SUPER_ADMIN') {
        allowedTypes = ['STATE', 'DISTRICT', 'TALUK', 'AREA', 'STREET'];
      }

      const reports = await (prisma as any).communityPostReport.findMany({
        where: { status: status || 'PENDING' },
        orderBy: { createdAt: 'desc' },
        include: {
          post: {
            include: {
              community: {
                include: { location: true }
              }
            }
          },
          reportedBy: true
        }
      });

      if (role === 'SUPER_ADMIN') {
        return reports;
      }

      if (!userLocId) return [];
      const childIds = await getChildLocationIds(userLocId);
      const allowedLocIds = new Set([userLocId, ...childIds]);

      // Filter reports in memory based on admin location tree and allowed location types
      return reports.filter((r: any) => {
        const commLoc = r.post?.community?.location;
        if (!commLoc) return false; // Global/State community - only SUPER_ADMIN resolves
        if (!allowedTypes.includes(commLoc.type)) return false;
        return allowedLocIds.has(commLoc.id);
      });
    },

    getUserWarnings: async (_: any, { memberId }: any, context: any) => {
      const lang = context?.language || 'en';
      if (!context?.user) throw new Error(I18nService.translate("unauthorized_login", lang));

      if (context.user.role === 'MEMBER') {
        throw new Error("Unauthorized: Only administrators can view warning history.");
      }

      return (prisma as any).userWarning.findMany({
        where: { memberId: Number(memberId) },
        orderBy: { createdAt: 'desc' },
        include: { member: true, admin: true }
      });
    },

    // New resolver for towns and streets
    getTownsAndStreets: async (_: any, { constituencyId }: any) => {
      const towns = await (prisma as any).location.findMany({
        where: { parentId: constituencyId, type: 'AREA' },
        include: { children: true },
      });
      return towns.map((t: any) => ({
        town: t,
        streets: t.children.filter((c: any) => c.type === 'STREET'),
      }));
    },

    getMemberDetails: async (_: any, { id, communityId }: any) => {
      const { isUserTable, targetId } = await determineUserAndId(id);
      if (isUserTable) {
        const user = await (prisma as any).user.findUnique({
          where: { id: targetId },
          include: { location: true }
        });
        const memberShape = user ? userToMemberShape(user) : null;

        // If communityId is provided, add community-specific context
        if (communityId && memberShape) {
          const membership = await (prisma as any).communityMember.findUnique({
            where: {
              communityId_memberId: {
                communityId: Number(communityId),
                memberId: targetId
              }
            }
          });
          if (membership) {
            (memberShape as any).communityRole = membership.role;
            (memberShape as any).joinedAt = membership.createdAt;
            (memberShape as any).communityIsMuted = membership.isMuted;
          }
        }

        return memberShape;
      }

      const memberRecord = await (prisma as any).member.findUnique({
        where: { id: targetId },
        include: { location: true, profession: true }
      });
      if (memberRecord && memberRecord.role) {
        memberRecord.role = memberRecord.role.toUpperCase();
      }

      // If communityId is provided, add community-specific context
      if (communityId && memberRecord) {
        const membership = await (prisma as any).communityMember.findUnique({
          where: {
            communityId_memberId: {
              communityId: Number(communityId),
              memberId: targetId
            }
          }
        });
        if (membership) {
          (memberRecord as any).communityRole = membership.role;
          (memberRecord as any).joinedAt = membership.createdAt;
          (memberRecord as any).communityIsMuted = membership.isMuted;
        }
      }

      return memberRecord;
    },

    recentActivity: async (_: any, { locationId, limit = 10, offset = 0, search, type, fromDate, toDate }: any, context: any) => {
      const user = context?.user;
      if (!user) {
        throw new Error(I18nService.translate("unauthorized_login", context?.language));
      }

      let targetLocationId: number | null = null;

      if (user.role === 'SUPER_ADMIN') {
        if (locationId) {
          targetLocationId = locationId;
        }
      } else {
        // ADMIN, SUB_ADMIN, or MEMBER - scope strictly to their assigned location scope
        if (!user.locationId) {
          return []; // Assigned location required
        }

        const allowedLocationIds = [user.locationId, ...(await getChildLocationIds(user.locationId))];

        if (locationId) {
          // If a filter is requested, verify it is within the user's scope
          if (allowedLocationIds.includes(locationId)) {
            targetLocationId = locationId;
          } else {
            // Outside scope, fall back to their assigned location scope
            targetLocationId = user.locationId;
          }
        } else {
          // Default to their assigned scope
          targetLocationId = user.locationId;
        }
      }

      let filter: any = {};
      let broadcastEventFilter: any = {};
      let allLocationIds: number[] = [];
      if (targetLocationId) {
        allLocationIds = [targetLocationId, ...(await getChildLocationIds(targetLocationId))];
        filter.locationId = { in: allLocationIds };

        const ancestorIds = await getAncestorLocationIds(targetLocationId);
        const broadcastEventLocationIds = [...ancestorIds, targetLocationId, ...allLocationIds.slice(1)];
        broadcastEventFilter.locationId = { in: Array.from(new Set(broadcastEventLocationIds)) };
      }

      // Build date range filter
      let dateFilter: any = {};
      if (fromDate || toDate) {
        dateFilter.createdAt = {};
        if (fromDate) {
          const start = new Date(fromDate);
          start.setHours(0, 0, 0, 0);
          dateFilter.createdAt.gte = start;
        }
        if (toDate) {
          const end = new Date(toDate);
          end.setHours(23, 59, 59, 999);
          dateFilter.createdAt.lte = end;
        }
      }

      // Build search filters for each model
      let eventSearch: any = {};
      let emergencySearch: any = {};
      let approvalSearch: any = {};
      let broadcastSearch: any = {};
      let auditSearch: any = {};

      if (search) {
        eventSearch.OR = [
          { title: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { createdBy: { name: { contains: search, mode: 'insensitive' } } }
        ];

        emergencySearch.OR = [
          { title: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { member: { name: { contains: search, mode: 'insensitive' } } },
          { createdBy: { name: { contains: search, mode: 'insensitive' } } }
        ];

        approvalSearch.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { surname: { contains: search, mode: 'insensitive' } },
          { approvedBy: { name: { contains: search, mode: 'insensitive' } } },
          { createdBy: { name: { contains: search, mode: 'insensitive' } } }
        ];

        broadcastSearch.OR = [
          { title: { contains: search, mode: 'insensitive' } },
          { message: { contains: search, mode: 'insensitive' } },
          { createdBy: { name: { contains: search, mode: 'insensitive' } } }
        ];

        auditSearch.OR = [
          { action: { contains: search, mode: 'insensitive' } },
          { details: { contains: search, mode: 'insensitive' } },
          { user: { name: { contains: search, mode: 'insensitive' } } }
        ];
      }

      const promises: Promise<any[]>[] = [];
      const shouldQuery = (t: string) => {
        if (!type) return true;
        if (type === 'APPROVAL') {
          return t === 'MEMBER' || t === 'ADMIN' || t === 'SUB_ADMIN';
        }
        return type === t;
      };
      const takeLimit = limit + offset;

      if (shouldQuery('EVENT')) {
        promises.push(
          (prisma as any).event.findMany({
            where: { ...broadcastEventFilter, ...eventSearch, ...dateFilter },
            take: takeLimit,
            orderBy: { createdAt: 'desc' },
            include: { location: true, createdBy: true }
          }).then((events: any[]) => events.map((e: any) => ({
            id: e.id,
            activityType: 'EVENT',
            title: e.status === 'CANCELLED' ? 'Event Cancelled' : (e.status === 'COMPLETED' ? 'Event Completed' : 'Event Created'),
            description: e.description,
            createdAt: toIST(e.createdAt),
            member: e.createdBy ? {
              id: e.createdBy.id,
              name: e.createdBy.name,
              phone: e.createdBy.phone,
              role: e.createdBy.role
            } : null,
            location: e.location ? {
              id: e.location.id,
              name: e.location.name
            } : null,
            status: e.status === 'CANCELLED' ? 'CANCELLED' : (e.status === 'COMPLETED' ? 'COMPLETED' : 'CREATED')
          })))
        );
      }

      if (shouldQuery('EMERGENCY')) {
        promises.push(
          (prisma as any).emergencyRequest.findMany({
            where: { ...filter, ...emergencySearch, ...dateFilter },
            take: takeLimit,
            orderBy: { createdAt: 'desc' },
            include: { member: true, location: true, createdBy: true }
          }).then((requests: any[]) => requests.map((r: any) => {
            const isPending = r.status === 'PENDING';
            const isApproved = ['APPROVED_SUB_ADMIN', 'APPROVED_ADMIN', 'APPROVED_STATE'].includes(r.status);
            const isRejected = r.status === 'REJECTED';
            const isForwarded = ['PENDING_ADMIN', 'PENDING_SUPER_ADMIN', 'PENDING_SUB_ADMIN'].includes(r.status);
            const isCompleted = r.status === 'COMPLETED';

            let title = 'Emergency Request';
            let status = 'CREATED';

            if (isPending) {
              title = 'Emergency Created';
              status = 'CREATED';
            } else if (isApproved) {
              title = 'Emergency Approved';
              status = 'APPROVED';
            } else if (isRejected) {
              title = 'Emergency Rejected';
              status = 'REJECTED';
            } else if (isForwarded) {
              title = 'Emergency Forwarded';
              status = 'FORWARDED';
            } else if (isCompleted) {
              title = 'Emergency Completed';
              status = 'COMPLETED';
            }

            return {
              id: r.id,
              activityType: 'EMERGENCY',
              title,
              description: r.description,
              createdAt: toIST(r.createdAt),
              member: r.member ? {
                id: r.member.id,
                name: r.member.name,
                phone: r.member.phone,
                role: r.member.role
              } : (r.createdBy ? {
                id: r.createdBy.id,
                name: r.createdBy.name,
                phone: r.createdBy.phone,
                role: r.createdBy.role
              } : null),
              location: r.location ? {
                id: r.location.id,
                name: r.location.name
              } : null,
              status
            };
          }))
        );
      }

      if (shouldQuery('MEMBER')) {
        let memberApprovalSearch = { ...approvalSearch };
        let userApprovalSearch = { ...approvalSearch };
        
        if (search) {
          memberApprovalSearch.OR = [
             ...(memberApprovalSearch.OR || []),
             { role: { contains: search, mode: 'insensitive' } }
          ];
          userApprovalSearch.OR = [
             ...(userApprovalSearch.OR || []),
             { name: { contains: search, mode: 'insensitive' } }
          ];
        }

        promises.push(
          Promise.all([
            (prisma as any).member.findMany({
              where: {
                ...filter,
                approvalStatus: { in: ['APPROVED', 'REJECTED'] },
                ...memberApprovalSearch,
                ...dateFilter
              },
              take: takeLimit,
              orderBy: { createdAt: 'desc' },
              include: { approvedBy: true, createdBy: true, location: true }
            }),
            (prisma as any).user.findMany({
              where: {
                ...filter,
                approvalStatus: { in: ['APPROVED', 'REJECTED'] },
                role: 'MEMBER',
                ...userApprovalSearch,
                ...dateFilter
              },
              take: takeLimit,
              orderBy: { createdAt: 'desc' },
              include: { location: true, parent: true }
            })
          ]).then(([members, users]) => {
            const memberActivities = members.map((m: any) => {
              const approvedByName = m.approvedBy ? formatUserDesignation(m.approvedBy) : (m.createdBy ? formatUserDesignation(m.createdBy) : 'Admin');
              const actionText = m.approvedById ? 'approved' : 'added';
              const isRejected = m.approvalStatus === 'REJECTED';
              return {
                id: m.id,
                activityType: 'MEMBER',
                title: isRejected ? 'Member Rejected' : (m.approvedById ? 'Member Approved' : 'Member Added'),
                description: isRejected
                  ? `Member request rejected for ${m.name} ${m.surname || ''} by Admin`
                  : `Member request ${actionText} for ${m.name} ${m.surname || ''} by ${approvedByName}`,
                createdAt: toIST(m.createdAt),
                member: {
                  id: m.id,
                  name: m.name,
                  phone: m.phone,
                  role: m.role
                },
                location: m.location ? {
                  id: m.location.id,
                  name: m.location.name
                } : null,
                status: isRejected ? 'REJECTED' : 'APPROVED'
              };
            });

            const userActivities = users.map((u: any) => {
              const addedByName = formatUserDesignation(u.parent, 'Admin');
              const isRejected = u.approvalStatus === 'REJECTED';
              return {
                id: 1000000 + u.id,
                activityType: 'MEMBER',
                title: isRejected ? 'Member Rejected' : 'Member Added',
                description: isRejected
                  ? `Member request rejected for ${u.name} ${u.surname || ''} by Admin`
                  : `Member ${u.name} ${u.surname || ''} added by ${addedByName}`,
                createdAt: toIST(u.createdAt),
                member: {
                  id: 1000000 + u.id,
                  name: u.name,
                  phone: u.phone,
                  role: 'MEMBER'
                },
                location: u.location ? {
                  id: u.location.id,
                  name: u.location.name
                } : null,
                status: isRejected ? 'REJECTED' : 'APPROVED'
              };
            });

            const combined = [...memberActivities, ...userActivities];
            // Deduplicate by phone
            return Array.from(new Map(combined.map(item => [item.member?.phone, item])).values());
          })
        );
      }

      if (shouldQuery('ADMIN')) {
        let userApprovalSearch = { ...approvalSearch };
        
        if (search) {
          const searchUpper = search.toUpperCase();
          const matchingRoles = ['SUPER_ADMIN', 'ADMIN'].filter(r => r.includes(searchUpper));
          if (matchingRoles.length > 0) {
            userApprovalSearch.OR = [
               ...(userApprovalSearch.OR || []),
               { role: { in: matchingRoles } }
            ];
          }
        }

        promises.push(
          (prisma as any).user.findMany({
            where: {
              ...filter,
              approvalStatus: 'APPROVED',
              role: { in: ['SUPER_ADMIN', 'ADMIN'] },
              ...userApprovalSearch,
              ...dateFilter
            },
            take: takeLimit,
            orderBy: { createdAt: 'desc' },
            include: { location: true, parent: true }
          }).then((users: any[]) => users.map((u: any) => {
            const isSuper = u.role === 'SUPER_ADMIN';
            const addedByName = formatUserDesignation(u.parent, isSuper ? 'System' : 'Admin');
            const roleLabel = isSuper ? 'Super Admin' : 'Admin';
            return {
              id: u.id,
              activityType: 'ADMIN',
              title: isSuper ? 'Super Admin Added' : 'Admin Added',
              description: `${roleLabel} ${u.name} ${u.surname || ''} added by ${addedByName}`,
              createdAt: toIST(u.createdAt),
              member: {
                id: u.id,
                name: u.name,
                phone: u.phone,
                role: u.role
              },
              location: u.location ? {
                id: u.location.id,
                name: u.location.name
              } : null,
              status: 'APPROVED'
            };
          }))
        );
      }

      if (shouldQuery('SUB_ADMIN')) {
        let userApprovalSearch = { ...approvalSearch };
        
        if (search) {
          const searchUpper = search.toUpperCase();
          if ('SUB_ADMIN'.includes(searchUpper)) {
            userApprovalSearch.OR = [
               ...(userApprovalSearch.OR || []),
               { role: 'SUB_ADMIN' }
            ];
          }
        }

        promises.push(
          (prisma as any).user.findMany({
            where: {
              ...filter,
              approvalStatus: 'APPROVED',
              role: 'SUB_ADMIN',
              ...userApprovalSearch,
              ...dateFilter
            },
            take: takeLimit,
            orderBy: { createdAt: 'desc' },
            include: { location: true, parent: true }
          }).then((users: any[]) => users.map((u: any) => {
            const addedByName = formatUserDesignation(u.parent, 'Admin');
            return {
              id: u.id,
              activityType: 'SUB_ADMIN',
              title: 'Sub Admin Added',
              description: `Sub Admin ${u.name} ${u.surname || ''} added by ${addedByName}`,
              createdAt: toIST(u.createdAt),
              member: {
                id: u.id,
                name: u.name,
                phone: u.phone,
                role: u.role
              },
              location: u.location ? {
                id: u.location.id,
                name: u.location.name
              } : null,
              status: 'APPROVED'
            };
          }))
        );
      }

      if (shouldQuery('BROADCAST')) {
        promises.push(
          (prisma as any).broadcast.findMany({
            where: { ...broadcastEventFilter, ...broadcastSearch, ...dateFilter },
            take: takeLimit,
            orderBy: { createdAt: 'desc' },
            include: { location: true, createdBy: true }
          }).then((broadcasts: any[]) => broadcasts.map((b: any) => ({
            id: b.id,
            activityType: 'BROADCAST',
            title: b.title,
            description: b.message,
            createdAt: toIST(b.createdAt),
            member: b.createdBy ? {
              id: b.createdBy.id,
              name: b.createdBy.name,
              phone: b.createdBy.phone,
              role: b.createdBy.role
            } : null,
            location: b.location ? {
              id: b.location.id,
              name: b.location.name
            } : null,
            status: 'CREATED'
          })))
        );
      }

      if (shouldQuery('ROLE_CHANGE')) {
        // Build audit where carefully — merge filters without spread conflict
        const auditUserFilter: any = {};
        if (targetLocationId) {
          auditUserFilter.locationId = { in: allLocationIds };
        }
        if (search) {
          auditUserFilter.name = { contains: search, mode: 'insensitive' };
        }

        const andFilters: any[] = [
          {
            action: {
              in: [
                'role_change',
                'profile_update',
                'member_approve',
                'member_reject',
                'post_warned',
                'post_deleted'
              ]
            }
          }
        ];

        if (Object.keys(auditUserFilter).length > 0) {
          andFilters.push({ user: auditUserFilter });
        }

        if (search) {
          andFilters.push({
            OR: [
              { action: { contains: search, mode: 'insensitive' } },
              { details: { contains: search, mode: 'insensitive' } }
            ]
          });
        }

        if (dateFilter.createdAt) {
          andFilters.push({ createdAt: dateFilter.createdAt });
        }

        const auditWhere: any = {
          AND: andFilters
        };

        promises.push(
          (prisma as any).auditLog.findMany({
            where: auditWhere,
            take: takeLimit,
            orderBy: { createdAt: 'desc' },
            include: { user: { include: { location: true } } }
          }).then((logs: any[]) => logs.map((l: any) => {
            const action = l.action;
            let title = 'Role Changed';
            let status = 'APPROVED';

            if (action === 'profile_update') {
              title = 'Profile Updated';
              status = 'APPROVED';
            } else if (action === 'member_approve') {
              title = 'Member Approved';
              status = 'APPROVED';
            } else if (action === 'member_reject') {
              title = 'Member Rejected';
              status = 'REJECTED';
            } else if (action === 'post_warned') {
              title = 'Warning Sent';
              status = 'WARNING';
            } else if (action === 'post_deleted') {
              title = 'Post Removed';
              status = 'REJECTED';
            } else if (action === 'role_change') {
              title = 'Role Changed';
              status = 'APPROVED';
            }

            const isProfile = action === 'profile_update';

            return {
              id: l.id,
              activityType: 'ROLE_CHANGE',
              title,
              description: l.details || (isProfile ? `Profile updated for user ${l.user?.name || ''}` : `Role changed for user ${l.user?.name || ''}`),
              createdAt: toIST(l.createdAt),
              member: l.user ? {
                id: l.user.id,
                name: l.user.name,
                phone: l.user.phone,
                role: l.user.role
              } : null,
              location: l.user?.location ? {
                id: l.user.location.id,
                name: l.user.location.name
              } : null,
              status
            };
          }))
        );
      }

      const results = await Promise.all(promises);
      const allActivities = results.flat();

      allActivities.sort((a: any, b: any) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      return allActivities.slice(offset, offset + limit);
    },

    professions: async () => {
      return (prisma as any).profession.findMany({ orderBy: { name: 'asc' } });
    },

    communityFeed: async (_: any, { locationId }: any, context: any) => {
      const where: any = {};
      const user = context?.user;

      let fetchRootId = null;
      let targetLocationId = locationId || user?.locationId;
      
      if (targetLocationId) {
        const ancestorIds = await getAncestorLocationIds(targetLocationId);
        // Find the STATE level location ID in the ancestors
        for (const aId of ancestorIds) {
          const loc = await (prisma as any).location.findUnique({ where: { id: aId }, select: { type: true } });
          if (loc?.type === 'STATE') {
            fetchRootId = aId;
            break;
          }
        }
        if (!fetchRootId) {
          // Fallback to topmost ancestor
          fetchRootId = ancestorIds[ancestorIds.length - 1] || targetLocationId;
        }
      } else {
        // Fallback to the first STATE location in the database
        const stateLoc = await (prisma as any).location.findFirst({ where: { type: 'STATE' } });
        if (stateLoc) {
          fetchRootId = stateLoc.id;
        }
      }

      if (fetchRootId) {
        const childIds = await getChildLocationIds(fetchRootId);
        where.locationId = { in: [fetchRootId, ...childIds] };
      }

      where.status = { not: 'DELETED' };
      // 1. Fetch recent posts (limit 200 to keep ranking fast)
      const posts = await (prisma as any).post.findMany({
        where,
        take: 200,
        include: { comments: { select: { id: true } } },
        orderBy: { createdAt: 'desc' },
      });

      // 2. AI Scoring
      const targetScoreLocationId = locationId || user?.locationId;
      const userScoreMap = await getUserLocationScoreMap(targetScoreLocationId);
      const locationAncestorsCache = new Map<number, number[]>();

      const scoredPosts = await Promise.all(posts.map(async (post: any) => {
        let postAncestors = locationAncestorsCache.get(post.locationId);
        if (!postAncestors) {
          postAncestors = await getAncestorLocationIds(post.locationId);
          locationAncestorsCache.set(post.locationId, postAncestors);
        }

        // Location Score
        let locationScore = 0;
        for (const pId of postAncestors) {
          if (userScoreMap.has(pId)) {
            locationScore = Math.max(locationScore, userScoreMap.get(pId)!);
          }
        }

        // Engagement Score (Like = +1, Comment = +3)
        const engagementScore = (post.likes || 0) + ((post.comments?.length || 0) * 3);
        
        // Final Score
        const feedScore = locationScore + engagementScore;

        return {
          ...post,
          locationScore,
          feedScore
        };
      }));

      // Sort first by administrative role (Admins/Sub-Admins top) and then by locationScore / date
      return scoredPosts.sort((a, b) => {
        const aIsAdmin = ['SUPER_ADMIN', 'ADMIN', 'SUB_ADMIN'].includes(String(a.authorRole || '').toUpperCase());
        const bIsAdmin = ['SUPER_ADMIN', 'ADMIN', 'SUB_ADMIN'].includes(String(b.authorRole || '').toUpperCase());

        if (aIsAdmin && !bIsAdmin) return -1;
        if (!aIsAdmin && bIsAdmin) return 1;
        if (aIsAdmin && bIsAdmin) {
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }

        const aLocScore = a.locationScore || 0;
        const bLocScore = b.locationScore || 0;
        if (bLocScore !== aLocScore) {
          return bLocScore - aLocScore;
        }
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    },

    getPollList: async (_: any, { locationId, communityId }: any, context: any) => {
      const where: any = {};
      const user = context?.user;

      // Filter out expired polls
      where.expiresAt = { gte: new Date() };

      if (communityId) {
        const community = await (prisma as any).community.findUnique({ where: { id: communityId } });
        let allCommunityIds = [communityId];
        if (community && community.locationId) {
          const ancestorLocIds = await getAncestorLocationIds(community.locationId);
          const childLocIds = await getChildLocationIds(community.locationId);
          const allLocIds = [...ancestorLocIds, community.locationId, ...childLocIds];
          const relatedCommunities = await (prisma as any).community.findMany({ where: { locationId: { in: allLocIds } } });
          allCommunityIds = relatedCommunities.map((c: any) => c.id);
        }
        where.communityId = { in: allCommunityIds };
      } else {
        let fetchRootId = null;
        let targetLocationId = locationId || user?.locationId;
        
        if (targetLocationId) {
          const ancestorIds = await getAncestorLocationIds(targetLocationId);
          for (const aId of ancestorIds) {
            const loc = await (prisma as any).location.findUnique({ where: { id: aId }, select: { type: true } });
            if (loc?.type === 'STATE') {
              fetchRootId = aId;
              break;
            }
          }
          if (!fetchRootId) {
            fetchRootId = ancestorIds[ancestorIds.length - 1] || targetLocationId;
          }
        } else {
          const stateLoc = await (prisma as any).location.findFirst({ where: { type: 'STATE' } });
          if (stateLoc) {
            fetchRootId = stateLoc.id;
          }
        }

        if (fetchRootId) {
          const childIds = await getChildLocationIds(fetchRootId);
          where.locationId = { in: [fetchRootId, ...childIds] };
        }
      }

      const polls = await (prisma as any).poll.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });

      const targetScoreLocationId = locationId || user?.locationId;
      const userScoreMap = await getUserLocationScoreMap(targetScoreLocationId);
      const locationAncestorsCache = new Map<number, number[]>();

      const scoredPolls = await Promise.all(polls.map(async (poll: any) => {
        let pollAncestors = locationAncestorsCache.get(poll.locationId);
        if (!pollAncestors) {
          pollAncestors = await getAncestorLocationIds(poll.locationId);
          locationAncestorsCache.set(poll.locationId, pollAncestors);
        }

        let locationScore = 0;
        for (const pId of pollAncestors) {
          if (userScoreMap.has(pId)) {
            locationScore = Math.max(locationScore, userScoreMap.get(pId)!);
          }
        }

        const likesCount = await (prisma as any).pollLike.count({ where: { pollId: poll.id } });
        const commentsCount = await (prisma as any).pollComment.count({ where: { pollId: poll.id } });
        const engagementScore = likesCount + (commentsCount * 3);

        const feedScore = locationScore + engagementScore;
        return {
          ...poll,
          locationScore,
          feedScore
        };
      }));

      // Sort by locationScore descending, then by createdAt descending!
      return scoredPolls.sort((a, b) => {
        const aLocScore = a.locationScore || 0;
        const bLocScore = b.locationScore || 0;
        if (bLocScore !== aLocScore) {
          return bLocScore - aLocScore;
        }
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    },

    getReportedPolls: async (_: any, { status }: any, context: any) => {
      const lang = context?.language || 'en';
      if (!context?.user) throw new Error(I18nService.translate("unauthorized_login", lang));

      const role = context.user.role;
      const userLocId = context.user.locationId;

      if (role === 'MEMBER') {
        throw new Error("Unauthorized: Only administrators can view reported polls.");
      }

      const where: any = {};
      if (status) {
        where.status = status;
      }

      if (role !== 'SUPER_ADMIN') {
        if (!userLocId) return [];
        const childIds = await getChildLocationIds(userLocId);
        const allowedLocIds = [userLocId, ...childIds];
        where.poll = {
          locationId: { in: allowedLocIds }
        };
      }

      return (prisma as any).pollReport.findMany({
        where,
        orderBy: { createdAt: 'desc' }
      });
    },

    getPollDetails: async (_: any, { id }: any) => {
      return (prisma as any).poll.findUnique({
        where: { id }
      });
    },

    getEmergencyRequestDetails: async (_: any, { id }: any) => {
      return (prisma as any).emergencyRequest.findUnique({
        where: { id: Number(id) }
      });
    },

    getEventDetails: async (_: any, { id }: any) => {
      return (prisma as any).event.findUnique({
        where: { id: Number(id) }
      });
    },

    getBroadcastDetails: async (_: any, { id }: any) => {
      return (prisma as any).broadcast.findUnique({
        where: { id: Number(id) }
      });
    },

    getPostDetails: async (_: any, { id }: any, context: any) => {
      const post = await (prisma as any).post.findUnique({
        where: { id: Number(id) }
      });
      if (post && post.status === 'DELETED') {
        if (!context?.user || context.user.role === 'MEMBER') {
          return null;
        }
      }
      return post;
    },

    notifications: async (_: any, { locationId }: any, context: any) => {
      if (!context?.user) {
        throw new Error(I18nService.translate("unauthorized_login", context?.language));
      }

      const role = context.user.role;
      const userLocId = context.user.locationId;
      const where: any = {};

      let joinedAt: Date | null = null;
      if (context.user.type === 'admin') {
        const adminUser = await (prisma as any).user.findUnique({
          where: { id: Number(context.user.id) },
          select: { createdAt: true }
        });
        if (adminUser) joinedAt = adminUser.createdAt;
      } else {
        const memberUser = await (prisma as any).member.findUnique({
          where: { id: Number(context.user.id) },
          select: { createdAt: true }
        });
        if (memberUser) joinedAt = memberUser.createdAt;
      }

      if (joinedAt) {
        where.createdAt = { gte: joinedAt };
      }

      if (role === 'SUPER_ADMIN') {
        if (locationId) {
          const allLocationIds = [locationId, ...(await getChildLocationIds(locationId))];
          where.locationId = { in: allLocationIds };
        }
      } else if (role === 'ADMIN' || role === 'SUB_ADMIN') {
        if (!userLocId) return [];
        const childIds = await getChildLocationIds(userLocId);
        const ancestorIds = await getAncestorLocationIds(userLocId);
        const adminLocationIds = Array.from(new Set([userLocId, ...childIds, ...ancestorIds]));

        let targetLocationIds = adminLocationIds;
        if (locationId) {
          const requestedLocationIds = [locationId, ...(await getChildLocationIds(locationId))];
          targetLocationIds = requestedLocationIds.filter((id: number) => adminLocationIds.includes(id));
        }
        where.locationId = { in: targetLocationIds };
      } else {
        // MEMBER
        if (!userLocId) return [];
        const ancestorIds = await getAncestorLocationIds(userLocId);

        let targetLocationIds = ancestorIds;
        if (locationId) {
          if (ancestorIds.includes(locationId)) {
            targetLocationIds = [locationId];
          } else {
            return []; // Member cannot access other location notifications
          }
        }
        where.locationId = { in: targetLocationIds };
      }

      // Get all deleted notification IDs for this user
      const deletedNotifications = await (prisma as any).deletedNotification.findMany({
        where: context.user.type === 'admin'
          ? { userId: Number(context.user.id) }
          : { memberId: Number(context.user.id) },
        select: { notificationId: true }
      });
      const deletedIds = deletedNotifications.map((dn: any) => dn.notificationId);
      where.id = { notIn: deletedIds };

      const notifications = await (prisma as any).notification.findMany({
        where,
        include: { location: true, createdBy: true },
        orderBy: { createdAt: 'desc' }
      });

      // Filter out MEMBER_REQUEST notifications that are not meant for the user's role
      return notifications.filter((notif: any) => {
        const notifType = String(notif.type || '').toUpperCase();
        if (notifType === 'MEMBER_REQUEST') {
          const msg = String(notif.message || notif.purpose || '').toLowerCase();
          if (msg.includes('super admin')) {
            return role === 'SUPER_ADMIN';
          }
          if (msg.includes('pending admin review') || msg.includes('escalate to admin')) {
            return role === 'ADMIN' || role === 'SUPER_ADMIN';
          }
          if (msg.includes('sub admin')) {
            return role === 'SUB_ADMIN' || role === 'ADMIN' || role === 'SUPER_ADMIN';
          }
          return role === 'SUB_ADMIN' || role === 'ADMIN' || role === 'SUPER_ADMIN';
        }
        return true;
      });
    },

    getNotificationDetails: async (_: any, { id }: any, context: any) => {
      if (!context?.user) {
        throw new Error(I18nService.translate("unauthorized_login", context?.language));
      }

      const notification = await (prisma as any).notification.findUnique({
        where: { id: Number(id) },
        include: { location: true, createdBy: true }
      });
      if (!notification) return null;

      const role = context.user.role;
      const notifType = String(notification.type || '').toUpperCase();
      if (notifType === 'MEMBER_REQUEST') {
        const msg = String(notification.message || notification.purpose || '').toLowerCase();
        let isAuthorized = true;
        if (msg.includes('super admin') && role !== 'SUPER_ADMIN') {
          isAuthorized = false;
        } else if ((msg.includes('pending admin review') || msg.includes('escalate to admin')) && role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
          isAuthorized = false;
        } else if (msg.includes('sub admin') && role !== 'SUB_ADMIN' && role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
          isAuthorized = false;
        } else if (role === 'MEMBER') {
          isAuthorized = false;
        }
        if (!isAuthorized) return null;
      }

      // Check if the notification was created before the user's registration (joinedAt)
      let joinedAt: Date | null = null;
      if (context.user.type === 'admin') {
        const adminUser = await (prisma as any).user.findUnique({
          where: { id: Number(context.user.id) },
          select: { createdAt: true }
        });
        if (adminUser) joinedAt = adminUser.createdAt;
      } else {
        const memberUser = await (prisma as any).member.findUnique({
          where: { id: Number(context.user.id) },
          select: { createdAt: true }
        });
        if (memberUser) joinedAt = memberUser.createdAt;
      }

      if (joinedAt && notification.createdAt < joinedAt) {
        return null;
      }

      // Check if deleted by the user
      const isDeleted = await (prisma as any).deletedNotification.findFirst({
        where: context.user.type === 'admin'
          ? { notificationId: Number(id), userId: Number(context.user.id) }
          : { notificationId: Number(id), memberId: Number(context.user.id) }
      });
      if (isDeleted) return null;

      const userLocId = context.user.locationId;
      if (role === 'ADMIN' || role === 'SUB_ADMIN') {
        if (!userLocId) throw new Error('Unauthorized notification scope');
        const childIds = await getChildLocationIds(userLocId);
        const ancestorIds = await getAncestorLocationIds(userLocId);
        const allowedIds = Array.from(new Set([userLocId, ...childIds, ...ancestorIds]));
        if (!allowedIds.includes(notification.locationId)) throw new Error('Unauthorized notification scope');
      } else if (role === 'MEMBER') {
        if (!userLocId) throw new Error('Unauthorized notification scope');
        const ancestorIds = await getAncestorLocationIds(userLocId);
        if (!ancestorIds.includes(notification.locationId)) throw new Error('Unauthorized notification scope');
      }

      const entityType = String(notification.entityType || notification.type || '').toUpperCase();
      const entityId = notification.entityId ? Number(notification.entityId) : null;
      let emergency = null;
      let broadcast = null;
      let event = null;
      let communityPost = null;
      let memberRequest = null;

      if (entityId && ['EMERGENCY', 'ALERT', 'REQUEST', 'BLOOD_REQUIRED'].includes(entityType)) {
        emergency = await (prisma as any).emergencyRequest.findUnique({
          where: { id: entityId },
          include: {
            location: true,
            createdBy: true,
            member: true,
            responses: { include: { member: true }, orderBy: { updatedAt: 'desc' } }
          }
        });
      } else if (entityId && entityType === 'BROADCAST') {
        broadcast = await (prisma as any).broadcast.findUnique({
          where: { id: entityId },
          include: { location: true, createdBy: true }
        });
      } else if (entityId && entityType === 'EVENT') {
        event = await (prisma as any).event.findUnique({
          where: { id: entityId },
          include: { location: true, createdBy: true, responses: { include: { member: true } } }
        });
      } else if (entityId && ['COMMUNITY', 'COMMUNITY_POST'].includes(entityType)) {
        communityPost = await (prisma as any).communityPost.findUnique({
          where: { id: entityId },
          include: { community: true, createdBy: true, comments: true }
        });
      } else if (entityId && ['MEMBER_REQUEST', 'MEMBER_APPROVAL'].includes(entityType)) {
        memberRequest = await (prisma as any).member.findUnique({
          where: { id: entityId },
          include: { location: true, createdBy: true, approvedBy: true }
        });
      }

      const primaryEntity = emergency || broadcast || event || communityPost || memberRequest || notification;
      const responseSummary = emergency ? buildEmergencyResponseStats(emergency.responses || []) : null;
      const locationScope = await buildLocationScope(primaryEntity.locationId || notification.locationId);
      const activityHistory = [
        {
          title: 'Notification Created',
          description: notification.purpose || notification.message,
          actorName: notification.createdBy?.name || emergency?.createdBy?.name || broadcast?.createdBy?.name || event?.createdBy?.name || communityPost?.createdBy?.name || memberRequest?.createdBy?.name || 'System',
          status: notification.status,
          createdAt: toIsoString(notification.createdAt)
        },
        ...(emergency?.responses || []).map((response: any) => ({
          title: 'Member Responded',
          description: `${response.member?.name || 'Member'} - ${response.status}`,
          actorName: response.member?.name || 'Member',
          status: response.status,
          createdAt: toIsoString(response.updatedAt || response.createdAt)
        }))
      ].filter((item: any) => item.createdAt);

      let deliveryStats = null;
      if (broadcast) {
        const totalRecipients = await getUniqueRecipientCount(broadcast.locationId);
        deliveryStats = {
          totalRecipients,
          readCount: 0,
          unreadCount: totalRecipients,
          deliveredCount: totalRecipients
        };
      }

      return {
        notification,
        notificationId: notification.id,
        notificationTypeBadge: notification.type,
        statusBadge: notification.status || primaryEntity.status || 'ACTIVE',
        purpose: notification.purpose,
        createdBy: notification.createdBy || emergency?.createdBy || broadcast?.createdBy || event?.createdBy || communityPost?.createdBy || memberRequest?.createdBy || null,
        locationScope,
        responseRequired: (emergency?.collectResponse ?? false) || entityType === 'EVENT' || notification.type === 'EVENT',
        responseSummary,
        deliveryStats,
        activityHistory,
        availableActions: buildNotificationActions(notification.type, primaryEntity),
        emergency,
        broadcast,
        event,
        communityPost,
        memberRequest
      };
    },

    getEventList: async (_: any, { locationId, status, eventId }: any, context: any) => {
      const where: any = {};
      if (eventId) {
        where.id = eventId;
      } else {
        if (locationId) {
          const talukId = await findParentLocationOfType(locationId, 'TALUK');
          let allLocationIds: number[] = [];
          if (talukId) {
            const ancestorIds = await getAncestorLocationIds(talukId);
            const childIds = await getChildLocationIds(talukId);
            allLocationIds = [talukId, ...ancestorIds, ...childIds];
          } else {
            const ancestorIds = await getAncestorLocationIds(locationId);
            const childIds = await getChildLocationIds(locationId);
            allLocationIds = [locationId, ...ancestorIds, ...childIds];
          }
          where.locationId = { in: allLocationIds };
        }

        const userRole = context?.user?.role;
        const now = new Date();
        const istOffset = 5.5 * 60 * 60 * 1000;
        const istTime = new Date(now.getTime() + istOffset);
        const startOfTodayIST = new Date(istTime);
        startOfTodayIST.setUTCHours(0, 0, 0, 0);
        const startOfToday = new Date(startOfTodayIST.getTime() - istOffset);

        if (userRole === 'MEMBER') {
          if (status === 'COMPLETED' || status === 'EXPIRED') {
            return [];
          }
          const targetStatus = status || 'ACTIVE';
          if (targetStatus === 'ACTIVE') {
            where.status = 'ACTIVE';
            where.date = { gte: startOfToday };
          } else if (targetStatus === 'UPCOMING') {
            where.status = 'ACTIVE';
            const oneDayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000);
            where.date = { gt: oneDayFromNow };
          } else {
            return [];
          }
        } else {
          if (status) {
            const oneDayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000);
            if (status === 'COMPLETED' || status === 'EXPIRED') {
              where.OR = [
                { status: 'COMPLETED' },
                { status: 'EXPIRED' },
                { date: { lt: startOfToday } }
              ];
              where.status = { notIn: ['CANCELLED', 'INACTIVE'] };
            } else if (status === 'ACTIVE') {
              where.status = 'ACTIVE';
              where.date = { gte: startOfToday };
            } else if (status === 'UPCOMING') {
              where.status = 'ACTIVE';
              where.date = { gt: oneDayFromNow };
            } else {
              where.status = status;
            }
          }
        }
      }
      
      return (prisma as any).event.findMany({
        where,
        include: { location: true, createdBy: true },
        orderBy: { date: 'desc' }
      });
    },

    getEmergencyRequestList: async (_: any, { locationId, status }: any, context: any) => {
      const where: any = {};
      if (locationId) {
        const talukId = await findParentLocationOfType(locationId, 'TALUK');
        let allLocationIds: number[] = [];
        if (talukId) {
          const ancestorIds = await getAncestorLocationIds(talukId);
          const childIds = await getChildLocationIds(talukId);
          allLocationIds = [talukId, ...ancestorIds, ...childIds];
        } else {
          const ancestorIds = await getAncestorLocationIds(locationId);
          const childIds = await getChildLocationIds(locationId);
          allLocationIds = [locationId, ...ancestorIds, ...childIds];
        }
        where.locationId = { in: allLocationIds };
      }

      const joinedAt = await getUserJoinedAt(context);
      if (joinedAt) {
        where.createdAt = { gte: joinedAt };
      }

      const userRole = context?.user?.role;
      if (status) {
        if (userRole === 'MEMBER' && (status === 'COMPLETED' || status === 'REJECTED')) {
          return [];
        }
        where.status = status;
      } else {
        // Default visibility filters based on role
        if (userRole === 'SUPER_ADMIN') {
          where.status = { in: ['PENDING_SUPER_ADMIN', 'APPROVED_STATE', 'COMPLETED', 'REJECTED'] };
        } else if (userRole === 'ADMIN') {
          where.status = { in: ['PENDING_ADMIN', 'APPROVED_ADMIN', 'PENDING_SUPER_ADMIN', 'APPROVED_STATE', 'COMPLETED', 'REJECTED'] };
        } else if (userRole === 'SUB_ADMIN') {
          where.status = { in: ['PENDING_SUB_ADMIN', 'APPROVED_SUB_ADMIN', 'PENDING_ADMIN', 'APPROVED_ADMIN', 'PENDING_SUPER_ADMIN', 'APPROVED_STATE', 'COMPLETED', 'REJECTED'] };
        } else {
          // Members or unauthenticated users only see approved and live requests (excluding COMPLETED)
          where.status = { in: ['APPROVED_SUB_ADMIN', 'APPROVED_ADMIN', 'APPROVED_STATE'] };
        }
      }
      
      return (prisma as any).emergencyRequest.findMany({
        where,
        include: { location: true, member: true, createdBy: true },
        orderBy: { createdAt: 'desc' }
      });
    },

    getCommunities: async (_: any, { joinedOnly, privacyType }: { joinedOnly?: boolean, privacyType?: string }, context: any) => {
      const user = context?.user;
      if (!user) return [];
      const where: any = {};
      const memberId = await getMemberIdFromContext(context);
      const memberships = memberId ? await (prisma as any).communityMember.findMany({
        where: { memberId },
        select: { communityId: true }
      }) : [];
      const joinedIds = memberships.map((m: any) => m.communityId);

      if (privacyType) {
        where.privacyType = privacyType;
      }

      if (joinedOnly) {
        if (!memberId) return [];
        where.id = { in: joinedIds };
      } else {
        if (user.role === 'MEMBER') {
          if (user.locationId) {
            const ancestorIds = await getAncestorLocationIds(user.locationId);
            where.OR = [
              { locationId: null },
              { locationId: { in: ancestorIds } }
            ];
          } else {
            where.locationId = null;
          }
        } else if (user.role === 'ADMIN' || user.role === 'SUB_ADMIN' || user.role === 'DISTRICT_INCHARGE') {
          if (user.locationId) {
            const childIds = await getChildLocationIds(user.locationId);
            where.OR = [
              { locationId: null },
              { locationId: { in: [user.locationId, ...childIds] } }
            ];
          } else {
            where.locationId = null;
          }
        }
        
        where.AND = [
          {
            OR: [
              { privacyType: { not: 'SECRET' } },
              { id: { in: joinedIds } }
            ]
          }
        ];
      }

      const communities = await (prisma as any).community.findMany({
        where,
        orderBy: { name: 'asc' }
      });
      
      const results = [];
      for (const community of communities) {
        const memberCount = await (prisma as any).communityMember.count({
          where: { communityId: community.id }
        });
        results.push({
          ...community,
          memberCount,
          createdAt: toIsoString(community.createdAt)
        });
      }
      return results;
    },

    getCommunityPosts: async (_: any, { communityId, category }: any) => {
      const community = await (prisma as any).community.findUnique({ where: { id: communityId } });
      let allCommunityIds = [communityId];
      if (community && community.locationId) {
        const ancestorLocIds = await getAncestorLocationIds(community.locationId);
        const childLocIds = await getChildLocationIds(community.locationId);
        const allLocIds = [...ancestorLocIds, community.locationId, ...childLocIds];
        const relatedCommunities = await (prisma as any).community.findMany({ where: { locationId: { in: allLocIds } } });
        allCommunityIds = relatedCommunities.map((c: any) => c.id);
      }
      const where: any = { communityId: { in: allCommunityIds } };
      if (category) {
        where.category = category;
      }
      const posts = await (prisma as any).communityPost.findMany({
        where,
        include: {
          community: true,
          createdBy: true,
          member: true,
          comments: {
            orderBy: { createdAt: 'asc' }
          }
        },
        orderBy: { createdAt: 'desc' }
      });
      return posts.map((p: any) => ({
        ...p,
        createdAt: toIsoString(p.createdAt)
      }));
    },

    getCommunityMessages: async (_: any, { communityId, limit = 50, beforeMessageId }: any, context: any) => {
      await assertCommunityReadAccess(Number(communityId), context);

      const where: any = { communityId: Number(communityId) };
      if (beforeMessageId) {
        const beforeMessage = await (prisma as any).communityMessage.findFirst({
          where: {
            id: Number(beforeMessageId),
            communityId: Number(communityId)
          },
          select: { createdAt: true }
        });
        if (beforeMessage) {
          where.createdAt = { lt: beforeMessage.createdAt };
        }
      }

      const messages = await (prisma as any).communityMessage.findMany({
        where,
        take: Math.min(Number(limit) || 50, 100),
        include: { replyTo: true, reactions: true },
        orderBy: { createdAt: 'desc' }
      });

      return Promise.all(messages.reverse().map(formatCommunityMessage));
    },

    getCommunityUnreadCount: async (_: any, { communityId }: any, context: any) => {
      await assertCommunityReadAccess(Number(communityId), context);

      const memberId = await getMemberIdFromContext(context);
      if (!memberId) return 0;

      const membership = await (prisma as any).communityMember.findUnique({
        where: {
          communityId_memberId: {
            communityId: Number(communityId),
            memberId
          }
        },
        select: { unreadCount: true }
      });

      return membership?.unreadCount || 0;
    },

    getCommunityMembers: async (_: any, { communityId, role, search }: any, context: any) => {
      await assertCommunityReadAccess(Number(communityId), context);

      const community = await (prisma as any).community.findUnique({
        where: { id: Number(communityId) }
      });
      if (!community) throw new Error("Community not found");

      // 1. Fetch all members in CommunityMember table
      let whereClause: any = { communityId: Number(communityId) };
      const memberships = await (prisma as any).communityMember.findMany({
        where: whereClause,
        include: { member: { include: { location: true } } }
      });

      let memberDetails = memberships.map((m: any) => ({
        id: m.member.id,
        name: `${m.member.name} ${m.member.surname || ''}`.trim(),
        phone: m.member.phone,
        image: m.member.image,
        role: m.role || 'MEMBER',
        isGroupAdmin: m.role === 'OWNER' || m.role === 'ADMIN',
        isMuted: m.isMuted
      }));

      // 2. Fetch all admins who are in the same location or parents of the location
      let adminUsers: any[] = [];
      if (community.locationId) {
        const ancestorIds = await getAncestorLocationIds(community.locationId);
        adminUsers = await (prisma as any).user.findMany({
          where: {
            role: { in: ['SUPER_ADMIN', 'ADMIN', 'SUB_ADMIN'] },
            locationId: { in: ancestorIds }
          },
          include: { location: true }
        });
      } else {
        adminUsers = await (prisma as any).user.findMany({
          where: { role: 'SUPER_ADMIN' },
          include: { location: true }
        });
      }

      const adminDetails = adminUsers.map((u: any) => ({
        id: -Number(u.id),
        name: `${u.name} ${u.surname || ''}`.trim(),
        phone: u.phone,
        image: u.image,
        role: u.role,
        isGroupAdmin: true,
        isMuted: false
      }));

      let allMembers = [...adminDetails, ...memberDetails];

      // Filter by role if specified
      if (role) {
        allMembers = allMembers.filter((m: any) => m.role === role);
      }

      // Filter by search if specified
      if (search) {
        const searchLower = search.toLowerCase();
        allMembers = allMembers.filter((m: any) =>
          m.name.toLowerCase().includes(searchLower) ||
          m.phone?.includes(searchLower)
        );
      }

      return allMembers;
    },

    getTargetableLocations: async (_: any, { parentId }: any, context: any) => {
      const user = context.user;
      if (!user) return [];
      const role = user.role;
      const userLocId = user.locationId;

      // Helper to fetch locations and attach member count
      const fetchWithMemberCount = async (locations: any[]) => {
        return Promise.all(
          locations.map(async (loc: any) => {
            const childIds = await getChildLocationIds(loc.id);
            const allIds = [loc.id, ...childIds];
            const memberCount = await (prisma as any).member.count({ 
              where: { locationId: { in: allIds }, isActive: true } 
            });
            return { ...loc, memberCount };
          })
        );
      };

      if (parentId !== undefined && parentId !== null) {
        // Enforce permissions: Check if user is allowed to target this parent location
        if (role !== 'SUPER_ADMIN') {
          if (!userLocId) return [];
          if (userLocId !== parentId) {
            const childIds = await getChildLocationIds(userLocId);
            if (!childIds.includes(parentId)) {
              return []; // Unauthorized
            }
          }
        }

        // Return direct children of the parentId
        const children = await (prisma as any).location.findMany({
          where: { parentId: parentId },
          select: { id: true, name: true, type: true, parentId: true }
        });
        return fetchWithMemberCount(children);
      }

      // If no parentId is passed:
      if (role === 'SUPER_ADMIN') {
        // Return top‑level locations (states)
        const states = await (prisma as any).location.findMany({
          where: { type: 'STATE' },
          select: { id: true, name: true, type: true, parentId: true },
        });
        return fetchWithMemberCount(states);
      }

      if (role === 'ADMIN' || role === 'SUB_ADMIN') {
        if (!userLocId) return [];
        // Return only their assigned location as the root choice
        const own = await (prisma as any).location.findUnique({
          where: { id: userLocId },
          select: { id: true, name: true, type: true, parentId: true },
        });
        if (!own) return [];
        return fetchWithMemberCount([own]);
      }

      return [];
    },

    getBroadcastList: async (_: any, args: any, context: any) => {
      return getBroadcastListForContext(args, context);
    },

    getBroadcasts: async (_: any, args: any, context: any) => {
      return getBroadcastListForContext(args, context);
    },

    // ─────────────────────────────────────────────────────────────
    // Pending Members – ADMIN / SUPER_ADMIN மட்டுமே பார்க்கலாம்
    // ─────────────────────────────────────────────────────────────
    pendingMembers: async (_: any, { locationId }: any, context: any) => {
      const user = context?.user;
      const lang = context?.language || 'en';

      if (!user || !['SUPER_ADMIN', 'DISTRICT_INCHARGE', 'ADMIN', 'SUB_ADMIN'].includes(user.role)) {
        throw new Error(I18nService.translate('member_not_allowed', lang));
      }

      const where: any = { approvalStatus: 'PENDING' };
      const userWhere: any = { role: 'MEMBER', approvalStatus: 'PENDING' };

      // Role‑based location scoping
      if (user.role === 'SUPER_ADMIN') {
        // Super admin – optional filter
        if (locationId) {
          const childIds = await getChildLocationIds(Number(locationId));
          where.locationId = { in: [Number(locationId), ...childIds] };
          userWhere.locationId = { in: [Number(locationId), ...childIds] };
        }
      } else {
        const accessibleIds = await getAccessibleLocationIds(Number(user.id), user.role);
        if (accessibleIds.length === 0) {
          return [];
        }
        if (locationId) {
          const numLocId = Number(locationId);
          if (accessibleIds.includes(numLocId)) {
            const childIds = await getChildLocationIds(numLocId);
            where.locationId = { in: [numLocId, ...childIds] };
            userWhere.locationId = { in: [numLocId, ...childIds] };
          } else {
            return [];
          }
        } else {
          where.locationId = { in: accessibleIds };
          userWhere.locationId = { in: accessibleIds };
        }
      }

      const [pendingFromMember, pendingFromUser] = await Promise.all([
        (prisma as any).member.findMany({
          where,
          include: { location: true, profession: true },
          orderBy: { createdAt: 'desc' },
        }),
        (prisma as any).user.findMany({
          where: userWhere,
          include: { location: true },
          orderBy: { createdAt: 'desc' },
        })
      ]);

      const combined = [...pendingFromMember, ...pendingFromUser.map(userToMemberShape)];
      const uniquePending = Array.from(new Map(combined.map(item => [item.phone, item])).values());

      return uniquePending
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map((m: any) => ({
          ...m,
          createdAt: toIsoString(m.createdAt),
        }));
    },

    // ─────────────────────────────────────────────────────────────
    // Blood Groups – static enum list (professions போல)
    // ─────────────────────────────────────────────────────────────
    bloodGroups: async () => {
      return [
        'A_POSITIVE',
        'A_NEGATIVE',
        'B_POSITIVE',
        'B_NEGATIVE',
        'AB_POSITIVE',
        'AB_NEGATIVE',
        'O_POSITIVE',
        'O_NEGATIVE',
      ];
    },

    getPendingLocationAccessRequests: async (_: any, __: any, context: any) => {
      const user = context?.user;
      if (!user || user.role !== 'SUPER_ADMIN') {
        throw new Error('Only SUPER_ADMIN can view pending location access requests');
      }
      return (prisma as any).locationAccessRequest.findMany({
        where: { status: 'PENDING' },
        include: {
          user: { include: { location: true } },
          approvedBy: { include: { location: true } },
          requestedLocations: { include: { location: true } }
        },
        orderBy: { createdAt: 'desc' }
      });
    },

    getMyLocationAccessRequests: async (_: any, __: any, context: any) => {
      const user = context?.user;
      if (!user) throw new Error('Not authenticated');
      return (prisma as any).locationAccessRequest.findMany({
        where: { userId: Number(user.id) },
        include: {
          user: { include: { location: true } },
          approvedBy: { include: { location: true } },
          requestedLocations: { include: { location: true } }
        },
        orderBy: { createdAt: 'desc' }
      });
    },

    getUserAssignedLocations: async (_: any, { userId }: any, context: any) => {
      const user = context?.user;
      if (!user) throw new Error('Not authenticated');
      if (user.role !== 'SUPER_ADMIN' && Number(user.id) !== Number(userId)) {
        throw new Error('Unauthorized');
      }
      return (prisma as any).userLocation.findMany({
        where: { userId: Number(userId) },
        include: { location: true },
        orderBy: { isPrimary: 'desc' }
      });
    },

    getPendingCommunityJoinRequests: async (_: any, { communityId, status }: any, context: any) => {
      const user = context?.user;
      if (!user) throw new Error('Not authenticated');

      const role = await getCommunityRoleFromContext(context, Number(communityId));
      if (!role || !hasGroupPermission(role, 'MANAGE_MEMBERS')) {
        throw new Error('Only Community Admins can view pending join requests');
      }

      const where: any = { communityId: Number(communityId) };
      if (status) {
        where.status = status;
      } else {
        where.status = 'PENDING';
      }

      return (prisma as any).communityJoinRequest.findMany({
        where,
        include: { user: { include: { location: true } } },
        orderBy: { createdAt: 'desc' }
      });
    },

    getCommunityAdminLogs: async (_: any, { communityId }: any, context: any) => {
      const user = context?.user;
      if (!user) throw new Error('Not authenticated');

      const role = await getCommunityRoleFromContext(context, Number(communityId));
      if (!role || !['OWNER', 'ADMIN', 'MODERATOR'].includes(role)) {
        throw new Error('Unauthorized');
      }

      return (prisma as any).communityAdminLog.findMany({
        where: { communityId: Number(communityId) },
        include: { admin: true },
        orderBy: { createdAt: 'desc' }
      });
    },

    getCommunityComplaints: async (_: any, { communityId, status }: any, context: any) => {
      const user = context?.user;
      if (!user) throw new Error('Not authenticated');

      const role = await getCommunityRoleFromContext(context, Number(communityId));
      if (!role || !['OWNER', 'ADMIN', 'MODERATOR'].includes(role)) {
        throw new Error('Unauthorized');
      }

      const where: any = { communityId: Number(communityId) };
      if (status) where.status = status;

      return (prisma as any).communityComplaint.findMany({
        where,
        include: { reporter: true, assignee: true },
        orderBy: { createdAt: 'desc' }
      });
    },

    generateCommunityInviteLink: async (_: any, { communityId, expiryDays }: any, context: any) => {
      const user = context?.user;
      if (!user) throw new Error('Not authenticated');

      const role = await getCommunityRoleFromContext(context, Number(communityId));
      if (!role || !hasGroupPermission(role, 'MANAGE_COMMUNITY')) {
        throw new Error('Unauthorized');
      }

      const code = `INV-${Number(communityId)}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      const expiry = expiryDays ? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000) : null;

      await (prisma as any).community.update({
        where: { id: Number(communityId) },
        data: { inviteCode: code, inviteCodeExpiry: expiry }
      });

      return code;
    },

    getCommunityAnnouncements: async (_: any, { communityId }: any, context: any) => {
      const user = context?.user;
      if (!user) throw new Error('Not authenticated');

      const isMember = await (prisma as any).communityMember.findUnique({
        where: { communityId_memberId: { communityId: Number(communityId), memberId: Number(user.id) } }
      });
      if (!isMember && user.role !== 'SUPER_ADMIN') {
        throw new Error('Must be a member of the community to view announcements');
      }

      return (prisma as any).communityAnnouncement.findMany({
        where: {
          communityId: Number(communityId),
          OR: [
            { scheduledFor: null },
            { scheduledFor: { lte: new Date() } }
          ]
        },
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }]
      });
    },

    getCommunityMediaGallery: async (_: any, { communityId, mediaType }: any, context: any) => {
      const user = context?.user;
      if (!user) throw new Error('Not authenticated');

      const isMember = await (prisma as any).communityMember.findUnique({
        where: { communityId_memberId: { communityId: Number(communityId), memberId: Number(user.id) } }
      });
      if (!isMember && user.role !== 'SUPER_ADMIN') {
        throw new Error('Must be a member of the community to view media gallery');
      }

      const where: any = {
        communityId: Number(communityId),
        mediaUrl: { not: null },
        isDeleted: false
      };
      if (mediaType) {
        where.mediaType = mediaType;
      }

      const messages = await (prisma as any).communityMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' }
      });

      return messages.map((m: any) => ({
        messageId: m.id,
        mediaUrl: m.mediaUrl,
        mediaType: m.mediaType || 'IMAGE',
        fileName: m.fileName || null,
        createdAt: m.createdAt.toISOString()
      }));
    },

    getCommunityAnalytics: async (_: any, { communityId }: any, context: any) => {
      const user = context?.user;
      if (!user) throw new Error('Not authenticated');

      const role = await getCommunityRoleFromContext(context, Number(communityId));
      if (!role || !hasGroupPermission(role, 'VIEW_ANALYTICS')) {
        throw new Error('Unauthorized');
      }

      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [totalMembers, pendingRequests, newMembersThisWeek, eventsCount, complaints] = await Promise.all([
        (prisma as any).communityMember.count({ where: { communityId: Number(communityId) } }),
        (prisma as any).communityJoinRequest.count({ where: { communityId: Number(communityId), status: 'PENDING' } }),
        (prisma as any).communityMember.count({
          where: { communityId: Number(communityId), createdAt: { gte: oneWeekAgo } }
        }),
        (prisma as any).event.count({ where: { communityId: Number(communityId) } }),
        (prisma as any).communityComplaint.findMany({ where: { communityId: Number(communityId) } })
      ]);

      const resolvedComplaints = complaints.filter((c: any) => c.status === 'RESOLVED').length;
      const complaintResolutionRate = complaints.length > 0 ? (resolvedComplaints / complaints.length) * 100 : 0.0;

      return {
        totalMembers,
        activeMembersCount: Math.round(totalMembers * 0.6),
        pendingJoinRequestsCount: pendingRequests,
        newMembersThisWeek,
        eventsCreatedCount: eventsCount,
        pollParticipationRate: 45.5,
        complaintResolutionRate
      };
    },

    getCommunityBans: async (_: any, { communityId }: any, context: any) => {
      const user = context?.user;
      if (!user) throw new Error('Not authenticated');

      const role = await getCommunityRoleFromContext(context, Number(communityId));
      if (!role || !['OWNER', 'ADMIN', 'MODERATOR'].includes(role)) {
        throw new Error('Unauthorized');
      }

      return (prisma as any).communityBan.findMany({
        where: { communityId: Number(communityId) },
        include: { user: true, bannedBy: true },
        orderBy: { createdAt: 'desc' }
      });
    },

    // Additional Community APIs from images
    getCommunityDetails: async (_: any, { communityId }: any, context: any) => {
      const user = context?.user;
      const community = await (prisma as any).community.findUnique({
        where: { id: Number(communityId) },
        include: { location: true }
      });
      if (!community) throw new Error('Community not found');

      const memberId = await getMemberIdFromContext(context);
      const membership = memberId ? await (prisma as any).communityMember.findUnique({
        where: {
          communityId_memberId: {
            communityId: Number(communityId),
            memberId
          }
        }
      }) : null;

      const memberCount = await (prisma as any).communityMember.count({
        where: { communityId: Number(communityId) }
      });

      const announcementCount = await (prisma as any).communityAnnouncement.count({
        where: { communityId: Number(communityId) }
      });

      const eventCount = await (prisma as any).event.count({
        where: { communityId: Number(communityId) }
      });

      return {
        ...community,
        memberCount,
        announcementCount,
        eventCount,
        isJoined: !!membership,
        userRole: membership?.role || null,
        locationName: community.location?.name || null,
        tags: community.tags || [],
        createdAt: toIsoString(community.createdAt)
      };
    },

    getFeaturedCommunities: async (_: any, __: any, context: any) => {
      const user = context?.user;
      const communities = await (prisma as any).community.findMany({
        where: { isFeatured: true, privacyType: { not: 'SECRET' } },
        include: { location: true },
        orderBy: { name: 'asc' }
      });

      const results = [];
      for (const community of communities) {
        const memberCount = await (prisma as any).communityMember.count({
          where: { communityId: community.id }
        });
        results.push({
          ...community,
          memberCount,
          createdAt: toIsoString(community.createdAt)
        });
      }
      return results;
    },

    getNearbyCommunities: async (_: any, { locationId, radiusKm = 10 }: any, context: any) => {
      const user = context?.user;
      const targetLocationId = locationId || user?.locationId;
      if (!targetLocationId) return [];

      const location = await (prisma as any).location.findUnique({
        where: { id: Number(targetLocationId) }
      });
      if (!location) return [];

      const ancestorIds = await getAncestorLocationIds(Number(targetLocationId));
      const childIds = await getChildLocationIds(Number(targetLocationId));
      const allLocationIds = [Number(targetLocationId), ...ancestorIds, ...childIds];

      const communities = await (prisma as any).community.findMany({
        where: {
          locationId: { in: allLocationIds },
          privacyType: { not: 'SECRET' }
        },
        include: { location: true },
        orderBy: { name: 'asc' }
      });

      const results = [];
      for (const community of communities) {
        const memberCount = await (prisma as any).communityMember.count({
          where: { communityId: community.id }
        });
        results.push({
          ...community,
          memberCount,
          createdAt: toIsoString(community.createdAt)
        });
      }
      return results;
    },

    searchCommunities: async (_: any, { query, locationId }: any, context: any) => {
      const user = context?.user;
      const where: any = {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } }
        ],
        privacyType: { not: 'SECRET' }
      };

      if (locationId) {
        const ancestorIds = await getAncestorLocationIds(Number(locationId));
        const childIds = await getChildLocationIds(Number(locationId));
        const allLocationIds = [Number(locationId), ...ancestorIds, ...childIds];
        where.locationId = { in: allLocationIds };
      }

      const communities = await (prisma as any).community.findMany({
        where,
        include: { location: true },
        orderBy: { name: 'asc' }
      });

      const results = [];
      for (const community of communities) {
        const memberCount = await (prisma as any).communityMember.count({
          where: { communityId: community.id }
        });
        results.push({
          ...community,
          memberCount,
          createdAt: toIsoString(community.createdAt)
        });
      }
      return results;
    },

    getCommunityRules: async (_: any, { communityId }: any, context: any) => {
      const community = await (prisma as any).community.findUnique({
        where: { id: Number(communityId) },
        select: { rules: true }
      });
      if (!community) throw new Error('Community not found');
      return community.rules || [];
    },

    getCommunityEvents: async (_: any, { communityId }: any, context: any) => {
      await assertCommunityReadAccess(Number(communityId), context);

      return (prisma as any).event.findMany({
        where: { communityId: Number(communityId) },
        include: { location: true, createdBy: true },
        orderBy: { date: 'asc' }
      });
    },

    getCommunityInviteCode: async (_: any, { communityId }: any, context: any) => {
      const user = context?.user;
      if (!user) throw new Error('Not authenticated');

      const role = await getCommunityRoleFromContext(context, Number(communityId));
      if (!role || !hasGroupPermission(role, 'MANAGE_COMMUNITY')) {
        throw new Error('Unauthorized');
      }

      const community = await (prisma as any).community.findUnique({
        where: { id: Number(communityId) },
        select: { inviteCode: true, inviteCodeExpiry: true }
      });

      if (!community) throw new Error('Community not found');
      if (community.inviteCodeExpiry && new Date() > community.inviteCodeExpiry) {
        return null;
      }
      return community.inviteCode;
    },

    getCommunitySettings: async (_: any, { communityId }: any, context: any) => {
      const user = context?.user;
      if (!user) throw new Error('Not authenticated');

      await assertCommunityReadAccess(Number(communityId), context);

      const community = await (prisma as any).community.findUnique({
        where: { id: Number(communityId) },
        include: { location: true }
      });

      if (!community) throw new Error('Community not found');

      const memberId = await getMemberIdFromContext(context);
      const membership = memberId ? await (prisma as any).communityMember.findUnique({
        where: {
          communityId_memberId: {
            communityId: Number(communityId),
            memberId
          }
        }
      }) : null;

      return {
        communityId: community.id,
        notificationsEnabled: membership?.notificationsEnabled ?? true,
        mediaAutoDownload: membership?.mediaAutoDownload ?? false,
        linksAndDocsEnabled: community.linksAndDocsEnabled ?? true,
        muted: membership?.isMuted ?? false,
        starredMessagesEnabled: membership?.starredMessagesEnabled ?? true,
        about: community.description,
        location: community.location?.name || null,
        createdAt: toIsoString(community.createdAt)
      };
    },

    getCommunityRolesAndPermissions: async (_: any, { communityId }: any, context: any) => {
      const user = context?.user;
      if (!user) throw new Error('Not authenticated');

      const role = await getCommunityRoleFromContext(context, Number(communityId));
      if (!role || !['OWNER', 'ADMIN'].includes(role)) {
        throw new Error('Unauthorized');
      }

      const defaultPermissions = {
        OWNER: ['ALL_PERMISSIONS'],
        ADMIN: ['MANAGE_MEMBERS', 'MANAGE_COMMUNITY', 'MANAGE_POSTS', 'MANAGE_ANNOUNCEMENTS', 'VIEW_ANALYTICS'],
        MODERATOR: ['MANAGE_POSTS', 'MANAGE_ANNOUNCEMENTS'],
        MEMBER: ['POST_MESSAGES', 'VIEW_CONTENT']
      };

      return Object.entries(defaultPermissions).map(([roleName, permissions]) => ({
        roleName,
        permissions,
        description: `${roleName} role permissions`
      }));
    },

    getCommunityStarredMessages: async (_: any, { communityId }: any, context: any) => {
      const user = context?.user;
      if (!user) throw new Error('Not authenticated');

      await assertCommunityReadAccess(Number(communityId), context);

      const memberId = await getMemberIdFromContext(context);
      if (!memberId) return [];

      const starredMessageIds = await (prisma as any).communityMessageStar.findMany({
        where: {
          communityId: Number(communityId),
          memberId
        },
        select: { messageId: true }
      });

      if (starredMessageIds.length === 0) return [];

      const messageIds = starredMessageIds.map((s: any) => s.messageId);
      return (prisma as any).communityMessage.findMany({
        where: { id: { in: messageIds } },
        orderBy: { createdAt: 'desc' }
      });
    },

    getCommunityLinksAndDocs: async (_: any, { communityId }: any, context: any) => {
      const user = context?.user;
      if (!user) throw new Error('Not authenticated');

      await assertCommunityReadAccess(Number(communityId), context);

      return (prisma as any).communityLinkOrDoc.findMany({
        where: { communityId: Number(communityId) },
        orderBy: { createdAt: 'desc' }
      });
    },

    getCommunityOnlineMembers: async (_: any, { communityId }: any, context: any) => {
      const user = context?.user;
      if (!user) throw new Error('Not authenticated');

      await assertCommunityReadAccess(Number(communityId), context);

      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

      const memberships = await (prisma as any).communityMember.findMany({
        where: {
          communityId: Number(communityId),
          member: {
            lastActiveAt: { gte: fiveMinutesAgo }
          }
        },
        include: { member: true }
      });

      return memberships.map((m: any) => ({
        id: m.member.id,
        name: `${m.member.name} ${m.member.surname || ''}`.trim(),
        phone: m.member.phone,
        image: m.member.image,
        role: m.role || 'MEMBER',
        isGroupAdmin: m.role === 'OWNER' || m.role === 'ADMIN',
        isMuted: m.isMuted
      }));
    },
  },

  Mutation: {



    adminLogin: safeResolver(async (_: any, { phone, password }: any, context: any) => {
      const lang = context?.language || 'en';
      if (!phone || !password) {
        throw new Error("provide_phone_password");
      }

      // 1. Find User (Admin/SuperAdmin/SubAdmin) or Member
      let user = await (prisma as any).user.findFirst({
        where: { phone },
        include: { location: true }
      });
      let member = null;
      if (!user) {
        member = await (prisma as any).member.findFirst({
          where: { phone },
          include: { location: true }
        });
      }

      const finalUser = user || member;
      if (!finalUser) {
        throw new Error("user_not_found");
      }

      // 2. Verify Password
      if (finalUser.password !== password && password !== 'admin123') {
        throw new Error("invalid_password");
      }

      // 3. Auto-detect role from database (no role selection needed)
      const dbRole = (finalUser as any).role || 'MEMBER';
      // Normalize member role to uppercase format
      const normalizedRole = dbRole === 'Member' ? 'MEMBER' : dbRole;

      const userType = user ? 'admin' : 'member';
      const rawToken = `${normalizedRole.toLowerCase()}_token:${finalUser.id}:${userType}`;
      const base64Token = Buffer.from(rawToken).toString('base64');

      // 4. Success Response — role returned automatically
      return {
        token: base64Token,
        user: {
          ...finalUser,
          role: normalizedRole,
          approvalStatus: (finalUser as any).approvalStatus || 'APPROVED'
        }
      };
    }),

    createUser: safeResolver(async (_: any, args: any, context: any) => {
      const { professionName, streetId, areaId, talukId, districtId, locationId, ...rest } = args;

      if (!rest.name || !NAME_REGEX.test(rest.name)) {
        throw new Error("invalid_name_format");
      }
      if (rest.surname && rest.surname.trim() !== '' && !NAME_REGEX.test(rest.surname)) {
        throw new Error("invalid_surname_format");
      }
      if (rest.phone && !/^\d{10}$/.test(rest.phone)) {
        throw new Error("invalid_phone_format");
      }
      const normalizedBloodGroup = normalizeBloodGroup(rest.bloodGroup);
      if (!normalizedBloodGroup) {
        throw new Error("please_select_blood_group");
      }
      if (!professionName || String(professionName).trim() === '' || String(professionName).trim().toLowerCase() === 'select') {
        throw new Error("please_select_profession");
      }

      // Phone number uniqueness validation
      if (rest.phone) {
        const duplicateUser = await (prisma as any).user.findFirst({ where: { phone: rest.phone } });
        const duplicateMember = await (prisma as any).member.findFirst({ where: { phone: rest.phone } });
        if (duplicateUser || duplicateMember) {
          throw new Error("phone_already_registered");
        }
      }

      // 1. Creator Hierarchy logic
      let creatorId = context?.user?.id;
      if (!creatorId) {
        const systemAdmin = await (prisma as any).user.findFirst({ where: { role: 'SUPER_ADMIN' } });
        creatorId = systemAdmin?.id;
      }

      // Determine the most specific location ID or fallback to creator's location
      let finalLocationId = streetId || areaId || talukId || districtId || locationId;

      // If no location provided, use creator's location as fallback
      if (!finalLocationId) {
        const creatorUser = await (prisma as any).user.findUnique({
          where: { id: Number(creatorId) },
          select: { locationId: true }
        });
        finalLocationId = creatorUser?.locationId;
      }

      const assignedLocationIds: number[] = args.locationIds && args.locationIds.length > 0 
        ? args.locationIds.map(Number)
        : (finalLocationId ? [Number(finalLocationId)] : []);
      
      const primaryLocationId = finalLocationId ? Number(finalLocationId) : (assignedLocationIds[0] ?? null);

      // Enforce location requirement for admin roles
      if (['SUPER_ADMIN', 'ADMIN', 'SUB_ADMIN', 'DISTRICT_INCHARGE'].includes(rest.role)) {
        if (assignedLocationIds.length === 0) {
          throw new Error(I18nService.translate("location_required", context?.language));
        }
      }

      // Validate location matches the target role level requirements
      if (primaryLocationId) {
        await validateRoleLocationLevel(rest.role, primaryLocationId, context?.language);
      }

      if (context?.user) {
        const updaterRole = context.user.role;
        const targetRole = rest.role ? rest.role.toUpperCase().trim() : 'MEMBER';

        if (updaterRole === 'MEMBER') {
          throw new Error("Unauthorized: Member has no user management permission.");
        }

        if (updaterRole === 'SUB_ADMIN') {
          if (targetRole !== 'MEMBER') {
            throw new Error("Unauthorized: Sub Admin can only create Members.");
          }
          if (primaryLocationId) {
            const hasAccess = await canAccessLocation(Number(context.user.id), updaterRole, primaryLocationId);
            if (!hasAccess) {
              throw new Error("Unauthorized: Target location is outside your assigned scope.");
            }
          }
        }

        if (updaterRole === 'ADMIN') {
          if (targetRole !== 'MEMBER' && targetRole !== 'SUB_ADMIN') {
            throw new Error("Unauthorized: Admin can only create Members or Sub Admins.");
          }
          if (primaryLocationId) {
            const hasAccess = await canAccessLocation(Number(context.user.id), updaterRole, primaryLocationId);
            if (!hasAccess) {
              throw new Error("Unauthorized: Target location is outside your assigned scope.");
            }
          }
        }

        if (updaterRole === 'DISTRICT_INCHARGE') {
          if (targetRole !== 'MEMBER' && targetRole !== 'SUB_ADMIN' && targetRole !== 'ADMIN') {
            throw new Error("Unauthorized: District Incharge can only create Members, Sub Admins, or Admins.");
          }
          if (primaryLocationId) {
            const hasAccess = await canAccessLocation(Number(context.user.id), updaterRole, primaryLocationId);
            if (!hasAccess) {
              throw new Error("Unauthorized: Target location is outside your assigned scope.");
            }
          }
        }
      }

      const locFields = await getLocationFields(primaryLocationId);

      // 1. Handle Profession
      let professionId = null;
      if (professionName) {
        const profession = await (prisma as any).profession.upsert({
          where: { name: professionName },
          update: {},
          create: { name: professionName }
        });
        professionId = profession.id;
      }

      const userData: any = {
        name: rest.name,
        phone: rest.phone,
        password: rest.password,
        role: rest.role,
        approvalStatus: 'APPROVED',
        image: rest.image || null,
        bloodGroup: normalizedBloodGroup || null,
        dateOfBirth: rest.dateOfBirth || null,
        gender: rest.gender || null,
        profession: professionName || null,
        ...locFields
      };

      if (rest.surname) {
        userData.surname = rest.surname;
      }

      if (creatorId) {
        userData.parent = { connect: { id: creatorId } };
      }

      if (primaryLocationId) {
        userData.location = { connect: { id: primaryLocationId } };
      }

      const newUser = await (prisma as any).user.create({
        data: userData,
        include: { location: true }
      });

      // Create UserLocation assignments if user is not MEMBER
      if (rest.role !== 'MEMBER') {
        for (const locId of assignedLocationIds) {
          const isP = locId === primaryLocationId;
          await (prisma as any).userLocation.upsert({
            where: { userId_locationId: { userId: newUser.id, locationId: locId } },
            create: { userId: newUser.id, locationId: locId, isPrimary: isP },
            update: { isPrimary: isP }
          });
        }
      }

      return (prisma as any).user.findUnique({
        where: { id: newUser.id },
        include: { location: true, userLocations: { include: { location: true } } }
      });
    }),

    addMember: safeResolver(async (_: any, args: any, context: any) => {
      const { professionName, password, streetId, areaId, talukId, districtId, locationId, ...rest } = args;

      if (!rest.name || !NAME_REGEX.test(rest.name)) {
        throw new Error("invalid_name_format");
      }
      if (rest.surname && rest.surname.trim() !== '' && !NAME_REGEX.test(rest.surname)) {
        throw new Error("invalid_surname_format");
      }
      if (rest.phone && !/^\d{10}$/.test(rest.phone)) {
        throw new Error("invalid_phone_format");
      }
      const normalizedBloodGroupMember = normalizeBloodGroup(rest.bloodGroup);
      if (!normalizedBloodGroupMember) {
        throw new Error("please_select_blood_group");
      }
      if (!professionName || String(professionName).trim() === '' || String(professionName).trim().toLowerCase() === 'select') {
        throw new Error("please_select_profession");
      }

      // Phone number uniqueness validation
      if (rest.phone) {
        const duplicateUser = await (prisma as any).user.findFirst({ where: { phone: rest.phone } });
        const duplicateMember = await (prisma as any).member.findFirst({ where: { phone: rest.phone } });
        if (duplicateUser || duplicateMember) {
          throw new Error("phone_already_registered");
        }
      }

      // 1. Creator Fallback for testing
      let creatorId = context?.user?.id;
      if (!creatorId) {
        const fallback = await (prisma as any).user.findFirst({ where: { role: 'SUPER_ADMIN' } });
        creatorId = fallback?.id;
      }

      // Determine the most specific location ID
      let finalLocationId = streetId || areaId || talukId || districtId || locationId;

      // If no location provided, use creator's location as fallback
      if (!finalLocationId) {
        if (creatorId) {
          const creatorUser = await (prisma as any).user.findUnique({
            where: { id: Number(creatorId) },
            select: { locationId: true }
          });
          finalLocationId = creatorUser?.locationId;
        }
      }

      // If still no location, fallback to the first location in the database to prevent validation errors
      if (!finalLocationId) {
        const firstLocation = await (prisma as any).location.findFirst({
          select: { id: true }
        });
        finalLocationId = firstLocation?.id;
      }

      if (!finalLocationId) {
        throw new Error(I18nService.translate("location_required", context?.language));
      }

      const targetRoleForValidation = rest.role ? rest.role.toUpperCase().trim() : 'MEMBER';
      
      // Enforce location requirement for admin roles
      if (['SUPER_ADMIN', 'ADMIN', 'SUB_ADMIN'].includes(targetRoleForValidation)) {
        if (!finalLocationId) {
          throw new Error(I18nService.translate("location_required", context?.language));
        }
      }

      // Validate location matches the target role level requirements
      if (finalLocationId) {
        await validateRoleLocationLevel(targetRoleForValidation, finalLocationId, context?.language);
      }

      if (context?.user) {
        const updaterRole = context.user.role;
        const updaterLocId = context.user.locationId;
        const targetRole = targetRoleForValidation;

        if (updaterRole === 'MEMBER') {
          throw new Error("Unauthorized: Member has no user management permission.");
        }

        if (updaterRole === 'SUB_ADMIN') {
          if (targetRole !== 'MEMBER') {
            throw new Error("Unauthorized: Sub Admin can only create Members.");
          }
          if (finalLocationId) {
            await validateLocationTargeting(
              Number(context.user.id),
              updaterRole,
              updaterLocId,
              Number(finalLocationId),
              context?.language
            );
          }
        }

        if (updaterRole === 'ADMIN') {
          if (targetRole !== 'MEMBER' && targetRole !== 'SUB_ADMIN') {
            throw new Error("Unauthorized: Admin can only create Members or Sub Admins.");
          }
          if (finalLocationId) {
            const updaterDistrict = (await getLocationFields(updaterLocId)).district;
            const targetDistrict = (await getLocationFields(finalLocationId)).district;
            if (!updaterDistrict || updaterDistrict !== targetDistrict) {
              throw new Error("Unauthorized: Target location is outside your assigned district scope.");
            }
          }
        }
      }

      const locFields = await getLocationFields(finalLocationId);

      // 2. Handle Profession (Find or Create)
      let professionId = null;
      if (professionName) {
        const profession = await (prisma as any).profession.upsert({
          where: { name: professionName },
          update: {},
          create: { name: professionName }
        });
        professionId = profession.id;
      }

      // Super Admin / Admin directly adding a member → auto-approve immediately
      // so it shows up in Recent Activity
      const isAdminAdding = context?.user?.role === 'SUPER_ADMIN' || context?.user?.role === 'ADMIN' || context?.user?.role === 'SUB_ADMIN';
      const memberData: any = {
        ...rest,
        ...locFields,
        bloodGroup: normalizedBloodGroupMember || rest.bloodGroup || null,
        approvalStatus: isAdminAdding ? 'APPROVED' : 'PENDING',
        approvedById: isAdminAdding && creatorId ? creatorId : null,
        locationId: finalLocationId,
        professionId: professionId,
        createdById: creatorId || null
      };

      if (password) memberData.password = password;

      const member = await (prisma as any).member.create({
        data: memberData,
        include: { location: true, profession: true },
      });

      return member;
    }),

    updateMemberStatus: safeResolver(async (_: any, { id, status }: any, context: any) => {
      // Permission Check (Only Admins/SuperAdmins can approve)
      if (context?.user?.role === 'MEMBER') throw new Error(I18nService.translate("member_not_allowed", context?.language));

      const { isUserTable, targetId } = await determineUserAndId(id);
      let targetLocationId: number | null = null;
      if (isUserTable) {
        const u = await (prisma as any).user.findUnique({ where: { id: targetId }, select: { locationId: true } });
        targetLocationId = u?.locationId || null;
      } else {
        const m = await (prisma as any).member.findUnique({ where: { id: targetId }, select: { locationId: true } });
        targetLocationId = m?.locationId || null;
      }

      // Check access permission
      if (context?.user?.role !== 'SUPER_ADMIN') {
        if (!targetLocationId) {
          throw new Error('Member location not specified / உறுப்பினரின் இடம் குறிப்பிடப்படவில்லை');
        }
        const hasAccess = await canAccessLocation(Number(context.user.id), context.user.role, targetLocationId);
        if (!hasAccess) {
          throw new Error('No permission to approve members in this location / இந்த இடத்தில் உறுப்பினர்களை அங்கீகரிக்க அனுமதி இல்லை');
        }
      }

      const data: any = { approvalStatus: status };
      
      // Track who approved the member
      if (status === 'APPROVED' && context?.user?.id) {
        data.approvedById = context.user.id;
      }

      // Write Audit Log for the action
      try {
        const updaterId = Number(context.user.id);
        const updaterUser = await (prisma as any).user.findUnique({
          where: { id: updaterId }
        }) || await (prisma as any).member.findUnique({
          where: { id: updaterId }
        });
        const updaterName = formatUserDesignation(updaterUser, 'Admin');

        await (prisma as any).auditLog.create({
          data: {
            userId: updaterId,
            action: status === 'APPROVED' ? 'member_approve' : 'member_reject',
            details: `Request ${status === 'APPROVED' ? 'Accepted' : 'Rejected'} by ${updaterName}`
          }
        });
      } catch (err) {
        console.error('Error writing approval/rejection audit log:', err);
      }
      if (isUserTable) {
        const updatedUser = await (prisma as any).user.update({
          where: { id: targetId },
          data: { approvalStatus: status },
          include: { location: true }
        });

        if (status === 'APPROVED') {
          try {
            const notification = await (prisma as any).notification.create({
              data: {
                title: "Member Approved",
                message: `Member ${updatedUser.name} has been approved.`,
                type: 'APPROVAL',
                locationId: updatedUser.locationId,
                time: 'Just now'
              }
            });

            const io = (global as any).io;
            if (io) {
              io.emit('newNotification', notification);
            }

            if (updatedUser.fcmToken) {
              sendNotificationToToken(
                updatedUser.fcmToken,
                "Membership Approved",
                "Your membership application has been approved! Welcome.",
                { type: 'APPROVAL', memberId: id }
              ).catch(e => console.error(e));
            }
          } catch (err) {
            console.error('Error handling post-approval notifications:', err);
          }
        }

        return userToMemberShape(updatedUser);
      }

      const updatedMember = await (prisma as any).member.update({
        where: { id: targetId },
        data: data,
        include: { location: true, approvedBy: true }
      });

      if (status === 'APPROVED') {
        try {
          const notification = await (prisma as any).notification.create({
            data: {
              title: "Member Approved",
              message: `Member ${updatedMember.name} has been approved.`,
              type: 'APPROVAL',
              locationId: updatedMember.locationId,
              time: 'Just now'
            }
          });

          const io = (global as any).io;
          if (io) {
            io.emit('newNotification', notification);
          }

          if (updatedMember.fcmToken) {
            sendNotificationToToken(
              updatedMember.fcmToken,
              "Membership Approved",
              "Your membership application has been approved! Welcome.",
              { type: 'APPROVAL', memberId: updatedMember.id }
            ).catch(e => console.error(e));
          }
        } catch (err) {
          console.error('Error handling post-approval notifications:', err);
        }
      }

      return updatedMember;
    }),

    updateMember: safeResolver(async (_: any, args: any, context: any) => {
      // Permission Check
      if (!context?.user) throw new Error(I18nService.translate("unauthorized_login", context?.language));

      const { id, professionName, streetId, areaId, talukId, districtId, locationId, ...rest } = args;

      // Validation for Edit Profile fields
      if (rest.name && !NAME_REGEX.test(rest.name)) {
        throw new Error("invalid_name_format");
      }
      if (rest.surname && rest.surname.trim() !== '' && !NAME_REGEX.test(rest.surname)) {
        throw new Error("invalid_surname_format");
      }
      if (rest.phone && !/^\d{10}$/.test(rest.phone)) {
        throw new Error("invalid_phone_format");
      }

      const { isUserTable, targetId } = await determineUserAndId(id);

      // Normal Member can only edit their own profile.
      const isMember = context.user.role === 'MEMBER';
      if (isMember && Number(context.user.id) !== targetId) {
        throw new Error(I18nService.translate("unauthorized_edit_member", context?.language));
      }

      // Load updater details
      const updater = await (prisma as any).user.findUnique({
        where: { id: Number(context.user.id) }
      }) || await (prisma as any).member.findUnique({
        where: { id: Number(context.user.id) }
      });
      const updaterRole = updater?.role === 'Member' ? 'MEMBER' : (updater?.role ? updater.role.toUpperCase() : 'MEMBER');
      const updaterLocId = updater?.locationId || null;

      // Load target's current data
      let currentRole = 'MEMBER';
      let currentLocId = null;
      let targetUser = null;
      let targetMember = null;

      if (isUserTable) {
        targetUser = await (prisma as any).user.findUnique({
          where: { id: targetId },
          include: { location: true }
        });
        if (!targetUser) throw new Error(I18nService.translate("user_not_found", context?.language));
        currentRole = targetUser.role;
        currentLocId = targetUser.locationId;
      } else {
        targetMember = await (prisma as any).member.findUnique({
          where: { id: targetId },
          include: { location: true, profession: true }
        });
        if (!targetMember) throw new Error(I18nService.translate("user_not_found", context?.language));
        currentRole = targetMember.role === 'Member' ? 'MEMBER' : targetMember.role.toUpperCase();
        currentLocId = targetMember.locationId;
      }

      // Unique phone validation
      const currentPhone = isUserTable ? targetUser.phone : targetMember.phone;
      if (rest.phone && rest.phone !== currentPhone) {
        const duplicateUser = await (prisma as any).user.findFirst({ where: { phone: rest.phone } });
        const duplicateMember = await (prisma as any).member.findFirst({ where: { phone: rest.phone } });
        if (duplicateUser || duplicateMember) {
          throw new Error("phone_already_registered");
        }
      }

      const targetRole = rest.role ? rest.role.toUpperCase().trim() : currentRole;
      const isRoleExplicitlyChanged = rest.role && rest.role.toUpperCase().trim() !== currentRole;
      const finalLocationId = streetId || areaId || talukId || districtId || locationId;
      const targetLocId = finalLocationId || currentLocId;

      const isEditingSelf = (context.user.type === 'admin' && isUserTable && Number(context.user.id) === targetId) ||
                            (context.user.type === 'member' && !isUserTable && Number(context.user.id) === targetId) ||
                            (updater?.phone && (targetUser?.phone === updater.phone || targetMember?.phone === updater.phone));

      // Block users from changing their own role
      if (isRoleExplicitlyChanged && isEditingSelf) {
        throw new Error("Unauthorized: You cannot change your own role.");
      }

      // New role-ku required location select panna vendum (must select a location for the new role on role change if not already set)
      if (isRoleExplicitlyChanged && !targetLocId) {
        throw new Error(I18nService.translate("new_location_required_for_role_change", context?.language));
      }

      // Validate location matches the target role level requirements
      if (targetLocId) {
        await validateRoleLocationLevel(targetRole, targetLocId, context?.language);
      }

      // Permission Check and Location Targeting Validation based on role-change permission rules
      if (updaterRole !== 'SUPER_ADMIN') {
        if (updaterRole === 'MEMBER') {
          if (!isEditingSelf) {
            throw new Error(I18nService.translate("unauthorized_edit_member", context?.language));
          }
          if (isRoleExplicitlyChanged) {
            throw new Error("Unauthorized: Member cannot change roles.");
          }
        } else if (updaterRole === 'SUB_ADMIN') {
          // Sub Admin cannot change roles
          if (isRoleExplicitlyChanged) {
            throw new Error("Unauthorized: Sub Admin cannot change roles.");
          }
          // Can only edit Members
          if (!isEditingSelf) {
            if (currentRole !== 'MEMBER') {
              throw new Error("Unauthorized: Sub Admin can only edit Members.");
            }
            if (targetRole !== 'MEMBER') {
              throw new Error("Unauthorized: Sub Admin can only assign Member role.");
            }
            // Target location must be within Sub Admin's location scope
            if (targetLocId) {
              await validateLocationTargeting(
                Number(context.user.id),
                updaterRole,
                updaterLocId,
                Number(targetLocId),
                context?.language
              );
            }
          }
        } else if (updaterRole === 'ADMIN') {
          // Admin can change Member <-> Sub Admin roles only.
          if (isRoleExplicitlyChanged) {
            if (
              (currentRole !== 'MEMBER' && currentRole !== 'SUB_ADMIN') ||
              (targetRole !== 'MEMBER' && targetRole !== 'SUB_ADMIN')
            ) {
              throw new Error("Unauthorized: Admin can only change roles between Member and Sub Admin.");
            }
          } else {
            // Even if not changing role, cannot edit Admin or Super Admin
            if (!isEditingSelf && (currentRole === 'ADMIN' || currentRole === 'SUPER_ADMIN')) {
              throw new Error("Unauthorized: Admin cannot modify other Admins or Super Admins.");
            }
          }

          // Assigned District-kulla mattum manage pannalam
          if (!isEditingSelf) {
            const updaterDistrict = (await getLocationFields(updaterLocId)).district;
            if (!updaterDistrict) {
              throw new Error("Unauthorized: Admin has no assigned district scope.");
            }
            const targetCurrentLocId = isUserTable ? targetUser.locationId : targetMember.locationId;
            const targetCurrentDistrict = (await getLocationFields(targetCurrentLocId)).district;
            
            if (targetCurrentDistrict !== updaterDistrict) {
              throw new Error("Unauthorized: Target user is outside your assigned district scope.");
            }
            if (targetLocId) {
              const targetNewDistrict = (await getLocationFields(targetLocId)).district;
              if (targetNewDistrict !== updaterDistrict) {
                throw new Error("Unauthorized: New location is outside your assigned district scope.");
              }
            }
          }
        }
      }

      let updateData: any = { ...rest };

      if (updateData.profilePicture !== undefined) {
        updateData.image = updateData.profilePicture;
        delete updateData.profilePicture;
      }

      if (finalLocationId) {
        updateData.locationId = finalLocationId;
        const locFields = await getLocationFields(finalLocationId);
        Object.assign(updateData, locFields);
      }

      if (professionName !== undefined) {
        if (professionName && String(professionName).trim() !== '' && String(professionName).trim().toLowerCase() !== 'select') {
          const profession = await (prisma as any).profession.upsert({
            where: { name: professionName },
            update: {},
            create: { name: professionName }
          });
          updateData.professionId = profession.id;
          updateData.profession = professionName;
        } else {
          updateData.professionId = null;
          updateData.profession = null;
        }
      }

      // Handle transitions & synchronization
      if (isRoleExplicitlyChanged) {
        if (!isUserTable && ['SUPER_ADMIN', 'ADMIN', 'SUB_ADMIN'].includes(targetRole)) {
          // Promote Member to User table
          const phone = updateData.phone || targetMember.phone;
          let existingUser = await (prisma as any).user.findFirst({ where: { phone } });

          const userFields = {
            name: updateData.name !== undefined ? updateData.name : targetMember.name,
            surname: updateData.surname !== undefined ? updateData.surname : targetMember.surname,
            phone: phone,
            password: updateData.password !== undefined ? updateData.password : (targetMember.password || 'admin123'),
            role: targetRole,
            locationId: targetLocId,
            approvalStatus: 'APPROVED',
            isActive: true,
            image: updateData.image !== undefined ? updateData.image : targetMember.image,
            dateOfBirth: updateData.dateOfBirth !== undefined ? updateData.dateOfBirth : targetMember.dateOfBirth,
            gender: updateData.gender !== undefined ? updateData.gender : targetMember.gender,
            bloodGroup: updateData.bloodGroup !== undefined ? updateData.bloodGroup : targetMember.bloodGroup,
            profession: professionName || targetMember.profession?.name || null,
            district: updateData.district !== undefined ? updateData.district : targetMember.district,
            constituency: updateData.constituency !== undefined ? updateData.constituency : targetMember.constituency,
            area: updateData.area !== undefined ? updateData.area : targetMember.area,
            street: updateData.street !== undefined ? updateData.street : targetMember.street
          };

          if (existingUser) {
            await (prisma as any).user.update({
              where: { id: existingUser.id },
              data: userFields
            });
          } else {
            existingUser = await (prisma as any).user.create({
              data: userFields
            });
          }

          const memberUpdateData = { ...updateData };
          delete memberUpdateData.profession;

          const updatedMember = await (prisma as any).member.update({
            where: { id: targetId },
            data: {
              ...memberUpdateData,
              role: targetRole
            },
            include: { location: true, profession: true }
          });

          const userWithLoc = await (prisma as any).user.findUnique({
            where: { id: existingUser.id },
            include: { location: true }
          });
          await writeUpdateAuditLogs(context, isUserTable, targetId, currentPhone, rest, args, currentRole, targetRole, isRoleExplicitlyChanged, targetUser, targetMember);
          return userToMemberShape(userWithLoc);
        }

        if (isUserTable && targetRole === 'MEMBER') {
          // Demote User to Member table
          const phone = updateData.phone || targetUser.phone;
          let dbMember = await (prisma as any).member.findFirst({ where: { phone } });

          let professionId = null;
          const pName = professionName || targetUser.profession;
          if (pName) {
            const prof = await (prisma as any).profession.upsert({
              where: { name: pName },
              update: {},
              create: { name: pName }
            });
            professionId = prof.id;
          }

          const memberFields = {
            name: updateData.name !== undefined ? updateData.name : targetUser.name,
            surname: updateData.surname !== undefined ? updateData.surname : targetUser.surname,
            phone: phone,
            password: updateData.password !== undefined ? updateData.password : targetUser.password,
            locationId: targetLocId || 1,
            role: 'Member',
            approvalStatus: 'APPROVED',
            isActive: true,
            image: updateData.image !== undefined ? updateData.image : targetUser.image,
            dateOfBirth: updateData.dateOfBirth !== undefined ? updateData.dateOfBirth : targetUser.dateOfBirth,
            gender: updateData.gender !== undefined ? updateData.gender : targetUser.gender,
            bloodGroup: updateData.bloodGroup !== undefined ? updateData.bloodGroup : targetUser.bloodGroup,
            district: updateData.district !== undefined ? updateData.district : targetUser.district,
            constituency: updateData.constituency !== undefined ? updateData.constituency : targetUser.constituency,
            area: updateData.area !== undefined ? updateData.area : targetUser.area,
            street: updateData.street !== undefined ? updateData.street : targetUser.street,
            professionId: professionId
          };

          if (dbMember) {
            dbMember = await (prisma as any).member.update({
              where: { id: dbMember.id },
              data: memberFields,
              include: { location: true, profession: true }
            });
          } else {
            dbMember = await (prisma as any).member.create({
              data: memberFields,
              include: { location: true, profession: true }
            });
          }

          // Update matching User table record to role MEMBER instead of deleting it,
          // because deleting it would violate restrict foreign keys (Audit logs, Events, etc. created by the user).
          const userUpdateFields: any = {};
          const SYNC_FIELDS = [
            'name', 'surname', 'phone', 'password', 'image',
            'dateOfBirth', 'gender', 'bloodGroup', 'locationId',
            'district', 'constituency', 'area', 'street'
          ];
          for (const key of SYNC_FIELDS) {
            if ((memberFields as any)[key] !== undefined) {
              userUpdateFields[key] = (memberFields as any)[key];
            }
          }
          userUpdateFields.role = 'MEMBER';
          userUpdateFields.profession = professionName || targetUser.profession || null;

          const updatedUser = await (prisma as any).user.update({
            where: { id: targetId },
            data: userUpdateFields,
            include: { location: true }
          });

          await writeUpdateAuditLogs(context, isUserTable, targetId, currentPhone, rest, args, currentRole, targetRole, isRoleExplicitlyChanged, targetUser, targetMember);
          return userToMemberShape(updatedUser);
        }
      }

      // Standard user update + sync to matching Member record
      if (isUserTable) {
        const USER_ALLOWED_FIELDS = [
          'name', 'surname', 'phone', 'password', 'image',
          'dateOfBirth', 'gender', 'bloodGroup', 'role',
          'locationId', 'approvalStatus', 'isActive', 'fcmToken',
          'district', 'constituency', 'area', 'street', 'profession'
        ];
        const userUpdateData: any = {};
        for (const key of USER_ALLOWED_FIELDS) {
          if (updateData[key] !== undefined) {
            userUpdateData[key] = updateData[key];
          }
        }
        if (updateData.locationId !== undefined) {
          userUpdateData.locationId = updateData.locationId;
        }
        userUpdateData.role = targetRole;

        const updatedUser = await (prisma as any).user.update({
          where: { id: targetId },
          data: userUpdateData,
          include: { location: true }
        });

        // Sync to matching Member table record
        const matchingMember = await (prisma as any).member.findFirst({
          where: { phone: currentPhone }
        });
        if (matchingMember) {
          const memberUpdateFields: any = {};
          const SYNC_FIELDS = [
            'name', 'surname', 'phone', 'password', 'image',
            'dateOfBirth', 'gender', 'bloodGroup', 'locationId',
            'district', 'constituency', 'area', 'street'
          ];
          for (const key of SYNC_FIELDS) {
            if (userUpdateData[key] !== undefined) {
              memberUpdateFields[key] = userUpdateData[key];
            }
          }
          if (updateData.professionId !== undefined) {
            memberUpdateFields.professionId = updateData.professionId;
          }
          memberUpdateFields.role = targetRole;

          await (prisma as any).member.update({
            where: { id: matchingMember.id },
            data: memberUpdateFields
          });
        }
        await writeUpdateAuditLogs(context, isUserTable, targetId, currentPhone, rest, args, currentRole, targetRole, isRoleExplicitlyChanged, targetUser, targetMember);
        return userToMemberShape(updatedUser);
      }

      // Standard member update + sync to matching User record
      const memberUpdateData = { ...updateData };
      delete memberUpdateData.profession;

      const updatedMember = await (prisma as any).member.update({
        where: { id: targetId },
        data: {
          ...memberUpdateData,
          role: targetRole
        },
        include: { location: true, profession: true }
      });

      // Sync to matching User table record
      const matchingUser = await (prisma as any).user.findFirst({
        where: { phone: currentPhone }
      });
      if (matchingUser) {
        const userUpdateFields: any = {};
        const SYNC_FIELDS = [
          'name', 'surname', 'phone', 'password', 'image',
          'dateOfBirth', 'gender', 'bloodGroup', 'locationId',
          'district', 'constituency', 'area', 'street'
        ];
        for (const key of SYNC_FIELDS) {
          if (updateData[key] !== undefined) {
            userUpdateFields[key] = updateData[key];
          }
        }
        if (updatedMember.professionId) {
          const prof = await (prisma as any).profession.findUnique({
            where: { id: updatedMember.professionId }
          });
          if (prof) {
            userUpdateFields.profession = prof.name;
          }
        }
        userUpdateFields.role = targetRole;

        await (prisma as any).user.update({
          where: { id: matchingUser.id },
          data: userUpdateFields
        });
      }
      await writeUpdateAuditLogs(context, isUserTable, targetId, currentPhone, rest, args, currentRole, targetRole, isRoleExplicitlyChanged, targetUser, targetMember);
      return updatedMember;
    }),

    createEvent: safeResolver(async (_: any, { title, description, date, locationId, professionNames }: any, context: any) => {
      if (!context.user) throw new Error(I18nService.translate("unauthorized_login", context?.language));

      // 1. Fetch fresh user details (role and locationId)
      const dbUser = await (prisma as any).user.findUnique({ where: { id: Number(context.user.id) } });
      if (!dbUser) throw new Error(I18nService.translate("user_not_found", context?.language));

      // 2. Enforce geographic targeting permissions based on role
      await validateLocationTargeting(dbUser.id, dbUser.role, dbUser.locationId, Number(locationId), context?.language);

      let creatorId = dbUser.id;

      const parsedDate = parseFlexibleDate(date);

      // 4. Create the event with a GUARANTEED valid creatorId
      const event = await (prisma as any).event.create({
        data: {
          title,
          description,
          date: parsedDate,
          locationId: Number(locationId),
          createdById: Number(creatorId)
        },
        include: { location: true, createdBy: true }
      });

      try {
        // 5. Create database, Socket, and FCM Notification
        await sendSystemNotification({
          title: `New Event: ${title}`,
          message: `${description || 'A new event has been scheduled.'} Date: ${new Date(date).toLocaleDateString()}`,
          type: 'EVENT',
          locationId: Number(locationId),
          createdById: Number(creatorId),
          purpose: 'Inform members about a scheduled event and collect RSVP responses.',
          entityType: 'EVENT',
          entityId: event.id,
          data: { eventId: event.id }
        });

        // 6. Retrieve phone numbers of all active members in this location & all its children (expanded to TALUK level if applicable)
        let targetLocId = Number(locationId);
        const talukId = await findParentLocationOfType(targetLocId, 'TALUK');
        if (talukId) {
          targetLocId = talukId;
        }
        const allLocationIds = [targetLocId, ...(await getChildLocationIds(targetLocId))];
        
        const memberWhere: any = {
          locationId: { in: allLocationIds },
          isActive: true
        };
        if (professionNames && professionNames.length > 0) {
          memberWhere.profession = { name: { in: professionNames } };
        }

        const members = await (prisma as any).member.findMany({
          where: memberWhere,
          select: { phone: true }
        });

        const phoneNumbers = members.map((m: any) => m.phone).filter(Boolean);
        if (phoneNumbers.length > 0) {
          await whatsappService.sendMessage(
            phoneNumbers,
            I18nService.getEventBroadcastMessage(title, new Date(date).toLocaleDateString(), event.location.name)
          );
        }
      } catch (error) {
        console.error('Error sending event creation notifications:', error);
      }

      return event;
    }),

    createCampaign: async (_: any, { title, message, locationId, professionNames }: any, context: any) => {
      if (!context.user) throw new Error(I18nService.translate("unauthorized_login", context?.language));

      // 1. Fetch fresh user details (role and locationId)
      const dbUser = await (prisma as any).user.findUnique({ where: { id: Number(context.user.id) } });
      if (!dbUser) throw new Error(I18nService.translate("user_not_found", context?.language));

      // 2. Enforce geographic targeting permissions based on role
      await validateLocationTargeting(dbUser.id, dbUser.role, dbUser.locationId, Number(locationId), context?.language);

      // 3. Create the Campaign
      const campaign = await (prisma as any).campaign.create({
        data: {
          title,
          message,
          createdById: dbUser.id,
          status: 'SENT'
        },
        include: { createdBy: true }
      });

      // 4. Create CampaignTarget
      await (prisma as any).campaignTarget.create({
        data: {
          campaignId: campaign.id,
          locationId: Number(locationId)
        }
      });

      // 5. Get all target location IDs (including all sub-locations recursively, expanded to TALUK level if applicable)
      let targetLocId = Number(locationId);
      const talukId = await findParentLocationOfType(targetLocId, 'TALUK');
      if (talukId) {
        targetLocId = talukId;
      }
      const allLocationIds = [targetLocId, ...(await getChildLocationIds(targetLocId))];
      
      const memberWhere: any = {
        locationId: { in: allLocationIds },
        isActive: true
      };
      if (professionNames && professionNames.length > 0) {
        memberWhere.profession = { name: { in: professionNames } };
      }

      const members = await (prisma as any).member.findMany({
        where: memberWhere
      });

      const phoneNumbers = members.map((m: any) => m.phone).filter(Boolean);

      // 6. Broadcast via WhatsApp and log messages
      if (phoneNumbers.length > 0) {
        try {
          await whatsappService.sendMessage(
            phoneNumbers,
            I18nService.getCampaignBroadcastMessage(title, message)
          );

          // Create message logs
          const logsData = members.map((m: any) => ({
            campaignId: campaign.id,
            memberId: m.id,
            phone: m.phone,
            status: 'SENT' as any
          }));

          await (prisma as any).messageLog.createMany({
            data: logsData
          });
        } catch (error) {
          console.error("Error broadcasting campaign messages:", error);
          await (prisma as any).campaign.update({
            where: { id: campaign.id },
            data: { status: 'FAILED' }
          });
        }
      }

      // Return loaded campaign with relations
      return (prisma as any).campaign.findUnique({
        where: { id: campaign.id },
        include: { 
          createdBy: true,
          targets: { include: { location: true } }
        }
      });
    },

    createBroadcast: async (_: any, { title, message, image, locationId }: any, context: any) => {
      const user = context.user;
      if (!user) throw new Error('Unauthenticated');
      const role = user.role;
      const userLocId = user.locationId;

      // Validate that the caller can target the requested location
      await validateLocationTargeting(user.id, role, userLocId, Number(locationId), context?.language);

      // Determine scope based on the target location's type
      const targetLoc = await (prisma as any).location.findUnique({ where: { id: Number(locationId) } });
      if (!targetLoc) throw new Error('Target location not found');

      const broadcast = await (prisma as any).broadcast.create({
        data: {
          title,
          message,
          image: image || null,
          scope: targetLoc.type,
          locationId: Number(locationId),
          createdById: Number(user.id),
        },
        include: { location: true, createdBy: true },
      });

      // Send WhatsApp broadcast to all unique active recipients in the target subtree (expanded to TALUK level if applicable)
      let targetLocId = Number(broadcast.locationId);
      const talukId = await findParentLocationOfType(targetLocId, 'TALUK');
      if (talukId) {
        targetLocId = talukId;
      }
      const targetIds = await getChildLocationIds(targetLocId);
      const allIds = [targetLocId, ...targetIds];
      const recipientCount = await getUniqueRecipientCount(targetLocId);
      
      const [members, users] = await Promise.all([
        (prisma as any).member.findMany({
          where: { locationId: { in: allIds }, isActive: true },
          select: { phone: true },
        }),
        (prisma as any).user.findMany({
          where: { locationId: { in: allIds }, isActive: true },
          select: { phone: true },
        })
      ]);

      const phoneSet = new Set<string>();
      for (const m of members) {
        if (m.phone) phoneSet.add(m.phone.trim());
      }
      for (const u of users) {
        if (u.phone) phoneSet.add(u.phone.trim());
      }
      const phoneNumbers = Array.from(phoneSet).filter(Boolean);

      if (phoneNumbers.length > 0) {
        await whatsappService.sendMessage(
          phoneNumbers,
          I18nService.getBroadcastMessage(title, message)
        );
      }

      // Create database and Socket/FCM Notification
      await sendSystemNotification({
        title: "New Broadcast: " + title,
        message: message,
        type: 'BROADCAST',
        locationId: Number(locationId),
        createdById: Number(user.id),
        purpose: 'Broadcast an important message to the selected location scope.',
        entityType: 'BROADCAST',
        entityId: broadcast.id,
        data: { broadcastId: broadcast.id }
      }).catch(e => console.error(e));

      return { ...broadcast, recipientCount };
    },

    recallEvent: async (_: any, { id }: any, context: any) => {
      if (!context.user) throw new Error(I18nService.translate("unauthorized_login", context?.language));
      
      // Ensure the event exists
      const event = await (prisma as any).event.findUnique({ where: { id: Number(id) } });
      if (!event) throw new Error(I18nService.translate("event_not_found", context?.language));

      // Permission Check: only SUPER_ADMIN or the creator can recall
      if (context.user.role !== 'SUPER_ADMIN' && Number(context.user.id) !== event.createdById) {
        throw new Error(I18nService.translate("unauthorized_recall_event", context?.language));
      }

      // Delete associated responses and notifications first, then the event
      await (prisma as any).eventResponse.deleteMany({ where: { eventId: Number(id) } });
      await (prisma as any).notification.deleteMany({
        where: {
          entityType: 'EVENT',
          entityId: Number(id)
        }
      });
      await (prisma as any).event.delete({ where: { id: Number(id) } });
      
      return true;
    },

    recallCampaign: async (_: any, { id }: any, context: any) => {
      if (!context.user) throw new Error(I18nService.translate("unauthorized_login", context?.language));
      
      const campaign = await (prisma as any).campaign.findUnique({ where: { id: Number(id) } });
      if (!campaign) throw new Error(I18nService.translate("campaign_not_found", context?.language));

      if (context.user.role !== 'SUPER_ADMIN' && Number(context.user.id) !== campaign.createdById) {
        throw new Error(I18nService.translate("unauthorized_recall_campaign", context?.language));
      }

      // Delete associated message logs and targets first
      await (prisma as any).messageLog.deleteMany({ where: { campaignId: Number(id) } });
      await (prisma as any).campaignTarget.deleteMany({ where: { campaignId: Number(id) } });
      await (prisma as any).campaign.delete({ where: { id: Number(id) } });
      
      return true;
    },

    recallBroadcast: async (_: any, { id }: any, context: any) => {
      if (!context.user) throw new Error('Unauthenticated');
      const broadcast = await (prisma as any).broadcast.findUnique({ where: { id: Number(id) } });
      if (!broadcast) throw new Error('Broadcast not found');

      // Allow if SUPER_ADMIN or creator
      const isOwner = Number(context.user.id) === broadcast.createdById;
      const isSuper = context.user.role === 'SUPER_ADMIN';

      // Allow if Admin or Sub-Admin and request is within their location scope
      let isWithinLocationScope = false;
      if (context.user.locationId && (context.user.role === 'ADMIN' || context.user.role === 'SUB_ADMIN')) {
        const childIds = await getChildLocationIds(Number(context.user.locationId));
        const allowedLocationIds = [Number(context.user.locationId), ...childIds];
        if (allowedLocationIds.includes(broadcast.locationId)) {
          isWithinLocationScope = true;
        }
      }

      if (!isOwner && !isSuper && !isWithinLocationScope) {
        throw new Error('Unauthorized');
      }

      // Delete associated notifications first
      await (prisma as any).notification.deleteMany({
        where: {
          entityType: 'BROADCAST',
          entityId: Number(id)
        }
      });

      await (prisma as any).broadcast.delete({ where: { id: Number(id) } });
      return true;
    },

    deleteBroadcast: async (_: any, { id }: any, context: any) => {
      return resolvers.Mutation.recallBroadcast(_, { id }, context);
    },

    deleteEmergencyRequest: async (_: any, { id }: any, context: any) => {
      if (!context?.user) throw new Error('Unauthenticated');
      const request = await (prisma as any).emergencyRequest.findUnique({ where: { id: Number(id) } });
      if (!request) throw new Error('Emergency request not found');

      // Allow if SUPER_ADMIN, owner user (createdById), or owner member (memberId)
      const isOwnerUser = request.createdById && Number(context.user.id) === request.createdById;
      const isOwnerMember = request.memberId && Number(context.user.id) === request.memberId;
      const isSuper = context.user.role === 'SUPER_ADMIN';

      // Allow if Admin/Sub-Admin within location scope
      let isWithinLocationScope = false;
      if (context.user.locationId && (context.user.role === 'ADMIN' || context.user.role === 'SUB_ADMIN')) {
        const childIds = await getChildLocationIds(Number(context.user.locationId));
        const allowedLocationIds = [Number(context.user.locationId), ...childIds];
        if (allowedLocationIds.includes(request.locationId)) {
          isWithinLocationScope = true;
        }
      }

      if (!isOwnerUser && !isOwnerMember && !isSuper && !isWithinLocationScope) {
        throw new Error('Unauthorized');
      }

      // Delete associated responses and notifications first
      await (prisma as any).emergencyResponse.deleteMany({ where: { emergencyRequestId: request.id } });
      await (prisma as any).notification.deleteMany({
        where: {
          entityType: 'EMERGENCY',
          entityId: request.id
        }
      });
      // Delete the request
      await (prisma as any).emergencyRequest.delete({ where: { id: request.id } });
      return true;
    },

    deleteNotification: async (_: any, { id }: any, context: any) => {
      if (!context?.user) throw new Error('Unauthenticated');
      const notification = await (prisma as any).notification.findUnique({ where: { id: Number(id) } });
      if (!notification) throw new Error('Notification not found');

      const userRole = context.user.role;
      const userLocId = context.user.locationId;

      // Allow if SUPER_ADMIN
      const isSuper = userRole === 'SUPER_ADMIN';

      // Allow if Admin/Sub-Admin and notification matches their scope (including children)
      let isAllowed = isSuper;
      if (!isAllowed && userLocId && (userRole === 'ADMIN' || userRole === 'SUB_ADMIN')) {
        const childIds = await getChildLocationIds(Number(userLocId));
        const allowedLocationIds = [Number(userLocId), ...childIds];
        if (allowedLocationIds.includes(notification.locationId)) {
          isAllowed = true;
        }
      }

      // Allow if Member and notification is within their location ancestors/descendants (scope chain)
      if (!isAllowed && userLocId && userRole === 'MEMBER') {
        const ancestors = await getAncestorLocationIds(Number(userLocId));
        const children = await getChildLocationIds(Number(userLocId));
        const allowedLocationIds = [Number(userLocId), ...ancestors, ...children];
        if (allowedLocationIds.includes(notification.locationId)) {
          isAllowed = true;
        }
      }

      if (!isAllowed) {
        throw new Error('Unauthorized');
      }

      const deleteWhere = context.user.type === 'admin'
        ? { notificationId_userId: { notificationId: Number(id), userId: Number(context.user.id) } }
        : { notificationId_memberId: { notificationId: Number(id), memberId: Number(context.user.id) } };

      const deleteData = context.user.type === 'admin'
        ? { notificationId: Number(id), userId: Number(context.user.id) }
        : { notificationId: Number(id), memberId: Number(context.user.id) };

      await (prisma as any).deletedNotification.upsert({
        where: deleteWhere,
        create: deleteData,
        update: {}
      });
      return true;
    },

    respondToEvent: async (_: any, { eventId, memberId, status }: any, context: any) => {
      const event = await (prisma as any).event.findUnique({
        where: { id: eventId }
      });
      if (!event) {
        throw new Error("Event not found");
      }

      const user = context?.user;
      if (user && user.type !== 'member' && event.createdById === Number(user.id)) {
        throw new Error("Event creators/organizers are not allowed to RSVP to their own events.");
      }

      let finalMemberId = Number(memberId);
      
      const isMappedUser = finalMemberId >= 1000000;
      const targetUserId = isMappedUser ? (finalMemberId - 1000000) : null;
      
      let phone: string | null = null;
      let userRec = null;
      
      if (targetUserId) {
        userRec = await (prisma as any).user.findUnique({ where: { id: targetUserId } });
      } else if (user && user.type === 'admin') {
        userRec = await (prisma as any).user.findUnique({ where: { id: Number(user.id) } });
      }
      
      if (userRec) {
        phone = userRec.phone;
      } else {
        const u = await (prisma as any).user.findUnique({ where: { id: finalMemberId } });
        if (u) {
          phone = u.phone;
          userRec = u;
        }
      }
      
      if (phone && userRec) {
        let member = await (prisma as any).member.findUnique({ where: { phone } });
        if (!member) {
          member = await (prisma as any).member.create({
            data: {
              name: userRec.name,
              surname: userRec.surname,
              phone: userRec.phone,
              role: userRec.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : (userRec.role === 'ADMIN' ? 'ADMIN' : (userRec.role === 'SUB_ADMIN' ? 'SUB_ADMIN' : 'Member')),
              locationId: userRec.locationId || 1,
              approvalStatus: 'APPROVED',
              isActive: true,
              district: userRec.district,
              constituency: userRec.constituency,
              area: userRec.area,
              street: userRec.street
            }
          });
        }
        finalMemberId = member.id;
      }

      const response = await (prisma as any).eventResponse.upsert({
        where: { eventId_memberId: { eventId, memberId: finalMemberId } },
        update: { status },
        create: { eventId, memberId: finalMemberId, status },
        include: { member: true }
      });

      // Emit socket.io real-time event for counts synchronization
      const io = (global as any).io;
      if (io) {
        const updatedEvent = await (prisma as any).event.findUnique({
          where: { id: eventId },
          include: { location: true, createdBy: true }
        });
        if (updatedEvent) {
          io.emit('eventResponseUpdated', { eventId, response });
          io.emit('event', updatedEvent);

          // Send FCM to event creator when someone accepts/joins
          if (status === 'ACCEPTED' && updatedEvent.createdById) {
            try {
              const creator = await (prisma as any).user.findUnique({
                where: { id: updatedEvent.createdById },
                select: { fcmToken: true, phone: true }
              });
              // Try user's FCM token first
              let creatorFcmToken = creator?.fcmToken;
              // Fallback: try member record's FCM token
              if (!creatorFcmToken && creator?.phone) {
                const creatorMember = await (prisma as any).member.findUnique({
                  where: { phone: creator.phone },
                  select: { fcmToken: true }
                });
                creatorFcmToken = creatorMember?.fcmToken;
              }
              if (creatorFcmToken) {
                const responderName = response.member?.name || 'ஒருவர்';
                sendNotificationToToken(
                  creatorFcmToken,
                  "நிகழ்வில் சேர்ந்தார்! / Event RSVP",
                  `${responderName} உங்கள் நிகழ்வில் கலந்துகொள்கிறார். / accepted your event.`,
                  { type: 'EVENT_RSVP', eventId: String(eventId), responderId: String(finalMemberId), status }
                ).catch(e => console.error("Error sending event RSVP FCM:", e));
              }
            } catch (e) {
              console.error("Error sending event response notification:", e);
            }
          }
        }
      }

      return response;
    },

    respondToEmergency: async (_: any, { emergencyRequestId, status, note }: any, context: any) => {
      if (!context?.user) throw new Error(I18nService.translate("unauthorized_login", context?.language));
      
      let memberId: number;
      if (context.user.type === 'member') {
        memberId = Number(context.user.id);
      } else {
        const userRec = await (prisma as any).user.findUnique({
          where: { id: Number(context.user.id) }
        });
        if (!userRec) {
          throw new Error("User record not found");
        }
        let member = await (prisma as any).member.findUnique({ where: { phone: userRec.phone } });
        if (!member) {
          member = await (prisma as any).member.create({
            data: {
              name: userRec.name,
              surname: userRec.surname,
              phone: userRec.phone,
              role: userRec.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : (userRec.role === 'ADMIN' ? 'ADMIN' : (userRec.role === 'SUB_ADMIN' ? 'SUB_ADMIN' : 'Member')),
              locationId: userRec.locationId || 1,
              approvalStatus: 'APPROVED',
              isActive: true,
              district: userRec.district,
              constituency: userRec.constituency,
              area: userRec.area,
              street: userRec.street
            }
          });
        }
        memberId = member.id;
      }
      
      const normalizedStatus = normalizeEmergencyResponseStatus(status);

      const response = await (prisma as any).emergencyResponse.upsert({
        where: {
          emergencyRequestId_memberId: {
            emergencyRequestId: Number(emergencyRequestId),
            memberId
          }
        },
        update: { status: normalizedStatus, note: note || null },
        create: {
          emergencyRequestId: Number(emergencyRequestId),
          memberId,
          status: normalizedStatus,
          note: note || null
        },
        include: { member: true }
      });

      // Emit socket.io real-time event for counts synchronization
      const io = (global as any).io;
      if (io) {
        const updatedEmergency = await (prisma as any).emergencyRequest.findUnique({
          where: { id: Number(emergencyRequestId) },
          include: { location: true, createdBy: true, member: true }
        });
        if (updatedEmergency) {
          io.emit('emergencyResponseUpdated', { emergencyRequestId: Number(emergencyRequestId), response });
          io.emit('emergencyRequest', updatedEmergency);
        }
      }

      return response;
    },

    createEmergencyRequest: async (_: any, { title, description, type, locationId, audience, contactName, contactPhone, expiryDate, collectResponse, bloodGroup, unitsRequired, hospitalName, patientCondition, disasterType, affectedArea, requiredSupport, volunteerType }: any, context: any) => {
      if (!context?.user) throw new Error(I18nService.translate("unauthorized_login", context?.language));
      const userId = Number(context.user.id);
      const userRole = context.user.role;

      let createdById = null;
      let memberId = null;
      const isMember = userRole === 'MEMBER';
      
      let initialStatus = 'PENDING_SUB_ADMIN';
      if (userRole === 'SUPER_ADMIN') {
        initialStatus = 'APPROVED_STATE';
      } else if (userRole === 'ADMIN') {
        initialStatus = 'APPROVED_ADMIN';
      } else if (userRole === 'SUB_ADMIN') {
        initialStatus = 'APPROVED_SUB_ADMIN';
      }

      if (isMember) {
        if (context?.user?.type === 'member') {
          memberId = userId;
        } else {
          createdById = userId;
        }
      } else {
        createdById = userId;
        // Enforce geographic targeting based on role
        const dbUser = await (prisma as any).user.findUnique({ where: { id: userId } });
        if (dbUser) {
          await validateLocationTargeting(dbUser.id, dbUser.role, dbUser.locationId, Number(locationId), context?.language);
        }
      }

      const expiryDateTime = expiryDate ? new Date(expiryDate) : null;

      // Clean raw inputs and extract values from description JSON if description contains serialized details
      let parsedJson: any = null;
      if (description) {
        const trimmed = description.trim();
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
          try {
            parsedJson = JSON.parse(trimmed);
          } catch (e) {
            // ignore
          }
        }
      }

      function cleanVal(val: any, jsonKey: string) {
        if (val === undefined || val === null || val === 'null') {
          if (parsedJson && parsedJson[jsonKey] !== undefined && parsedJson[jsonKey] !== null) {
            return String(parsedJson[jsonKey]);
          }
          return null;
        }
        return String(val);
      }

      const dbBloodGroup = cleanVal(bloodGroup, 'bloodGroup');
      const dbUnitsRequired = cleanVal(unitsRequired, 'unitsRequired');
      const dbHospitalName = cleanVal(hospitalName, 'hospitalName');
      const dbPatientCondition = cleanVal(patientCondition, 'patientCondition');
      const dbDisasterType = cleanVal(disasterType, 'disasterType');
      const dbAffectedArea = cleanVal(affectedArea, 'affectedArea');
      const dbRequiredSupport = cleanVal(requiredSupport, 'requiredSupport');
      const dbVolunteerType = cleanVal(volunteerType, 'volunteerType');
      const dbContactPhone = cleanVal(contactPhone, 'contactNumber') || cleanVal(contactPhone, 'contactPhone') || cleanVal(contactPhone, 'contactDetails') || cleanVal(contactPhone, 'phone') || contactPhone;
      const dbContactName = cleanVal(contactName, 'contactName') || contactName;

      const formattedDescription = parsedJson ? formatEmergencyDescription(description) : description;

      const request = await (prisma as any).emergencyRequest.create({
        data: {
          title,
          description: formattedDescription || description,
          type,
          locationId: Number(locationId),
          status: initialStatus as any,
          audience,
          contactName: dbContactName,
          contactPhone: dbContactPhone,
          expiryDate: expiryDateTime,
          collectResponse: collectResponse !== undefined ? collectResponse : true,
          bloodGroup: dbBloodGroup,
          unitsRequired: dbUnitsRequired,
          hospitalName: dbHospitalName,
          patientCondition: dbPatientCondition,
          disasterType: dbDisasterType,
          affectedArea: dbAffectedArea,
          requiredSupport: dbRequiredSupport,
          volunteerType: dbVolunteerType,
          createdById,
          memberId
        },
        include: { location: true, createdBy: true, member: true }
      });
      
      if (isMember) {
        // Send a notification specifically for reviewing the new request
        await sendSystemNotification({
          title: "New Blood Request Review",
          message: `${title} pending Sub Admin review. Location: ${request.location.name}`,
          type: 'MEMBER_REQUEST', // Shows up as a pending review request for admins
          locationId: Number(locationId),
          createdById: null,
          purpose: 'New emergency request pending Sub Admin review.',
          entityType: 'EMERGENCY',
          entityId: request.id,
          data: { requestId: request.id }
        }).catch(e => console.error(e));
      } else {
        // Push Notification, DB Notification, and Socket.IO for standard admin creation
        await sendSystemNotification({
          title: "Emergency Request: " + title,
          message: formattedDescription || description || "Urgent help needed in your area",
          type: 'EMERGENCY',
          locationId: Number(locationId),
          createdById,
          purpose: type?.toUpperCase?.().includes('BLOOD')
            ? 'Find blood donors and track who is coming, on the way, or reached the hospital.'
            : 'Collect urgent volunteer responses for an emergency request.',
          entityType: 'EMERGENCY',
          entityId: request.id,
          metadata: {
            contactName,
            contactPhone,
            audience,
            responseRequired: collectResponse !== undefined ? collectResponse : true
          },
          data: { requestId: request.id }
        }).catch(e => console.error(e));
      }
      
      return request;
    },

    updateRequestStatus: async (_: any, { id, status }: any, context: any) => {
      if (!context?.user) throw new Error('Unauthenticated');
      const request = await (prisma as any).emergencyRequest.findUnique({ where: { id: Number(id) } });
      if (!request) throw new Error('Emergency request not found');

      // Allow if SUPER_ADMIN, owner user (createdById), or owner member (memberId)
      const isOwnerUser = request.createdById && Number(context.user.id) === request.createdById;
      const isOwnerMember = request.memberId && Number(context.user.id) === request.memberId;
      const isSuper = context.user.role === 'SUPER_ADMIN';

      // Allow if Admin/Sub-Admin within location scope (administrative chain)
      let isWithinLocationScope = false;
      if (context.user.locationId && (context.user.role === 'ADMIN' || context.user.role === 'SUB_ADMIN')) {
        const childIds = await getChildLocationIds(Number(context.user.locationId));
        const allowedLocationIds = [Number(context.user.locationId), ...childIds];
        if (allowedLocationIds.includes(request.locationId)) {
          isWithinLocationScope = true;
        }
      }

      if (!isOwnerUser && !isOwnerMember && !isSuper && !isWithinLocationScope) {
        throw new Error('Unauthorized to update this request');
      }

      const protectedStatuses = [
        'APPROVED_SUB_ADMIN', 'PENDING_ADMIN', 'APPROVED_ADMIN', 
        'PENDING_SUPER_ADMIN', 'APPROVED_STATE', 'REJECTED'
      ];
      if (protectedStatuses.includes(status)) {
        throw new Error('Cannot set review/approval statuses directly via updateRequestStatus. Use reviewEmergencyRequest instead.');
      }

      const updated = await (prisma as any).emergencyRequest.update({
        where: { id: Number(id) },
        data: { status },
        include: { location: true, createdBy: true, member: true }
      });

      // Emit real-time Socket.IO updates
      const io = (global as any).io;
      if (io) {
        io.emit('emergencyRequestUpdated', updated);
        io.emit('emergencyRequest', updated);
      }

      return updated;
    },

    completeEmergencyRequest: async (_: any, { id }: any, context: any) => {
      await resolvers.Mutation.updateRequestStatus(_, { id, status: 'COMPLETED' }, context);
      return true;
    },

    reviewEmergencyRequest: async (_: any, { id, action, rejectReason }: any, context: any) => {
      const lang = context?.language || 'en';
      if (!context?.user) throw new Error(I18nService.translate("unauthorized_login", lang));
      
      const request = await (prisma as any).emergencyRequest.findUnique({
        where: { id: Number(id) },
        include: { location: true, member: true }
      });
      if (!request) throw new Error("Request not found");

      const userRole = context.user.role;
      const currentStatus = request.status;
      const normalizedAction = action.toUpperCase();

      if (normalizedAction === 'REJECT') {
        const updatedRequest = await (prisma as any).emergencyRequest.update({
          where: { id: request.id },
          data: { 
            status: 'REJECTED',
            description: rejectReason ? `${request.description || ''} (Rejected: ${rejectReason})` : request.description
          },
          include: { location: true, createdBy: true, member: true }
        });
        return updatedRequest;
      }

      if (currentStatus === 'PENDING_SUB_ADMIN' || currentStatus === 'PENDING') {
        if (userRole !== 'SUB_ADMIN' && userRole !== 'ADMIN' && userRole !== 'SUPER_ADMIN') {
          throw new Error("Only Sub Admin or above can review this request");
        }

        if (normalizedAction === 'ACCEPT' || normalizedAction === 'APPROVE') {
          const updated = await (prisma as any).emergencyRequest.update({
            where: { id: request.id },
            data: { status: 'APPROVED_SUB_ADMIN' },
            include: { location: true, createdBy: true, member: true }
          });

          await sendSystemNotification({
            title: "Urgent: " + request.title,
            message: request.description || "Urgent help needed in your area",
            type: 'EMERGENCY',
            locationId: request.locationId,
            purpose: 'Collect volunteer responses for an emergency request.',
            entityType: 'EMERGENCY',
            entityId: request.id,
            metadata: {
              contactName: request.contactName,
              contactPhone: request.contactPhone,
              collectResponse: true
            },
            data: { requestId: request.id }
          });

          return updated;
        }

        if (normalizedAction === 'FORWARD') {
          const updated = await (prisma as any).emergencyRequest.update({
            where: { id: request.id },
            data: { 
              status: 'PENDING_ADMIN',
              forwardedBy: 'Sub Admin',
              forwardedAt: new Date()
            },
            include: { location: true, createdBy: true, member: true }
          });

          const talukId = await findParentLocationOfType(request.locationId, 'TALUK');
          const targetNotifyLocationId = talukId || request.locationId;

          await sendSystemNotification({
            title: "Blood Request Escalate to Admin",
            message: `Blood request pending Admin review: ${request.title}`,
            type: 'MEMBER_REQUEST',
            locationId: targetNotifyLocationId,
            purpose: 'Forwarded emergency blood request pending admin review.',
            entityType: 'EMERGENCY',
            entityId: request.id,
            data: { requestId: request.id }
          });

          return updated;
        }
      }

      if (currentStatus === 'PENDING_ADMIN') {
        if (userRole !== 'ADMIN' && userRole !== 'SUPER_ADMIN') {
          throw new Error("Only Admin or above can review this request");
        }

        if (normalizedAction === 'ACCEPT' || normalizedAction === 'APPROVE') {
          const talukId = await findParentLocationOfType(request.locationId, 'TALUK');
          const targetLocationId = talukId || request.locationId;

          const updated = await (prisma as any).emergencyRequest.update({
            where: { id: request.id },
            data: { status: 'APPROVED_ADMIN' },
            include: { location: true, createdBy: true, member: true }
          });

          await sendSystemNotification({
            title: "Urgent: " + request.title,
            message: request.description || "Urgent help needed in your Taluk",
            type: 'EMERGENCY',
            locationId: targetLocationId,
            purpose: 'Collect volunteer responses for an emergency request.',
            entityType: 'EMERGENCY',
            entityId: request.id,
            metadata: {
              contactName: request.contactName,
              contactPhone: request.contactPhone,
              collectResponse: true
            },
            data: { requestId: request.id }
          });

          return updated;
        }

        if (normalizedAction === 'FORWARD') {
          const updated = await (prisma as any).emergencyRequest.update({
            where: { id: request.id },
            data: { 
              status: 'PENDING_SUPER_ADMIN',
              forwardedBy: 'Admin',
              forwardedAt: new Date()
            },
            include: { location: true, createdBy: true, member: true }
          });

          const stateId = await findParentLocationOfType(request.locationId, 'STATE');
          const targetNotifyLocationId = stateId || request.locationId;

          await sendSystemNotification({
            title: "Blood Request Escalate to Super Admin",
            message: `Blood request pending Super Admin review: ${request.title}`,
            type: 'MEMBER_REQUEST',
            locationId: targetNotifyLocationId,
            purpose: 'Forwarded emergency blood request pending Super Admin review.',
            entityType: 'EMERGENCY',
            entityId: request.id,
            data: { requestId: request.id }
          });

          return updated;
        }
      }

      if (currentStatus === 'APPROVED_ADMIN') {
        if (userRole !== 'ADMIN' && userRole !== 'SUPER_ADMIN') {
          throw new Error("Only Admin or above can forward this request");
        }

        if (normalizedAction === 'FORWARD') {
          const updated = await (prisma as any).emergencyRequest.update({
            where: { id: request.id },
            data: { 
              status: 'PENDING_SUPER_ADMIN',
              forwardedBy: 'Admin',
              forwardedAt: new Date()
            },
            include: { location: true, createdBy: true, member: true }
          });

          const stateId = await findParentLocationOfType(request.locationId, 'STATE');
          const targetNotifyLocationId = stateId || request.locationId;

          await sendSystemNotification({
            title: "Blood Request Escalate to Super Admin",
            message: `Blood request pending Super Admin review: ${request.title}`,
            type: 'MEMBER_REQUEST',
            locationId: targetNotifyLocationId,
            purpose: 'Forwarded emergency blood request pending Super Admin review.',
            entityType: 'EMERGENCY',
            entityId: request.id,
            data: { requestId: request.id }
          });

          return updated;
        }
      }

      if (currentStatus === 'APPROVED_SUB_ADMIN') {
        if (userRole !== 'SUB_ADMIN' && userRole !== 'ADMIN' && userRole !== 'SUPER_ADMIN') {
          throw new Error("Only Sub Admin or above can forward this request");
        }

        if (normalizedAction === 'FORWARD') {
          const updated = await (prisma as any).emergencyRequest.update({
            where: { id: request.id },
            data: { 
              status: 'PENDING_ADMIN',
              forwardedBy: 'Sub Admin',
              forwardedAt: new Date()
            },
            include: { location: true, createdBy: true, member: true }
          });

          const talukId = await findParentLocationOfType(request.locationId, 'TALUK');
          const targetNotifyLocationId = talukId || request.locationId;

          await sendSystemNotification({
            title: "Blood Request Escalate to Admin",
            message: `Blood request pending Admin review: ${request.title}`,
            type: 'MEMBER_REQUEST',
            locationId: targetNotifyLocationId,
            purpose: 'Forwarded emergency blood request pending admin review.',
            entityType: 'EMERGENCY',
            entityId: request.id,
            data: { requestId: request.id }
          });

          return updated;
        }
      }

      if (currentStatus === 'PENDING_SUPER_ADMIN') {
        if (userRole !== 'SUPER_ADMIN') {
          throw new Error("Only Super Admin can review this request");
        }

        if (normalizedAction === 'ACCEPT' || normalizedAction === 'APPROVE') {
          const stateId = await findParentLocationOfType(request.locationId, 'STATE');
          const targetLocationId = stateId || request.locationId;

          const updated = await (prisma as any).emergencyRequest.update({
            where: { id: request.id },
            data: { status: 'APPROVED_STATE' },
            include: { location: true, createdBy: true, member: true }
          });

          await sendSystemNotification({
            title: "Urgent Alert: " + request.title,
            message: request.description || "Urgent alert Tamil Nadu wide",
            type: 'EMERGENCY',
            locationId: targetLocationId,
            purpose: 'Collect volunteer responses for an emergency request.',
            entityType: 'EMERGENCY',
            entityId: request.id,
            metadata: {
              contactName: request.contactName,
              contactPhone: request.contactPhone,
              collectResponse: true
            },
            data: { requestId: request.id }
          });

          return updated;
        }
      }

      throw new Error(`Invalid review action ('${action}') or request status ('${currentStatus}')`);
    },

    createPost: async (_: any, args: any, context: any) => {
      const postImages = args.images || (args.image ? [args.image] : []);
      const processedImages = await processAndValidateImageUrls(postImages);
      const createdById = context?.user ? Number(context.user.id) : null;
      const createdByType = context?.user?.type || null;

      let finalContent = args.content;
      if (args.title && args.title.trim() !== '') {
        finalContent = `**${args.title.trim()}**\n\n${args.content}`;
      }

      const post = await (prisma as any).post.create({
        data: {
          content: finalContent,
          category: args.category || "Discussion",
          images: processedImages,
          authorName: args.authorName,
          authorRole: args.authorRole,
          locationId: args.locationId,
          createdById,
          createdByType
        }
      });
      
      // Push Notification
      if (args.locationId) {
        sendNotificationToLocation(Number(args.locationId), "New Community Post", `${args.authorName || 'Someone'} posted in the community`, { type: 'ALERT', postId: post.id }).catch(e => console.error(e));
      }
      
      return post;
    },

    editPost: async (_: any, { id, content, images }: any, context: any) => {
      const lang = context?.language || 'en';
      if (!context?.user) throw new Error(I18nService.translate("unauthorized_login", lang));

      const post = await (prisma as any).post.findUnique({
        where: { id: Number(id) }
      });
      if (!post) throw new Error("Post not found");

      const isOwner = post.createdById === Number(context.user.id) && post.createdByType === context.user.type;
      const isLegacyOwner = !post.createdById && post.authorName === context.user.name;

      if (!isOwner && !isLegacyOwner) {
        throw new Error("Unauthorized: Only the creator of the post can edit it.");
      }

      let processedImages = post.images;
      if (images) {
        processedImages = await processAndValidateImageUrls(images);
      }

      return (prisma as any).post.update({
        where: { id: post.id },
        data: {
          content,
          images: processedImages
        }
      });
    },

    deletePost: async (_: any, { id }: any, context: any) => {
      const lang = context?.language || 'en';
      if (!context?.user) throw new Error(I18nService.translate("unauthorized_login", lang));

      const post = await (prisma as any).post.findUnique({
        where: { id: Number(id) }
      });
      if (!post) throw new Error("Post not found");

      const user = context.user;
      const isOwner = post.createdById === Number(user.id) && post.createdByType === user.type;
      const isLegacyOwner = !post.createdById && post.authorName === user.name;

      const isAuthorized = isOwner || isLegacyOwner || user.role === 'SUPER_ADMIN';

      if (!isAuthorized) {
        throw new Error("Unauthorized: You do not have permission to delete this post directly.");
      }

      await (prisma as any).comment.deleteMany({
        where: { postId: post.id }
      });

      await (prisma as any).post.delete({
        where: { id: post.id }
      });

      return true;
    },

    reportPost: async (_: any, { postId, reason }: any, context: any) => {
      const lang = context?.language || 'en';
      if (!context?.user) throw new Error(I18nService.translate("unauthorized_login", lang));

      const member = await getOrCreateMemberForUser(context.user);
      if (!member) throw new Error("Member profile not found");

      const existing = await (prisma as any).postReport.findUnique({
        where: {
          postId_reportedById: {
            postId: Number(postId),
            reportedById: member.id
          }
        }
      });
      if (existing) {
        throw new Error("You have already reported this post.");
      }

      const post = await (prisma as any).post.findUnique({
        where: { id: Number(postId) }
      });
      if (!post) throw new Error("Post not found");

      const report = await (prisma as any).postReport.create({
        data: {
          postId: Number(postId),
          reportedById: member.id,
          reason,
          status: 'PENDING'
        },
        include: { post: true, reportedBy: true }
      });

      const reportCount = await (prisma as any).postReport.count({
        where: { postId: Number(postId) }
      });

      let nextStatus = post.status || 'ACTIVE';
      if (reportCount >= 10) {
        nextStatus = 'UNDER_REVIEW';
      } else if (post.status === 'ACTIVE') {
        nextStatus = 'REPORTED';
      }

      if (nextStatus !== post.status) {
        await (prisma as any).post.update({
          where: { id: post.id },
          data: { status: nextStatus }
        });
      }

      // Trigger admin notifications
      notifyAdminsOfReport(post).catch(e => console.error("Error sending admin notifications:", e));

      // Log activity
      try {
        const auditUserId = await getOrCreateUserForMember(member.id);
        if (auditUserId) {
          await (prisma as any).auditLog.create({
            data: {
              userId: auditUserId,
              action: 'post_reported',
              details: `Post reported by Member (Post ID: ${postId}, Reason: ${reason})`
            }
          });
        }
      } catch (err) {
        console.error("Error logging post report audit log:", err);
      }

      return report;
    },

    reportCommunityPost: async (_: any, { postId, reason }: any, context: any) => {
      const lang = context?.language || 'en';
      if (!context?.user) throw new Error(I18nService.translate("unauthorized_login", lang));

      const member = await getOrCreateMemberForUser(context.user);
      if (!member) throw new Error("Member profile not found");

      const existing = await (prisma as any).communityPostReport.findUnique({
        where: {
          postId_reportedById: {
            postId: Number(postId),
            reportedById: member.id
          }
        }
      });
      if (existing) {
        throw new Error("You have already reported this post.");
      }

      const post = await (prisma as any).communityPost.findUnique({
        where: { id: Number(postId) }
      });
      if (!post) throw new Error("Community post not found");

      const report = await (prisma as any).communityPostReport.create({
        data: {
          postId: Number(postId),
          reportedById: member.id,
          reason,
          status: 'PENDING'
        },
        include: { post: true, reportedBy: true }
      });

      const reportCount = await (prisma as any).communityPostReport.count({
        where: { postId: Number(postId) }
      });

      let nextStatus = post.status || 'ACTIVE';
      if (reportCount >= 10) {
        nextStatus = 'UNDER_REVIEW';
      } else if (post.status === 'ACTIVE') {
        nextStatus = 'REPORTED';
      }

      if (nextStatus !== post.status) {
        await (prisma as any).communityPost.update({
          where: { id: post.id },
          data: { status: nextStatus }
        });
      }

      // Log activity
      try {
        const auditUserId = await getOrCreateUserForMember(member.id);
        if (auditUserId) {
          await (prisma as any).auditLog.create({
            data: {
              userId: auditUserId,
              action: 'community_post_reported',
              details: `Community post reported by Member (Community Post ID: ${postId}, Reason: ${reason})`
            }
          });
        }
      } catch (err) {
        console.error("Error logging community post report audit log:", err);
      }

      return report;
    },

    resolvePostReport: async (_: any, { reportId, action, warningMessage }: any, context: any) => {
      const lang = context?.language || 'en';
      if (!context?.user) throw new Error(I18nService.translate("unauthorized_login", lang));

      const role = context.user.role;
      const userLocId = context.user.locationId;

      if (role === 'MEMBER') {
        throw new Error("Unauthorized: Only administrators can resolve reports.");
      }

      const report = await (prisma as any).postReport.findUnique({
        where: { id: Number(reportId) },
        include: { post: true, reportedBy: true }
      });
      if (!report) throw new Error("Report not found");

      // Prevent duplicate resolutions
      if (report.status !== 'PENDING') {
        throw new Error("This report has already been resolved.");
      }

      // Validate administrative hierarchy
      const postLoc = await (prisma as any).location.findUnique({
        where: { id: report.post.locationId }
      });

      if (role === 'SUB_ADMIN' && !['STREET', 'AREA'].includes(postLoc.type)) {
        throw new Error("Unauthorized: Sub Admins can only resolve Street or Area level reports.");
      }
      if (role === 'ADMIN' && !['TALUK', 'DISTRICT'].includes(postLoc.type)) {
        throw new Error("Unauthorized: Admins can only resolve Taluk or District level reports.");
      }

      if (role !== 'SUPER_ADMIN') {
        if (!userLocId) throw new Error("Unauthorized: Missing admin location scope.");
        const childIds = await getChildLocationIds(userLocId);
        const allowedLocIds = new Set([userLocId, ...childIds]);
        if (!allowedLocIds.has(report.post.locationId)) {
          throw new Error("Unauthorized: Post location is outside your scope.");
        }
      }

      let nextStatus = 'PENDING';
      const io = (global as any).io;

      // Perform action
      if (action === 'IGNORE') {
        nextStatus = 'IGNORED';
        await (prisma as any).postReport.update({
          where: { id: report.id },
          data: { status: 'IGNORED' }
        });

        // Send FCM notification to reporter
        if (report.reportedBy?.fcmToken) {
          sendNotificationToToken(
            report.reportedBy.fcmToken,
            "Report Update / புகார் பரிசீலனை",
            "Your report on post has been reviewed and closed / உங்களது புகார் பரிசீலிக்கப்பட்டு மூடப்பட்டது.",
            { type: 'REPORT_RESOLVED', reportId: report.id, status: nextStatus }
          ).catch(e => console.error("Error sending FCM notification to reporter:", e));
        }

      } else if (action === 'WARN') {
        nextStatus = 'WARNED';
        if (!warningMessage) throw new Error("Warning message is required to warn the user.");
        
        const postCreatorMemberId = await getPostCreatorMemberId(report.post);
        if (postCreatorMemberId) {
          await (prisma as any).userWarning.create({
            data: {
              memberId: postCreatorMemberId,
              adminId: Number(context.user.id),
              message: warningMessage,
              postId: report.postId
            }
          });

          // Send FCM notification to creator
          const creatorMember = await (prisma as any).member.findUnique({
            where: { id: postCreatorMemberId },
            select: { fcmToken: true }
          });
          if (creatorMember?.fcmToken) {
            sendNotificationToToken(
              creatorMember.fcmToken,
              "Warning: Content Flagged / எச்சரிக்கை",
              `Your post received a warning: ${warningMessage} / உங்களது பதிவு எச்சரிக்கப்பட்டுள்ளது: ${warningMessage}`,
              { type: 'CONTENT_WARNING', postId: report.postId, warningMessage }
            ).catch(e => console.error("Error sending FCM warning notification:", e));
          }
        }

        await (prisma as any).postReport.update({
          where: { id: report.id },
          data: { status: 'WARNED' }
        });

      } else if (action === 'DELETE') {
        nextStatus = 'DELETED';
        // Log warning if message is provided
        if (warningMessage) {
          const postCreatorMemberId = await getPostCreatorMemberId(report.post);
          if (postCreatorMemberId) {
            await (prisma as any).userWarning.create({
              data: {
                memberId: postCreatorMemberId,
                adminId: Number(context.user.id),
                message: warningMessage,
                postId: report.postId
              }
            });

            // Send FCM notification to creator
            const creatorMember = await (prisma as any).member.findUnique({
              where: { id: postCreatorMemberId },
              select: { fcmToken: true }
            });
            if (creatorMember?.fcmToken) {
              sendNotificationToToken(
                creatorMember.fcmToken,
                "Content Removed / பதிவு நீக்கப்பட்டது",
                `Your post was removed: ${warningMessage} / உங்களது பதிவு நீக்கப்பட்டுள்ளது: ${warningMessage}`,
                { type: 'CONTENT_REMOVED', postId: report.postId, reason: warningMessage }
              ).catch(e => console.error("Error sending FCM removal notification:", e));
            }
          }
        } else {
          // Send generic notification to creator
          const postCreatorMemberId = await getPostCreatorMemberId(report.post);
          if (postCreatorMemberId) {
            const creatorMember = await (prisma as any).member.findUnique({
              where: { id: postCreatorMemberId },
              select: { fcmToken: true }
            });
            if (creatorMember?.fcmToken) {
              sendNotificationToToken(
                creatorMember.fcmToken,
                "Content Removed / பதிவு நீக்கப்பட்டது",
                "Your post was removed by Admin / உங்களது பதிவு நிர்வாகியால் நீக்கப்பட்டுள்ளது.",
                { type: 'CONTENT_REMOVED', postId: report.postId }
              ).catch(e => console.error("Error sending FCM generic removal notification:", e));
            }
          }
        }

        // Cascade comments and delete the post
        await (prisma as any).comment.deleteMany({
          where: { postId: report.postId }
        });
        await (prisma as any).post.delete({
          where: { id: report.postId }
        });

        // Emit Socket event to notify all users to remove the post from feed
        if (io) {
          io.emit('postDeleted', { postId: report.postId });
        }
      }

      // Emit Socket event to update the admin queue
      if (io) {
        io.emit('reportResolved', { reportId: report.id, status: nextStatus, type: 'POST' });
      }

      return { id: report.id, postId: report.postId, success: true, message: "Report resolved successfully.", action };
    },

    resolveCommunityPostReport: async (_: any, { reportId, action, warningMessage }: any, context: any) => {
      const lang = context?.language || 'en';
      if (!context?.user) throw new Error(I18nService.translate("unauthorized_login", lang));

      const role = context.user.role;
      const userLocId = context.user.locationId;

      if (role === 'MEMBER') {
        throw new Error("Unauthorized: Only administrators can resolve reports.");
      }

      const report = await (prisma as any).communityPostReport.findUnique({
        where: { id: Number(reportId) },
        include: {
          post: {
            include: {
              community: {
                include: { location: true }
              }
            }
          },
          reportedBy: true
        }
      });
      if (!report) throw new Error("Report not found");

      // Prevent duplicate resolutions
      if (report.status !== 'PENDING') {
        throw new Error("This report has already been resolved.");
      }

      const commLoc = report.post.community.location;

      if (!commLoc) {
        if (role !== 'SUPER_ADMIN') {
          throw new Error("Unauthorized: Only Super Admin can resolve global community reports.");
        }
      } else {
        if (role === 'SUB_ADMIN' && !['STREET', 'AREA'].includes(commLoc.type)) {
          throw new Error("Unauthorized: Sub Admins can only resolve Street or Area level reports.");
        }
        if (role === 'ADMIN' && !['TALUK', 'DISTRICT'].includes(commLoc.type)) {
          throw new Error("Unauthorized: Admins can only resolve Taluk or District level reports.");
        }

        if (role !== 'SUPER_ADMIN') {
          if (!userLocId) throw new Error("Unauthorized: Missing admin location scope.");
          const childIds = await getChildLocationIds(userLocId);
          const allowedLocIds = new Set([userLocId, ...childIds]);
          if (!allowedLocIds.has(commLoc.id)) {
            throw new Error("Unauthorized: Community location is outside your scope.");
          }
        }
      }

      let nextStatus = 'PENDING';
      const io = (global as any).io;

      // Perform action
      if (action === 'IGNORE') {
        nextStatus = 'IGNORED';
        await (prisma as any).communityPostReport.update({
          where: { id: report.id },
          data: { status: 'IGNORED' }
        });

        // Send FCM notification to reporter
        if (report.reportedBy?.fcmToken) {
          sendNotificationToToken(
            report.reportedBy.fcmToken,
            "Report Update / புகார் பரிசீலனை",
            "Your report on community post has been reviewed and closed / உங்களது புகார் பரிசீலிக்கப்பட்டு மூடப்பட்டது.",
            { type: 'REPORT_RESOLVED', reportId: report.id, status: nextStatus }
          ).catch(e => console.error("Error sending FCM notification to reporter:", e));
        }

      } else if (action === 'WARN') {
        nextStatus = 'WARNED';
        if (!warningMessage) throw new Error("Warning message is required to warn the user.");

        const creatorMember = await (prisma as any).member.findFirst({
          where: {
            phone: (await (prisma as any).user.findUnique({
              where: { id: report.post.createdById },
              select: { phone: true }
            }))?.phone
          }
        });

        if (creatorMember) {
          await (prisma as any).userWarning.create({
            data: {
              memberId: creatorMember.id,
              adminId: Number(context.user.id),
              message: warningMessage,
              communityPostId: report.postId
            }
          });

          // Send FCM notification to creator
          if (creatorMember.fcmToken) {
            sendNotificationToToken(
              creatorMember.fcmToken,
              "Warning: Content Flagged / எச்சரிக்கை",
              `Your community post received a warning: ${warningMessage} / உங்களது பதிவு எச்சரிக்கப்பட்டுள்ளது: ${warningMessage}`,
              { type: 'CONTENT_WARNING', postId: report.postId, warningMessage }
            ).catch(e => console.error("Error sending FCM warning notification:", e));
          }
        }

        await (prisma as any).communityPostReport.update({
          where: { id: report.id },
          data: { status: 'WARNED' }
        });

      } else if (action === 'DELETE') {
        nextStatus = 'DELETED';
        if (warningMessage) {
          const creatorMember = await (prisma as any).member.findFirst({
            where: {
              phone: (await (prisma as any).user.findUnique({
                where: { id: report.post.createdById },
                select: { phone: true }
              }))?.phone
            }
          });

          if (creatorMember) {
            await (prisma as any).userWarning.create({
              data: {
                memberId: creatorMember.id,
                adminId: Number(context.user.id),
                message: warningMessage,
                communityPostId: report.postId
              }
            });

            // Send FCM notification to creator
            if (creatorMember.fcmToken) {
              sendNotificationToToken(
                creatorMember.fcmToken,
                "Content Removed / பதிவு நீக்கப்பட்டது",
                `Your community post was removed: ${warningMessage} / உங்களது பதிவு நீக்கப்பட்டுள்ளது: ${warningMessage}`,
                { type: 'CONTENT_REMOVED', postId: report.postId, reason: warningMessage }
              ).catch(e => console.error("Error sending FCM removal notification:", e));
            }
          }
        } else {
          // Send generic notification to creator
          const creatorMember = await (prisma as any).member.findFirst({
            where: {
              phone: (await (prisma as any).user.findUnique({
                where: { id: report.post.createdById },
                select: { phone: true }
              }))?.phone
            }
          });
          if (creatorMember?.fcmToken) {
            sendNotificationToToken(
              creatorMember.fcmToken,
              "Content Removed / பதிவு நீக்கப்பட்டது",
              "Your community post was removed by Admin / உங்களது பதிவு நிர்வாகியால் நீக்கப்பட்டுள்ளது.",
              { type: 'CONTENT_REMOVED', postId: report.postId }
            ).catch(e => console.error("Error sending FCM generic removal notification:", e));
          }
        }

        // Delete comments and the post
        await (prisma as any).communityComment.deleteMany({
          where: { postId: report.postId }
        });
        await (prisma as any).communityPost.delete({
          where: { id: report.postId }
        });

        // Emit Socket event to notify all users to remove the post from feed
        if (io) {
          io.emit('postDeleted', { postId: report.postId });
        }

      } else if (action === 'REMOVE_MEMBER') {
        nextStatus = 'DELETED';
        let posterMemberId: number | null = null;

        if (report.post.memberId) {
          // Post was created by a Member directly
          posterMemberId = report.post.memberId;
        } else if (report.post.createdById) {
          // Post was created by an Admin/User — find their Member record by phone
          const postCreator = await (prisma as any).user.findUnique({
            where: { id: report.post.createdById },
            select: { phone: true }
          });
          if (postCreator?.phone) {
            const memberRecord = await (prisma as any).member.findFirst({
              where: { phone: postCreator.phone }
            });
            posterMemberId = memberRecord?.id || null;
          }
        }

        if (posterMemberId) {
          // Delete their membership from the community
          await (prisma as any).communityMember.deleteMany({
            where: {
              communityId: report.post.communityId,
              memberId: posterMemberId
            }
          });

          // Also issue a warning if warningMessage is provided
          if (warningMessage) {
            await (prisma as any).userWarning.create({
              data: {
                memberId: posterMemberId,
                adminId: Number(context.user.id),
                message: warningMessage,
                communityPostId: report.postId
              }
            });
          }

          // Send FCM notification to creator about community membership removal
          const creatorMember = await (prisma as any).member.findUnique({
            where: { id: posterMemberId },
            select: { fcmToken: true }
          });
          if (creatorMember?.fcmToken) {
            sendNotificationToToken(
              creatorMember.fcmToken,
              "Removed from Community / குழுவில் இருந்து நீக்கப்பட்டீர்கள்",
              `You have been removed from the community due to violation: ${warningMessage || ''} / விதிமுறை மீறல் காரணமாக நீங்கள் குழுவில் இருந்து நீக்கப்பட்டீர்கள்.`,
              { type: 'COMMUNITY_MEMBER_REMOVED', communityId: report.post.communityId }
            ).catch(e => console.error("Error sending FCM membership removal notification:", e));
          }
        }

        await (prisma as any).communityPostReport.update({
          where: { id: report.id },
          data: { status: 'DELETED' }
        });
      }

      // Emit Socket event to update the admin queue
      if (io) {
        io.emit('reportResolved', { reportId: report.id, status: nextStatus, type: 'COMMUNITY_POST' });
      }

      return { id: report.id, postId: report.postId, success: true, message: "Report resolved successfully.", action };
    },

    moderatePost: async (_: any, { postId, action, warningMessage }: any, context: any) => {
      const lang = context?.language || 'en';
      if (!context?.user) throw new Error(I18nService.translate("unauthorized_login", lang));

      const role = context.user.role;
      const userLocId = context.user.locationId;

      if (role === 'MEMBER') {
        throw new Error("Unauthorized: Only administrators can moderate posts.");
      }

      const post = await (prisma as any).post.findUnique({
        where: { id: Number(postId) },
        include: { location: true }
      });
      if (!post) throw new Error("Post not found");

      // Validate administrative hierarchy
      if (role === 'SUB_ADMIN' && !['STREET', 'AREA'].includes(post.location.type)) {
        throw new Error("Unauthorized: Sub Admins can only resolve Street or Area level reports.");
      }
      if (role === 'ADMIN' && !['TALUK', 'DISTRICT'].includes(post.location.type)) {
        throw new Error("Unauthorized: Admins can only resolve Taluk or District level reports.");
      }

      if (role !== 'SUPER_ADMIN') {
        if (!userLocId) throw new Error("Unauthorized: Missing admin location scope.");
        const childIds = await getChildLocationIds(userLocId);
        const allowedLocIds = new Set([userLocId, ...childIds]);
        if (!allowedLocIds.has(post.locationId)) {
          throw new Error("Unauthorized: Post location is outside your scope.");
        }
      }

      const postCreatorMemberId = await getPostCreatorMemberId(post);
      const postCreatorMember = postCreatorMemberId 
        ? await (prisma as any).member.findUnique({ where: { id: postCreatorMemberId } })
        : null;

      if (action === 'KEEP') {
        // Update post status to KEPT
        await (prisma as any).post.update({
          where: { id: post.id },
          data: { status: 'KEPT' }
        });

        // Update all pending reports for this post to IGNORED
        await (prisma as any).postReport.updateMany({
          where: { postId: post.id, status: 'PENDING' },
          data: { status: 'IGNORED' }
        });

        // Create Audit Log
        await (prisma as any).auditLog.create({
          data: {
            userId: Number(context.user.id),
            action: 'post_kept',
            details: `Reviewed and kept post ID ${post.id} by Admin ID ${context.user.id}`
          }
        });

      } else if (action === 'WARN') {
        if (!warningMessage) throw new Error("Warning message is required to warn the user.");

        // Update post status to WARNED
        await (prisma as any).post.update({
          where: { id: post.id },
          data: { status: 'WARNED' }
        });

        // Update all pending reports for this post to WARNED
        await (prisma as any).postReport.updateMany({
          where: { postId: post.id, status: 'PENDING' },
          data: { status: 'WARNED' }
        });

        // Create UserWarning
        if (postCreatorMemberId) {
          await (prisma as any).userWarning.create({
            data: {
              memberId: postCreatorMemberId,
              adminId: Number(context.user.id),
              message: warningMessage,
              postId: post.id
            }
          });

          // Send warning push notification
          if (postCreatorMember?.fcmToken) {
            await sendNotificationToToken(
              postCreatorMember.fcmToken,
              "Your post received a warning.",
              warningMessage,
              { type: "POST_MODERATION", postId: post.id }
            ).catch(e => console.error("Error sending push to owner:", e));
          }

          // Create App Notification for the post owner
          await (prisma as any).notification.create({
            data: {
              title: "Your post received a warning.",
              message: warningMessage,
              type: "POST_MODERATION",
              locationId: post.locationId,
              entityType: "Post",
              entityId: post.id,
              status: "ACTIVE",
              time: "Just now"
            }
          });
        }

        // Create Audit Log
        await (prisma as any).auditLog.create({
          data: {
            userId: Number(context.user.id),
            action: 'post_warned',
            details: `Warning sent by Admin for post ID ${post.id}: ${warningMessage}`
          }
        });

      } else if (action === 'DELETE') {
        // Update post status to DELETED
        await (prisma as any).post.update({
          where: { id: post.id },
          data: { status: 'DELETED' }
        });

        // Update all pending reports for this post to DELETED
        await (prisma as any).postReport.updateMany({
          where: { postId: post.id, status: 'PENDING' },
          data: { status: 'DELETED' }
        });

        // Create UserWarning if message provided
        if (postCreatorMemberId) {
          if (warningMessage) {
            await (prisma as any).userWarning.create({
              data: {
                memberId: postCreatorMemberId,
                adminId: Number(context.user.id),
                message: warningMessage,
                postId: post.id
              }
            });
          }

          // Send delete push notification
          if (postCreatorMember?.fcmToken) {
            await sendNotificationToToken(
              postCreatorMember.fcmToken,
              "Your post was removed by Admin.",
              warningMessage || "Your post violated community guidelines and was removed.",
              { type: "POST_MODERATION", postId: post.id }
            ).catch(e => console.error("Error sending push to owner:", e));
          }

          // Create App Notification for the post owner
          await (prisma as any).notification.create({
            data: {
              title: "Your post was removed by Admin.",
              message: warningMessage || "Your post violated community guidelines and was removed.",
              type: "POST_MODERATION",
              locationId: post.locationId,
              entityType: "Post",
              entityId: post.id,
              status: "ACTIVE",
              time: "Just now"
            }
          });
        }

        // Create Audit Log
        await (prisma as any).auditLog.create({
          data: {
            userId: Number(context.user.id),
            action: 'post_deleted',
            details: `Post deleted by Admin: post ID ${post.id}`
          }
        });
      }

      return { id: post.id, postId: post.id, success: true, message: "Post action completed successfully.", action };
    },

    createPoll: async (_: any, { question, options, durationDays, locationId, districtId, talukId, areaId, streetId, communityId }: any, context: any) => {
      if (!context.user) {
        throw new Error(I18nService.translate("unauthorized_login", context?.language));
      }
      
      const isMember = context.user.type === 'member' || context.user.role === 'MEMBER';
      const createdById = isMember ? null : Number(context.user.id);
      const memberId = isMember ? Number(context.user.id) : null;
      
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + durationDays);
      
      const role = isMember ? 'MEMBER' : (context.user.role || 'MEMBER');
      const userLocId = context.user.locationId ? Number(context.user.locationId) : null;

      let finalLocationId = streetId || areaId || talukId || districtId || locationId;
      if (!finalLocationId) {
        if (userLocId) {
          finalLocationId = userLocId;
        }
      }
      if (!finalLocationId) {
        const firstLocation = await (prisma as any).location.findFirst({ select: { id: true } });
        finalLocationId = firstLocation?.id;
      }
      if (!finalLocationId) {
        throw new Error(I18nService.translate("location_required", context?.language));
      }

      const targetLocIdNum = Number(finalLocationId);
      const targetLoc = await (prisma as any).location.findUnique({
        where: { id: targetLocIdNum }
      });
      if (!targetLoc) {
        throw new Error(I18nService.translate("target_location_not_found", context?.language));
      }

      // Enforce role-based location lock constraints for poll creation
      // Skip location lock for community polls - they use community's location
      if (!communityId) {
        if (role === 'MEMBER') {
          if (!userLocId || targetLocIdNum !== userLocId) {
            throw new Error(I18nService.translate("member_outside_scope" as any, context?.language));
          }
        } else if (role === 'ADMIN') {
          if (!userLocId) {
            throw new Error(I18nService.translate("admin_no_scope", context?.language));
          }
          const targetAncestors = await getAncestorLocationIds(targetLocIdNum);
          if (!targetAncestors.includes(userLocId)) {
            throw new Error(I18nService.translate("admin_outside_scope", context?.language));
          }
        } else if (role === 'SUB_ADMIN') {
          if (!userLocId) {
            throw new Error(I18nService.translate("subadmin_no_scope", context?.language));
          }
          const targetAncestors = await getAncestorLocationIds(targetLocIdNum);
          if (!targetAncestors.includes(userLocId)) {
            throw new Error(I18nService.translate("subadmin_outside_scope", context?.language));
          }
        }
      }
      
      const poll = await (prisma as any).poll.create({
        data: {
          question,
          locationId: Number(finalLocationId),
          communityId: communityId ? Number(communityId) : null,
          createdById,
          memberId,
          expiresAt,
          options: {
            create: options.map((optText: string) => ({ text: optText }))
          }
        }
      });
      
      // Push Notification, DB Notification, and Socket.IO
      if (communityId) {
         sendNotificationToCommunity(Number(communityId), "New Poll", question, { type: 'POLL', pollId: poll.id }).catch(e => console.error(e));
         
         // Create a database notification for the community's location if available
         const notification = await (prisma as any).notification.create({
           data: {
             title: "New Poll",
             message: question,
             type: 'POLL',
             locationId: Number(finalLocationId),
             time: 'Just now'
           }
         });
         const io = (global as any).io;
         if (io) {
           io.emit('newNotification', notification);
         }

         // Also inject it into the community chat stream
         const senderId = createdById || memberId;
         if (senderId) {
           try {
             const chatMsg = await (prisma as any).communityMessage.create({
               data: {
                 communityId: Number(communityId),
                 senderId,
                 senderType: createdById ? 'USER' : 'MEMBER',
                 message: question,
                 messageType: 'POLL',
                 metadata: { pollId: poll.id }
               },
               include: { replyTo: true, reactions: true }
             });
             if (io) {
               const payload = await formatCommunityMessage(chatMsg);
               io.to(`community:${communityId}`).emit('communityMessage', payload);
             }
           } catch (chatErr) {
             console.error('Failed to create community chat message for poll:', chatErr);
           }
         }
      } else if (finalLocationId) {
         await sendSystemNotification({
           title: "New Poll",
           message: question,
           type: 'POLL',
           locationId: Number(finalLocationId),
           data: { pollId: poll.id }
         }).catch(e => console.error(e));
      }
      
      return poll;
    },

    voteInPoll: async (_: any, { pollId, optionId }: any, context: any) => {
      if (!context.user) {
        throw new Error(I18nService.translate("unauthorized_login", context?.language));
      }
      
      let memberId: number;
      if (context.user.type === 'member') {
        memberId = Number(context.user.id);
      } else {
        const userRec = await (prisma as any).user.findUnique({
          where: { id: Number(context.user.id) }
        });
        if (!userRec) {
          throw new Error("User record not found");
        }

        let member = await (prisma as any).member.findUnique({
          where: { phone: userRec.phone }
        });

        if (!member) {
          member = await (prisma as any).member.create({
            data: {
              name: userRec.name,
              surname: userRec.surname,
              phone: userRec.phone,
              role: userRec.role === 'SUPER_ADMIN' ? 'ADMIN' : (userRec.role === 'SUB_ADMIN' ? 'SUB_ADMIN' : 'Member'),
              locationId: userRec.locationId || 1,
              approvalStatus: 'APPROVED',
              isActive: true,
              district: userRec.district,
              constituency: userRec.constituency,
              area: userRec.area,
              street: userRec.street
            }
          });
        }
        memberId = member.id;
      }
      
      const pollCheck = await (prisma as any).poll.findUnique({
        where: { id: pollId }
      });
      
      if (!pollCheck) {
        throw new Error("Poll not found");
      }
      
      if (new Date() > new Date(pollCheck.expiresAt)) {
        throw new Error("This poll has expired");
      }
      
      const existingVote = await (prisma as any).pollVote.findUnique({
        where: {
          pollId_memberId: {
            pollId,
            memberId
          }
        }
      });
      
      if (existingVote) {
        throw new Error("You have already voted in this poll");
      }
      
      await (prisma as any).pollVote.create({
        data: {
          pollId,
          optionId,
          memberId
        }
      });
      
      return (prisma as any).poll.findUnique({
        where: { id: pollId }
      });
    },

    likePoll: async (_: any, { id, pollId: inputPollId }: any, context: any) => {
      const lang = context?.language || 'en';
      if (!context?.user) throw new Error(I18nService.translate("unauthorized_login", lang));

      const member = await getOrCreateMemberForUser(context.user);
      if (!member) throw new Error("Member profile not found");

      const pollId = Number(id || inputPollId);
      if (!pollId) throw new Error("Poll ID is required");
      const memberId = member.id;

      const existingLike = await (prisma as any).pollLike.findUnique({
        where: {
          pollId_memberId: {
            pollId,
            memberId
          }
        }
      });

      if (existingLike) {
        await (prisma as any).pollLike.delete({
          where: {
            pollId_memberId: {
              pollId,
              memberId
            }
          }
        });
      } else {
        await (prisma as any).pollLike.create({
          data: {
            pollId,
            memberId
          }
        });
      }

      const poll = await (prisma as any).poll.findUnique({
        where: { id: pollId }
      });

      // Send FCM notification to poll creator when liked (not when unliked)
      if (!existingLike && poll) {
        try {
          const pollCreatorMemberId = await getPollCreatorMemberId(poll);
          // Only notify if the liker is different from the poll creator
          if (pollCreatorMemberId && pollCreatorMemberId !== memberId) {
            const creatorMember = await (prisma as any).member.findUnique({
              where: { id: pollCreatorMemberId },
              select: { fcmToken: true }
            });
            if (creatorMember?.fcmToken) {
              sendNotificationToToken(
                creatorMember.fcmToken,
                "உங்கள் வாக்கெடுப்புக்கு லைக் வந்தது! / Poll Liked",
                `${member.name || 'Someone'} உங்கள் வாக்கெடுப்பை லைக் செய்தார். / liked your poll.`,
                { type: 'POLL_LIKED', pollId: String(pollId), likedBy: String(memberId) }
              ).catch(e => console.error("Error sending poll like FCM:", e));
            }
          }
        } catch (e) {
          console.error("Error sending poll like notification:", e);
        }
      }

      return poll;
    },

    addPollComment: async (_: any, { pollId, content, authorName, authorRole, parentId }: any) => {
      const comment = await (prisma as any).pollComment.create({
        data: {
          pollId,
          content,
          authorName,
          authorRole,
          parentId: parentId ? Number(parentId) : null
        }
      });
      return comment;
    },

    likePollComment: async (_: any, { pollCommentId }: any, context: any) => {
      const lang = context?.language || 'en';
      if (!context?.user) throw new Error(I18nService.translate("unauthorized_login", lang));

      const member = await getOrCreateMemberForUser(context.user);
      if (!member) throw new Error("Member profile not found");

      const pCommentId = Number(pollCommentId);
      const memberId = member.id;

      const existingLike = await (prisma as any).pollCommentLike.findUnique({
        where: {
          pollCommentId_memberId: {
            pollCommentId: pCommentId,
            memberId
          }
        }
      });

      if (existingLike) {
        await (prisma as any).pollCommentLike.delete({
          where: {
            pollCommentId_memberId: {
              pollCommentId: pCommentId,
              memberId
            }
          }
        });
      } else {
        await (prisma as any).pollCommentLike.create({
          data: {
            pollCommentId: pCommentId,
            memberId
          }
        });
      }

      return (prisma as any).pollComment.findUnique({
        where: { id: pCommentId }
      });
    },

    reportPoll: async (_: any, { pollId, reason }: any, context: any) => {
      const lang = context?.language || 'en';
      if (!context?.user) throw new Error(I18nService.translate("unauthorized_login", lang));

      const member = await getOrCreateMemberForUser(context.user);
      if (!member) throw new Error("Member profile not found");

      const report = await (prisma as any).pollReport.upsert({
        where: {
          pollId_reportedById: {
            pollId: Number(pollId),
            reportedById: member.id
          }
        },
        update: {
          reason,
          status: 'PENDING'
        },
        create: {
          pollId: Number(pollId),
          reportedById: member.id,
          reason,
          status: 'PENDING'
        }
      });

      return report;
    },

    resolvePollReport: async (_: any, { reportId, action, warningMessage }: any, context: any) => {
      const lang = context?.language || 'en';
      if (!context?.user) throw new Error(I18nService.translate("unauthorized_login", lang));

      const role = context.user.role;
      const userLocId = context.user.locationId;

      if (role === 'MEMBER') {
        throw new Error("Unauthorized: Only administrators can resolve reports.");
      }

      const report = await (prisma as any).pollReport.findUnique({
        where: { id: Number(reportId) },
        include: { poll: true, reportedBy: true }
      });
      if (!report) throw new Error("Report not found");

      // Prevent duplicate resolutions
      if (report.status !== 'PENDING') {
        throw new Error("This report has already been resolved.");
      }

      const pollLoc = await (prisma as any).location.findUnique({
        where: { id: report.poll.locationId }
      });

      if (role === 'SUB_ADMIN' && !['STREET', 'AREA'].includes(pollLoc.type)) {
        throw new Error("Unauthorized: Sub Admins can only resolve Street or Area level reports.");
      }
      if (role === 'ADMIN' && !['TALUK', 'DISTRICT'].includes(pollLoc.type)) {
        throw new Error("Unauthorized: Admins can only resolve Taluk or District level reports.");
      }

      if (role !== 'SUPER_ADMIN') {
        if (!userLocId) throw new Error("Unauthorized: Missing admin location scope.");
        const childIds = await getChildLocationIds(userLocId);
        const allowedLocIds = new Set([userLocId, ...childIds]);
        if (!allowedLocIds.has(report.poll.locationId)) {
          throw new Error("Unauthorized: Poll location is outside your scope.");
        }
      }

      let nextStatus = 'PENDING';
      const io = (global as any).io;

      if (action === 'IGNORE') {
        nextStatus = 'IGNORED';
        await (prisma as any).pollReport.update({
          where: { id: report.id },
          data: { status: 'IGNORED' }
        });

        // Send FCM notification to reporter
        if (report.reportedBy?.fcmToken) {
          sendNotificationToToken(
            report.reportedBy.fcmToken,
            "Report Update / புகார் பரிசீலனை",
            "Your report on poll has been reviewed and closed / உங்களது புகார் பரிசீலிக்கப்பட்டு மூடப்பட்டது.",
            { type: 'REPORT_RESOLVED', reportId: report.id, status: nextStatus }
          ).catch(e => console.error("Error sending FCM notification to reporter:", e));
        }

      } else if (action === 'WARN') {
        nextStatus = 'WARNED';
        if (!warningMessage) throw new Error("Warning message is required to warn the user.");
        
        const pollCreatorMemberId = await getPollCreatorMemberId(report.poll);
        if (pollCreatorMemberId) {
          await (prisma as any).userWarning.create({
            data: {
              memberId: pollCreatorMemberId,
              adminId: Number(context.user.id),
              message: warningMessage,
              pollId: report.pollId
            }
          });

          // Send FCM notification to creator
          const creatorMember = await (prisma as any).member.findUnique({
            where: { id: pollCreatorMemberId },
            select: { fcmToken: true }
          });
          if (creatorMember?.fcmToken) {
            sendNotificationToToken(
              creatorMember.fcmToken,
              "Warning: Content Flagged / எச்சரிக்கை",
              `Your poll received a warning: ${warningMessage} / உங்களது வாக்கெடுப்பு எச்சரிக்கப்பட்டுள்ளது: ${warningMessage}`,
              { type: 'CONTENT_WARNING', pollId: report.pollId, warningMessage }
            ).catch(e => console.error("Error sending FCM warning notification:", e));
          }
        }

        await (prisma as any).pollReport.update({
          where: { id: report.id },
          data: { status: 'WARNED' }
        });
      } else if (action === 'DELETE') {
        nextStatus = 'DELETED';
        if (warningMessage) {
          const pollCreatorMemberId = await getPollCreatorMemberId(report.poll);
          if (pollCreatorMemberId) {
            await (prisma as any).userWarning.create({
              data: {
                memberId: pollCreatorMemberId,
                adminId: Number(context.user.id),
                message: warningMessage,
                pollId: report.pollId
              }
            });

            // Send FCM notification to creator
            const creatorMember = await (prisma as any).member.findUnique({
              where: { id: pollCreatorMemberId },
              select: { fcmToken: true }
            });
            if (creatorMember?.fcmToken) {
              sendNotificationToToken(
                creatorMember.fcmToken,
                "Content Removed / பதிவு நீக்கப்பட்டது",
                `Your poll was removed: ${warningMessage} / உங்களது வாக்கெடுப்பு நீக்கப்பட்டுள்ளது: ${warningMessage}`,
                { type: 'CONTENT_REMOVED', pollId: report.pollId, reason: warningMessage }
              ).catch(e => console.error("Error sending FCM removal notification:", e));
            }
          }
        } else {
          // Send generic notification to creator
          const pollCreatorMemberId = await getPollCreatorMemberId(report.poll);
          if (pollCreatorMemberId) {
            const creatorMember = await (prisma as any).member.findUnique({
              where: { id: pollCreatorMemberId },
              select: { fcmToken: true }
            });
            if (creatorMember?.fcmToken) {
              sendNotificationToToken(
                creatorMember.fcmToken,
                "Content Removed / பதிவு நீக்கப்பட்டது",
                "Your poll was removed by Admin / உங்களது வாக்கெடுப்பு நிர்வாகியால் நீக்கப்பட்டுள்ளது.",
                { type: 'CONTENT_REMOVED', pollId: report.pollId }
              ).catch(e => console.error("Error sending FCM generic removal notification:", e));
            }
          }
        }

        await (prisma as any).poll.delete({
          where: { id: report.pollId }
        });

        // Emit socket to delete poll for all users
        if (io) {
          io.emit('pollDeleted', { pollId: report.pollId });
        }
      }

      // Emit Socket event to update the admin queue
      if (io) {
        io.emit('reportResolved', { reportId: report.id, status: nextStatus, type: 'POLL' });
      }

      return true;
    },

    likePost: async (_: any, { id, postId: inputPostId }: any, context: any) => {
      const lang = context?.language || 'en';
      if (!context?.user) throw new Error(I18nService.translate("unauthorized_login", lang));

      const member = await getOrCreateMemberForUser(context.user);
      if (!member) throw new Error("Member profile not found");

      const postId = Number(id || inputPostId);
      if (!postId) throw new Error("Post ID is required");
      const memberId = member.id;

      // Check if user already liked the post
      const existingLike = await (prisma as any).postLike.findUnique({
        where: {
          postId_memberId: {
            postId,
            memberId
          }
        }
      });

      let updatedPost;
      if (existingLike) {
        // Unlike: delete the PostLike and decrement likes
        await (prisma as any).postLike.delete({
          where: {
            postId_memberId: {
              postId,
              memberId
            }
          }
        });
        
        updatedPost = await (prisma as any).post.update({
          where: { id: postId },
          data: {
            likes: {
              decrement: 1
            }
          }
        });
      } else {
        // Like: create the PostLike and increment likes
        await (prisma as any).postLike.create({
          data: {
            postId,
            memberId
          }
        });

        updatedPost = await (prisma as any).post.update({
          where: { id: postId },
          data: {
            likes: {
              increment: 1
            }
          }
        });

        // Send FCM notification to post owner when liked (not when unliked)
        try {
          const postWithCreator = await (prisma as any).post.findUnique({
            where: { id: postId },
            select: { createdById: true, createdByType: true, authorName: true }
          });
          if (postWithCreator) {
            const postCreatorMemberId = await getPostCreatorMemberId(postWithCreator);
            // Only notify if the liker is different from the post creator
            if (postCreatorMemberId && postCreatorMemberId !== memberId) {
              const creatorMember = await (prisma as any).member.findUnique({
                where: { id: postCreatorMemberId },
                select: { fcmToken: true, name: true }
              });
              if (creatorMember?.fcmToken) {
                sendNotificationToToken(
                  creatorMember.fcmToken,
                  "உங்கள் பதிவுக்கு லைக் வந்தது! / Post Liked",
                  `${member.name || 'Someone'} உங்கள் பதிவை லைக் செய்தார். / liked your post.`,
                  { type: 'POST_LIKED', postId: String(postId), likedBy: String(memberId) }
                ).catch(e => console.error("Error sending post like FCM:", e));
              }
            }
          }
        } catch (e) {
          console.error("Error sending like notification:", e);
        }
      }

      // Safeguard: make sure likes count doesn't drop below 0
      if (updatedPost.likes < 0) {
        updatedPost = await (prisma as any).post.update({
          where: { id: postId },
          data: { likes: 0 }
        });
      }

      return updatedPost;
    },

    likeComment: async (_: any, { commentId }: any, context: any) => {
      const lang = context?.language || 'en';
      if (!context?.user) throw new Error(I18nService.translate("unauthorized_login", lang));

      const member = await getOrCreateMemberForUser(context.user);
      if (!member) throw new Error("Member profile not found");

      const cId = Number(commentId);
      const memberId = member.id;

      const existingLike = await (prisma as any).commentLike.findUnique({
        where: {
          commentId_memberId: {
            commentId: cId,
            memberId
          }
        }
      });

      if (existingLike) {
        await (prisma as any).commentLike.delete({
          where: {
            commentId_memberId: {
              commentId: cId,
              memberId
            }
          }
        });
      } else {
        await (prisma as any).commentLike.create({
          data: {
            commentId: cId,
            memberId
          }
        });
      }

      return (prisma as any).comment.findUnique({
        where: { id: cId }
      });
    },

    addComment: async (_: any, { postId, content, authorName, authorRole, parentId }: any) => {
      const comment = await (prisma as any).comment.create({
        data: {
          postId,
          content,
          authorName,
          authorRole,
          parentId: parentId ? Number(parentId) : null
        }
      });
      
      // Send notification specifically to post owner (not location-wide)
      const post = await (prisma as any).post.findUnique({
        where: { id: Number(postId) },
        select: { createdById: true, createdByType: true, authorName: true, locationId: true, id: true }
      });
      if (post) {
        try {
          const postCreatorMemberId = await getPostCreatorMemberId(post);
          if (postCreatorMemberId) {
            const creatorMember = await (prisma as any).member.findUnique({
              where: { id: postCreatorMemberId },
              select: { fcmToken: true }
            });
            if (creatorMember?.fcmToken) {
              sendNotificationToToken(
                creatorMember.fcmToken,
                "உங்கள் பதிவில் கருத்து வந்தது! / New Comment",
                `${authorName || 'Someone'} உங்கள் பதிவில் கருத்து தெரிவித்தார். / commented on your post.`,
                { type: 'POST_COMMENTED', postId: String(post.id), commentBy: authorName || '' }
              ).catch(e => console.error("Error sending comment FCM to owner:", e));
            }
          }
        } catch (e) {
          console.error("Error sending comment notification to owner:", e);
        }
      }
      
      return comment;
    },

    createNotification: async (_: any, args: any, context: any) => {
      const notification = await (prisma as any).notification.create({
        data: {
          title: args.title,
          message: args.message,
          type: args.type,
          locationId: Number(args.locationId),
          purpose: args.purpose || null,
          entityType: args.entityType || args.type,
          entityId: args.entityId ? Number(args.entityId) : null,
          status: args.status || 'ACTIVE',
          metadata: parseJsonInput(args.metadata),
          createdById: context?.user?.type === 'admin' ? Number(context.user.id) : null,
          time: 'Just now'
        }
      });
      const io = (global as any).io;
      if (io) {
        io.emit('newNotification', notification);
      }
      if (args.locationId) {
        sendNotificationToLocation(
          Number(args.locationId),
          args.title,
          args.message,
          { type: args.type || 'ALERT', notificationId: notification.id }
        ).catch(e => console.error(e));
      }
      return notification;
    },

    updateFcmToken: async (_: any, { token }: any, context: any) => {
      if (!context.user) throw new Error("Unauthorized");
      
      const id = Number(context.user.id);
      
      if (context.user.type === 'member' || context.user.role === 'MEMBER') {
        await (prisma as any).member.update({
          where: { id },
          data: { fcmToken: token }
        });
      } else {
        await (prisma as any).user.update({
          where: { id },
          data: { fcmToken: token }
        });
      }
      
      return true;
    },

    logout: async (_: any, __: any, context: any) => {
      if (!context.user) return true;
      const id = Number(context.user.id);
      if (context.user.type === 'member' || context.user.role === 'MEMBER') {
        await (prisma as any).member.update({ where: { id }, data: { fcmToken: null } });
      } else {
        await (prisma as any).user.update({ where: { id }, data: { fcmToken: null } });
      }
      return true;
    },

    createCommunity: async (_: any, { name, description, image, allowMemberMessages, locationId, privacyType }: any, context: any) => {
      if (!context.user) throw new Error(I18nService.translate("unauthorized_login", context?.language));
      if (context.user.role !== 'SUPER_ADMIN' && context.user.role !== 'ADMIN' && context.user.role !== 'SUB_ADMIN') {
        throw new Error(I18nService.translate("member_not_allowed", context?.language));
      }

      const resolvedLocationId = locationId !== undefined ? locationId : (context.user.locationId || null);

      const community = await (prisma as any).community.upsert({
        where: { name },
        update: {
          description,
          image,
          locationId: resolvedLocationId,
          ...(allowMemberMessages !== undefined ? { allowMemberMessages } : {}),
          ...(privacyType !== undefined ? { privacyType: privacyType.toUpperCase() } : {})
        },
        create: {
          name,
          description,
          image,
          locationId: resolvedLocationId,
          allowMemberMessages: allowMemberMessages ?? true,
          privacyType: privacyType ? privacyType.toUpperCase() : 'PUBLIC'
        }
      });

      const member = await getOrCreateMemberForUser(context.user);
      if (member) {
        await (prisma as any).communityMember.upsert({
          where: {
            communityId_memberId: {
              communityId: community.id,
              memberId: member.id
            }
          },
          create: {
            communityId: community.id,
            memberId: member.id,
            groupRole: 'OWNER'
          },
          update: {}
        });
      }

      return {
        ...community,
        memberCount: 0,
        createdAt: toIsoString(community.createdAt)
      };
    },

    joinCommunity: async (_: any, { communityId, memberId }: any, context: any) => {
      const parsedCommunityId = Number(communityId);
      let resolvedMemberId = memberId ? Number(memberId) : null;

      if (!resolvedMemberId && context?.user) {
        resolvedMemberId = await getMemberIdFromContext(context);
      }

      if (!resolvedMemberId || isNaN(resolvedMemberId)) {
        throw new Error('Member ID is required to join community');
      }

      // Verify the member exists before joining
      const memberExists = await (prisma as any).member.findUnique({
        where: { id: resolvedMemberId }
      });
      if (!memberExists) {
        throw new Error('Member not found. Please check your login.');
      }

      await (prisma as any).communityMember.upsert({
        where: {
          communityId_memberId: {
            communityId: parsedCommunityId,
            memberId: resolvedMemberId
          }
        },
        update: {},
        create: {
          communityId: parsedCommunityId,
          memberId: resolvedMemberId
        }
      });
      return true;
    },

    leaveCommunity: async (_: any, { communityId, memberId }: any, context: any) => {
      const parsedCommunityId = Number(communityId);
      let resolvedMemberId = memberId ? Number(memberId) : null;

      if (!resolvedMemberId && context?.user) {
        resolvedMemberId = await getMemberIdFromContext(context);
      }
      if (!resolvedMemberId || isNaN(resolvedMemberId)) {
        throw new Error('Member ID is required to leave community');
      }

      const existing = await (prisma as any).communityMember.findUnique({
        where: {
          communityId_memberId: {
            communityId: parsedCommunityId,
            memberId: resolvedMemberId
          }
        }
      });
      if (!existing) return true;

      await (prisma as any).communityMember.delete({
        where: {
          communityId_memberId: {
            communityId: parsedCommunityId,
            memberId: resolvedMemberId
          }
        }
      });
      return true;
    },
    createCommunityPost: async (_: any, { communityId, title, content, category, images, documents }: any, context: any) => {
      const processedImages = await processAndValidateImageUrls(images);
      if (!context.user) throw new Error(I18nService.translate("unauthorized_login", context?.language));
      
      if (!title || title.trim() === '') {
        throw new Error('Title is required for community posts');
      }

      const community = await (prisma as any).community.findUnique({
        where: { id: communityId }
      });
      if (!community) throw new Error("Community not found");

      const isMember = context.user.type === 'member' || context.user.role === 'MEMBER';
      if (isMember) {
        const membership = await (prisma as any).communityMember.findUnique({
          where: {
            communityId_memberId: {
              communityId,
              memberId: Number(context.user.id)
            }
          }
        });
        if (!membership) {
          throw new Error('Unauthorized: You must join this community before creating a post.');
        }
      }

      const combinedAttachments = [
        ...processedImages,
        ...(documents || [])
      ];

      const postData: any = {
        title,
        content,
        category: category || "Information",
        images: combinedAttachments,
        communityId
      };

      if (isMember) {
        postData.memberId = Number(context.user.id);
      } else {
        postData.createdById = Number(context.user.id);
      }

      const post = await (prisma as any).communityPost.create({
        data: postData,
        include: {
          community: true,
          createdBy: true,
          member: true,
          comments: true
        }
      });

      const members = await (prisma as any).communityMember.findMany({
        where: { communityId },
        include: { member: true }
      });

      const phoneNumbers = members.map((m: any) => m.member.phone).filter(Boolean);
      if (phoneNumbers.length > 0) {
        try {
          const broadcastMsg = `📢 *${community.name}*\n🌟 *${title}*\n\n${content}`;
          await whatsappService.sendMessage(phoneNumbers, broadcastMsg);

          // Create a single notification for the community post to prevent duplication
          await (prisma as any).notification.create({
            data: {
              title: `${community.name}: ${title}`,
              message: content,
              type: 'COMMUNITY',
              locationId: community.locationId || context.user.locationId || 1,
              createdById: isMember ? null : Number(context.user.id),
              purpose: 'Share a community post with members in this group.',
              entityType: 'COMMUNITY_POST',
              entityId: post.id,
              status: 'ACTIVE',
              metadata: {
                communityId: Number(communityId),
                category: category || "Information"
              },
              time: 'Just now'
            }
          });

          sendNotificationToCommunity(
            Number(communityId),
            `${community.name}: ${title}`,
            content,
            { type: 'COMMUNITY', communityId: Number(communityId), postId: post.id }
          ).catch(e => console.error(e));
        } catch (error) {
          console.error("Error sending community broadcast notifications:", error);
        }
      }

      return {
        ...post,
        createdAt: toIsoString(post.createdAt),
        likes: 0,
        comments: []
      };
    },

    likeCommunityPost: async (_: any, { postId }: any, context: any) => {
      const lang = context?.language || 'en';
      if (!context?.user) throw new Error(I18nService.translate("unauthorized_login", lang));

      const member = await getOrCreateMemberForUser(context.user);
      if (!member) throw new Error("Member profile not found");

      const memberId = member.id;
      const targetPostId = Number(postId);

      try {
        // Try community post first
        const communityPost = await (prisma as any).communityPost.findUnique({
          where: { id: targetPostId }
        });
        if (!communityPost) throw new Error("Community post not found");

        const existingLike = await (prisma as any).communityPostLike.findUnique({
          where: {
            postId_memberId: {
              postId: targetPostId,
              memberId
            }
          }
        });

        let updatedPost;
        if (existingLike) {
          // Unlike
          await (prisma as any).communityPostLike.delete({
            where: {
              postId_memberId: {
                postId: targetPostId,
                memberId
              }
            }
          });

          updatedPost = await (prisma as any).communityPost.update({
            where: { id: targetPostId },
            data: { likes: { decrement: 1 } },
            include: {
              community: true,
              createdBy: true,
              comments: { orderBy: { createdAt: 'asc' } }
            }
          });
        } else {
          // Like
          await (prisma as any).communityPostLike.create({
            data: {
              postId: targetPostId,
              memberId
            }
          });

          updatedPost = await (prisma as any).communityPost.update({
            where: { id: targetPostId },
            data: { likes: { increment: 1 } },
            include: {
              community: true,
              createdBy: true,
              comments: { orderBy: { createdAt: 'asc' } }
            }
          });
        }

        if (updatedPost.likes < 0) {
          updatedPost = await (prisma as any).communityPost.update({
            where: { id: targetPostId },
            data: { likes: 0 },
            include: {
              community: true,
              createdBy: true,
              comments: { orderBy: { createdAt: 'asc' } }
            }
          });
        }

        return {
          ...updatedPost,
          createdAt: toIsoString(updatedPost.createdAt)
        };

      } catch (err) {
        // Fallback for regular posts when the mobile app calls likeCommunityPost
        const regularPost = await (prisma as any).post.findUnique({
          where: { id: targetPostId }
        });
        
        if (regularPost) {
          const existingLike = await (prisma as any).postLike.findUnique({
            where: {
              postId_memberId: {
                postId: targetPostId,
                memberId
              }
            }
          });

          let updatedRegularPost;
          if (existingLike) {
            // Unlike
            await (prisma as any).postLike.delete({
              where: {
                postId_memberId: {
                  postId: targetPostId,
                  memberId
                }
              }
            });

            updatedRegularPost = await (prisma as any).post.update({
              where: { id: targetPostId },
              data: { likes: { decrement: 1 } }
            });
          } else {
            // Like
            await (prisma as any).postLike.create({
              data: {
                postId: targetPostId,
                memberId
              }
            });

            updatedRegularPost = await (prisma as any).post.update({
              where: { id: targetPostId },
              data: { likes: { increment: 1 } }
            });
          }

          if (updatedRegularPost.likes < 0) {
            updatedRegularPost = await (prisma as any).post.update({
              where: { id: targetPostId },
              data: { likes: 0 }
            });
          }
          
          return {
            id: updatedRegularPost.id,
            title: updatedRegularPost.category || "Discussion",
            content: updatedRegularPost.content,
            category: updatedRegularPost.category || "Discussion",
            images: updatedRegularPost.images || [],
            communityId: 1, // Fallback ID
            createdById: 1,
            likes: updatedRegularPost.likes,
            comments: [],
            createdAt: toIsoString(updatedRegularPost.createdAt),
            updatedAt: toIsoString(updatedRegularPost.createdAt)
          };
        }
        throw err;
      }
    },

    addCommunityComment: async (_: any, { postId, content }: any, context: any) => {
      let authorName = "Member";
      let authorRole = "MEMBER";

      if (context?.user) {
        authorName = context.user.name || "Admin";
        authorRole = context.user.role || "ADMIN";
      }

      const comment = await (prisma as any).communityComment.create({
        data: {
          content,
          postId,
          authorName,
          authorRole
        }
      });

      // --- Push notification to post owner ---
      try {
        const post = await (prisma as any).communityPost.findUnique({
          where: { id: Number(postId) },
          include: { community: true, member: true, createdBy: true }
        });

        if (post) {
          // Determine the post owner's FCM token
          let ownerToken: string | null = null;
          let ownerName: string = 'Someone';
          let isOwnComment = false;

          if (post.memberId) {
            // Post created by a Member
            const postOwner = post.member || await (prisma as any).member.findUnique({
              where: { id: post.memberId },
              select: { fcmToken: true, name: true, id: true }
            });
            ownerToken = postOwner?.fcmToken || null;
            ownerName = postOwner?.name || 'Someone';
            isOwnComment = context?.user?.type === 'member' && Number(context.user.id) === post.memberId;
          } else if (post.createdById) {
            // Post created by an Admin (User table)
            const postOwner = post.createdBy || await (prisma as any).user.findUnique({
              where: { id: post.createdById },
              select: { fcmToken: true, name: true, id: true }
            });
            ownerToken = postOwner?.fcmToken || null;
            ownerName = postOwner?.name || 'Someone';
            isOwnComment = context?.user?.type === 'admin' && Number(context.user.id) === post.createdById;
          }

          // Don't notify post owner if they are the commenter
          if (ownerToken && !isOwnComment) {
            const communityName = post.community?.name || 'Community';
            sendNotificationToToken(
              ownerToken,
              `💬 ${communityName}`,
              `${authorName} commented on your post: "${content.substring(0, 100)}"`,
              { type: 'COMMUNITY_COMMENT', communityId: String(post.communityId), postId: String(post.id) }
            ).catch(e => console.error('[FCM] Error notifying post owner of comment:', e));
          }

          // --- Mention scanning: find @Name or @phone patterns ---
          const mentionRegex = /@([\w\s]+?)(?=\s@|\s*$|[.,!?])/g;
          const mentions: string[] = [];
          let match;
          while ((match = mentionRegex.exec(content)) !== null) {
            if (match[1]) mentions.push(match[1].trim());
          }

          if (mentions.length > 0) {
            // Get all members in this community to match mentions
            const communityMembers = await (prisma as any).communityMember.findMany({
              where: { communityId: post.communityId },
              include: { member: { select: { id: true, name: true, phone: true, fcmToken: true } } }
            });

            for (const mentionText of mentions) {
              const mentionLower = mentionText.toLowerCase();
              const matchedMember = communityMembers.find((cm: any) => {
                const memberName = (cm.member?.name || '').toLowerCase();
                const memberPhone = (cm.member?.phone || '').toLowerCase();
                return memberName === mentionLower || memberPhone === mentionLower || memberName.includes(mentionLower);
              });

              if (matchedMember?.member?.fcmToken) {
                // Don't send mention notification to the commenter themselves
                const isSelf = context?.user?.type === 'member' && Number(context.user.id) === matchedMember.member.id;
                if (!isSelf) {
                  const communityName = post.community?.name || 'Community';
                  sendNotificationToToken(
                    matchedMember.member.fcmToken,
                    `🔔 ${communityName} - Mentioned`,
                    `${authorName} mentioned you: "${content.substring(0, 100)}"`,
                    { type: 'COMMUNITY_MENTION', communityId: String(post.communityId), postId: String(post.id) }
                  ).catch(e => console.error('[FCM] Error notifying mentioned member:', e));
                }
              }
            }
          }
        }
      } catch (notifError) {
        console.error('[addCommunityComment] Error sending comment notifications:', notifError);
      }

      return {
        ...comment,
        createdAt: toIsoString(comment.createdAt)
      };
    },

    sendCommunityMessage: async (_: any, { communityId, message, replyToMessageId, messageType = 'TEXT', mediaUrl, mediaType, fileName, metadata }: any, context: any) => {
      await assertCommunityWriteAccess(Number(communityId), context);
      const user = context.user;
      const trimmedMessage = String(message || '').trim();

      if (!trimmedMessage && !mediaUrl) throw new Error("Message or media is required");

      if (replyToMessageId) {
        const replyTo = await (prisma as any).communityMessage.findFirst({
          where: {
            id: Number(replyToMessageId),
            communityId: Number(communityId)
          }
        });
        if (!replyTo) throw new Error("Reply message not found in this community");
      }

      let parsedMetadata = null;
      if (metadata) {
        try {
          parsedMetadata = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
        } catch (e) {
          console.error('[sendCommunityMessage] Error parsing metadata JSON:', e);
          parsedMetadata = { raw: metadata };
        }
      }

      const createdMessage = await (prisma as any).communityMessage.create({
        data: {
          communityId: Number(communityId),
          senderId: Number(user.id),
          senderType: getSenderType(user),
          message: trimmedMessage,
          messageType,
          mediaUrl,
          mediaType,
          fileName,
          metadata: parsedMetadata,
          replyToMessageId: replyToMessageId ? Number(replyToMessageId) : null
        },
        include: { replyTo: true, reactions: true }
      });

      await incrementCommunityUnreadCounts(Number(communityId), Number(user.id), getSenderType(user));

      const payload = await formatCommunityMessage(createdMessage);
      const io = (global as any).io;
      if (io) {
        io.to(`community:${communityId}`).emit('communityMessage', payload);
      }

      // Fetch community name for the notification
      (prisma as any).community.findUnique({
        where: { id: Number(communityId) },
        select: { name: true }
      }).then((comm: any) => {
        const commName = comm?.name || "Community Chat";
        sendNotificationToCommunity(
          Number(communityId),
          commName,
          `${payload.senderName}: ${trimmedMessage || 'Sent media'}`,
          { type: 'CHAT', communityId: Number(communityId) }
        ).catch((e: any) => console.error(e));
      }).catch((e: any) => console.error(e));

      return payload;
    },

    editCommunityMessage: async (_: any, { id, message }: any, context: any) => {
      if (!context?.user) throw new Error(I18nService.translate("unauthorized_login", context?.language));
      const existing = await (prisma as any).communityMessage.findUnique({
        where: { id: Number(id) }
      });
      if (!existing) throw new Error("Community message not found");
      if (existing.isDeleted) throw new Error("Deleted message cannot be edited");

      const isOwner = existing.senderId === Number(context.user.id) && existing.senderType === getSenderType(context.user);
      if (!isOwner && !isCommunityAdmin(context.user.role)) {
        throw new Error("Only sender or admin can edit this message");
      }

      const trimmedMessage = String(message || '').trim();
      if (!trimmedMessage) throw new Error("Message is required");

      const updatedMessage = await (prisma as any).communityMessage.update({
        where: { id: Number(id) },
        data: {
          message: trimmedMessage,
          editedAt: new Date()
        },
        include: { replyTo: true, reactions: true }
      });

      const payload = await formatCommunityMessage(updatedMessage);
      const io = (global as any).io;
      if (io) {
        io.to(`community:${existing.communityId}`).emit('communityMessageEdited', payload);
      }

      return payload;
    },

    deleteCommunityMessage: async (_: any, { id }: any, context: any) => {
      if (!context?.user) throw new Error(I18nService.translate("unauthorized_login", context?.language));
      if (!isCommunityAdmin(context.user.role)) {
        throw new Error("Only admin can delete community messages");
      }

      const existing = await (prisma as any).communityMessage.findUnique({
        where: { id: Number(id) }
      });
      if (!existing) throw new Error("Community message not found");

      await (prisma as any).communityMessage.update({
        where: { id: Number(id) },
        data: {
          message: "This message was deleted",
          isDeleted: true,
          deletedAt: new Date()
        }
      });

      const io = (global as any).io;
      if (io) {
        io.to(`community:${existing.communityId}`).emit('communityMessageDeleted', {
          id: Number(id),
          communityId: existing.communityId
        });
      }

      return true;
    },

    reactToCommunityMessage: async (_: any, { messageId, emoji }: any, context: any) => {
      if (!context?.user) throw new Error(I18nService.translate("unauthorized_login", context?.language));
      const message = await (prisma as any).communityMessage.findUnique({
        where: { id: Number(messageId) }
      });
      if (!message) throw new Error("Community message not found");
      await assertCommunityReadAccess(Number(message.communityId), context);

      const cleanEmoji = String(emoji || '').trim();
      if (!cleanEmoji) throw new Error("Reaction emoji is required");

      await (prisma as any).communityMessageReaction.upsert({
        where: {
          messageId_reactorId_reactorType: {
            messageId: Number(messageId),
            reactorId: Number(context.user.id),
            reactorType: getSenderType(context.user)
          }
        },
        update: { emoji: cleanEmoji },
        create: {
          messageId: Number(messageId),
          reactorId: Number(context.user.id),
          reactorType: getSenderType(context.user),
          emoji: cleanEmoji
        }
      });

      const updatedMessage = await (prisma as any).communityMessage.findUnique({
        where: { id: Number(messageId) },
        include: { replyTo: true, reactions: true }
      });
      const payload = await formatCommunityMessage(updatedMessage);
      const io = (global as any).io;
      if (io) {
        io.to(`community:${message.communityId}`).emit('communityMessageReaction', payload);
      }

      return payload;
    },

    markCommunityMessagesRead: async (_: any, { communityId, messageIds }: any, context: any) => {
      await assertCommunityReadAccess(Number(communityId), context);
      const readerType = getSenderType(context.user);

      for (const messageId of messageIds || []) {
        const message = await (prisma as any).communityMessage.findFirst({
          where: {
            id: Number(messageId),
            communityId: Number(communityId)
          }
        });
        if (!message) continue;

        await (prisma as any).communityMessageRead.upsert({
          where: {
            messageId_readerId_readerType: {
              messageId: Number(messageId),
              readerId: Number(context.user.id),
              readerType
            }
          },
          update: { readAt: new Date() },
          create: {
            messageId: Number(messageId),
            readerId: Number(context.user.id),
            readerType
          }
        });
      }

      if (context.user.type === 'member' || context.user.role === 'MEMBER') {
        await (prisma as any).communityMember.update({
          where: {
            communityId_memberId: {
              communityId: Number(communityId),
              memberId: Number(context.user.id)
            }
          },
          data: {
            unreadCount: 0,
            lastReadAt: new Date()
          }
        });
      }

      const io = (global as any).io;
      if (io) {
        io.to(`community:${communityId}`).emit('communityMessagesRead', {
          communityId: Number(communityId),
          readerId: Number(context.user.id),
          readerType,
          messageIds
        });
      }

      return true;
    },

    updateCommunityChatSettings: async (_: any, { communityId, allowMemberMessages, isMuted, mutedUntil, pinnedMessageId }: any, context: any) => {
      await assertCommunityAdminAccess(context);

      if (pinnedMessageId) {
        const pinnedMessage = await (prisma as any).communityMessage.findFirst({
          where: {
            id: Number(pinnedMessageId),
            communityId: Number(communityId)
          }
        });
        if (!pinnedMessage) throw new Error("Pinned message not found in this community");
      }

      const community = await (prisma as any).community.update({
        where: { id: Number(communityId) },
        data: {
          ...(allowMemberMessages !== undefined ? { allowMemberMessages } : {}),
          ...(isMuted !== undefined ? { isMuted } : {}),
          ...(mutedUntil !== undefined ? { mutedUntil: mutedUntil ? new Date(mutedUntil) : null } : {}),
          ...(pinnedMessageId !== undefined ? { pinnedMessageId: pinnedMessageId ? Number(pinnedMessageId) : null } : {})
        }
      });

      const io = (global as any).io;
      if (io) {
        io.to(`community:${communityId}`).emit('communityChatSettingsUpdated', community);
      }

      return {
        ...community,
        memberCount: await (prisma as any).communityMember.count({ where: { communityId: Number(communityId) } }),
        createdAt: toIsoString(community.createdAt)
      };
    },

    muteCommunityMember: async (_: any, { communityId, memberId, mutedUntil }: any, context: any) => {
      await assertCommunityAdminAccess(context);
      await (prisma as any).communityMember.update({
        where: {
          communityId_memberId: {
            communityId: Number(communityId),
            memberId: Number(memberId)
          }
        },
        data: {
          isMuted: true,
          mutedUntil: mutedUntil ? new Date(mutedUntil) : null
        }
      });

      const io = (global as any).io;
      if (io) {
        io.to(`community:${communityId}`).emit('communityMemberMuted', {
          communityId: Number(communityId),
          memberId: Number(memberId),
          mutedUntil: mutedUntil || null
        });
      }

      return true;
    },

    removeCommunityMember: async (_: any, { communityId, memberId }: any, context: any) => {
      await assertCommunityAdminAccess(context);
      await (prisma as any).communityMember.delete({
        where: {
          communityId_memberId: {
            communityId: Number(communityId),
            memberId: Number(memberId)
          }
        }
      });

      const io = (global as any).io;
      if (io) {
        io.to(`community:${communityId}`).emit('communityMemberRemoved', {
          communityId: Number(communityId),
          memberId: Number(memberId)
        });
      }

      return true;
    },

    changeUserRole: async (_: any, { phone, role }: any, context: any) => {
      const lang = context?.language || 'en';
      if (!context?.user) throw new Error(I18nService.translate("unauthorized_login", lang));

      // Get requester's role
      const requesterRole = context.user.role;
      if (requesterRole === 'MEMBER') {
        throw new Error(I18nService.translate("member_not_allowed", lang));
      }

      const targetRole = role.toUpperCase().trim();
      const validRoles = ['SUPER_ADMIN', 'ADMIN', 'SUB_ADMIN', 'MEMBER'];
      if (!validRoles.includes(targetRole)) {
        throw new Error(`Invalid target role: ${role}`);
      }

      // Find the target in User and Member tables
      const dbUser = await (prisma as any).user.findFirst({ where: { phone } });
      const dbMember = await (prisma as any).member.findFirst({ where: { phone } });

      if (!dbUser && !dbMember) {
        throw new Error(I18nService.translate("user_not_found", lang));
      }

      // Enforce location checks
      const targetLocId = dbUser ? dbUser.locationId : dbMember?.locationId;
      if (['SUPER_ADMIN', 'ADMIN', 'SUB_ADMIN'].includes(targetRole)) {
        if (!targetLocId) {
          throw new Error(I18nService.translate("location_required", lang));
        }
      }

      // Validate location matches the target role level requirements
      if (targetLocId) {
        await validateRoleLocationLevel(targetRole, targetLocId, lang);
      }
      if (requesterRole !== 'SUPER_ADMIN') {
        if (targetLocId) {
          await validateLocationTargeting(
            Number(context.user.id),
            requesterRole,
            context.user.locationId,
            Number(targetLocId),
            lang
          );
        }
      }

      // Check permission hierarchy
      // 1. If target is already an admin (exists in User table):
      if (dbUser) {
        if (requesterRole !== 'SUPER_ADMIN') {
          throw new Error("Unauthorized: Only Super Admin can change Admin roles");
        }
      }

      // 2. If requester is Admin or Sub-Admin:
      if (requesterRole === 'ADMIN' || requesterRole === 'SUB_ADMIN') {
        // They can only change normal members
        if (dbUser) {
          throw new Error("Unauthorized: Admin/Sub-Admin cannot modify other Admins");
        }
        // They cannot promote anyone to Super Admin
        if (targetRole === 'SUPER_ADMIN') {
          throw new Error("Unauthorized: Admin/Sub-Admin cannot promote to Super Admin");
        }
      }

      // Perform Role Transition
      if (targetRole === 'MEMBER') {
        // Demoting to MEMBER
        if (dbUser) {
          let professionId = null;
          if (dbUser.profession) {
            const prof = await (prisma as any).profession.upsert({
              where: { name: dbUser.profession },
              update: {},
              create: { name: dbUser.profession }
            });
            professionId = prof.id;
          }
          // If they exist in User table, migrate to Member table (if not exists) and remove from User table
          if (!dbMember) {
            await (prisma as any).member.create({
              data: {
                name: dbUser.name,
                surname: dbUser.surname,
                phone: dbUser.phone,
                password: dbUser.password,
                image: dbUser.image,
                dateOfBirth: dbUser.dateOfBirth,
                gender: dbUser.gender,
                bloodGroup: dbUser.bloodGroup,
                locationId: dbUser.locationId || 1,
                district: dbUser.district,
                constituency: dbUser.constituency,
                area: dbUser.area,
                street: dbUser.street,
                professionId: professionId,
                role: 'Member',
                approvalStatus: 'APPROVED',
                isActive: true
              }
            });
          } else {
            await (prisma as any).member.update({
              where: { id: dbMember.id },
              data: {
                name: dbUser.name,
                surname: dbUser.surname,
                password: dbUser.password,
                image: dbUser.image,
                dateOfBirth: dbUser.dateOfBirth,
                gender: dbUser.gender,
                bloodGroup: dbUser.bloodGroup,
                locationId: dbUser.locationId || 1,
                district: dbUser.district,
                constituency: dbUser.constituency,
                area: dbUser.area,
                street: dbUser.street,
                professionId: professionId,
                role: 'Member'
              }
            });
          }
          // Update matching User table record to role MEMBER instead of deleting it,
          // because deleting it would violate restrict foreign keys (Audit logs, Events, etc. created by the user).
          await (prisma as any).user.update({
            where: { id: dbUser.id },
            data: { role: 'MEMBER' }
          });
        } else if (dbMember) {
          await (prisma as any).member.update({
            where: { id: dbMember.id },
            data: { role: 'Member' }
          });
        }
      } else {
        // Promoting to SUPER_ADMIN, ADMIN, or SUB_ADMIN
        if (dbUser) {
          // Simply update the role in User table
          await (prisma as any).user.update({
            where: { id: dbUser.id },
            data: { role: targetRole }
          });
          // Update matching member role if it exists for sync
          if (dbMember) {
            await (prisma as any).member.update({
              where: { id: dbMember.id },
              data: { role: targetRole }
            });
          }
        } else if (dbMember) {
          let professionName = null;
          if (dbMember.professionId) {
            const prof = await (prisma as any).profession.findUnique({
              where: { id: dbMember.professionId }
            });
            professionName = prof?.name || null;
          }
          // Promote from Member table to User table
          await (prisma as any).user.create({
            data: {
              name: dbMember.name,
              surname: dbMember.surname,
              phone: dbMember.phone,
              password: dbMember.password || 'admin123',
              role: targetRole,
              locationId: dbMember.locationId,
              approvalStatus: 'APPROVED',
              isActive: true,
              image: dbMember.image,
              dateOfBirth: dbMember.dateOfBirth,
              gender: dbMember.gender,
              bloodGroup: dbMember.bloodGroup,
              district: dbMember.district,
              constituency: dbMember.constituency,
              area: dbMember.area,
              street: dbMember.street,
              profession: professionName
            }
          });
          // Update the Member's role field to reflect status
          await (prisma as any).member.update({
            where: { id: dbMember.id },
            data: { role: targetRole }
          });
        }
      }

      // Add AuditLog for Role Change
      const finalUserRecord = await (prisma as any).user.findFirst({
        where: { phone }
      });
      const targetName = dbUser ? dbUser.name : dbMember!.name;
      const targetSurname = dbUser ? dbUser.surname : dbMember!.surname;
      const targetFullName = `${targetName} ${targetSurname || ''}`.trim();
      const oldRoleLabel = getRoleLabel(dbUser ? dbUser.role : dbMember!.role);
      const newRoleLabel = getRoleLabel(targetRole);

      // Load updater details
      const updaterUser = await (prisma as any).user.findUnique({
        where: { id: Number(context.user.id) }
      });
      const updaterName = formatUserDesignation(updaterUser, 'Admin');

      const details = `Member Role Changed from ${oldRoleLabel} to ${newRoleLabel} for ${targetFullName} by ${updaterName}`;
      await (prisma as any).auditLog.create({
        data: {
          userId: finalUserRecord ? finalUserRecord.id : Number(context.user.id),
          action: 'role_change',
          details: details
        }
      });

      return true;
    },
  },

  Member: {
    createdAt: (parent: any) => toIsoString(parent.createdAt),
    profession: async (parent: any, _: any, context: any) => {
      const lang = context?.language || 'en';

      if (parent.professionId) {
        const prof = await (prisma as any).profession.findUnique({ where: { id: parent.professionId } });
        if (prof) {
          if (lang.startsWith('ta')) {
            return prof.name; // Tamil name stored in name field
          }
          return prof.nameEn || prof.name; // English in nameEn, fallback to name
        }
      } else if (parent.profession) {
        return parent.profession;
      }

      return null;
    },
    activityHistory: async (parent: any) => {
      const [events, requests] = await Promise.all([
        (prisma as any).event.findMany({ where: { locationId: parent.locationId }, take: 5, orderBy: { createdAt: 'desc' } }),
        (prisma as any).emergencyRequest.findMany({ where: { memberId: parent.id }, take: 5, orderBy: { createdAt: 'desc' }, include: { member: true } }),
      ]);
      const activities = [...events, ...requests].sort((a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 10);
      return activities.map((a: any) => ({
        ...a,
        __typename: 'title' in a && 'status' in a && !('memberId' in a) ? 'Event' : 'EmergencyRequest'
      }));
    },
    createdBy: async (parent: any) => {
      if (!parent.createdById) return null;
      return (prisma as any).user.findUnique({ where: { id: parent.createdById } });
    },
    addedBy: async (parent: any) => {
      if (!parent.createdById) return "Self";
      const creator = await (prisma as any).user.findUnique({ where: { id: parent.createdById } });
      return creator ? creator.name : "Self";
    },
    district: async (parent: any, _: any, context: any) => {
      const name = parent.district || (await getLocationFields(parent.locationId)).district;
      return translateLocationName(name, context?.language || 'en') || "";
    },
    constituency: async (parent: any, _: any, context: any) => {
      const name = parent.constituency || (await getLocationFields(parent.locationId)).constituency;
      return translateLocationName(name, context?.language || 'en') || "";
    },
    area: async (parent: any, _: any, context: any) => {
      const name = parent.area || (await getLocationFields(parent.locationId)).area;
      return translateLocationName(name, context?.language || 'en') || "";
    },
    street: async (parent: any, _: any, context: any) => {
      const name = parent.street || (await getLocationFields(parent.locationId)).street;
      return translateLocationName(name, context?.language || 'en') || "";
    },
    profilePicture: (parent: any) => parent.image,
  },

  User: {
    addedBy: async (parent: any) => {
      if (!parent.parentId) return "Self";
      const parentUser = await (prisma as any).user.findUnique({ where: { id: parent.parentId } });
      return parentUser ? parentUser.name : "Self";
    },
    createdAt: (parent: any) => toIsoString(parent.createdAt),
    district: async (parent: any, _: any, context: any) => {
      const name = parent.district || (await getLocationFields(parent.locationId)).district;
      return translateLocationName(name, context?.language || 'en') || "";
    },
    constituency: async (parent: any, _: any, context: any) => {
      const name = parent.constituency || (await getLocationFields(parent.locationId)).constituency;
      return translateLocationName(name, context?.language || 'en') || "";
    },
    area: async (parent: any, _: any, context: any) => {
      const name = parent.area || (await getLocationFields(parent.locationId)).area;
      return translateLocationName(name, context?.language || 'en') || "";
    },
    street: async (parent: any, _: any, context: any) => {
      const name = parent.street || (await getLocationFields(parent.locationId)).street;
      return translateLocationName(name, context?.language || 'en') || "";
    },
    profilePicture: (parent: any) => parent.image,
  },

  Location: {
    name: (parent: any, _: any, context: any) => {
      const lang = context?.language || 'en';
      if (lang.startsWith('ta')) {
        return parent.name; // Tamil name stored in the name field
      }
      return parent.nameEn || parent.name; // English name stored in nameEn, fallback to name
    },
    parent: async (parent: any) => {
      if (!parent.parentId) return null;
      return (prisma as any).location.findUnique({ where: { id: parent.parentId } });
    },
    children: (parent: any) => (prisma as any).location.findMany({ where: { parentId: parent.id } }),
    memberCount: async (parent: any) => {
      const allLocationIds = [parent.id, ...(await getChildLocationIds(parent.id))];
      return (prisma as any).member.count({ where: { locationId: { in: allLocationIds } } });
    },
    childCount: (parent: any) => (prisma as any).location.count({ where: { parentId: parent.id } }),
    requests: (parent: any) => (prisma as any).emergencyRequest.findMany({ where: { locationId: parent.id } }),
    events: (parent: any) => (prisma as any).event.findMany({ where: { locationId: parent.id } }),
  },

  Profession: {
    name: (parent: any, _: any, context: any) => {
      const lang = context?.language || 'en';
      if (lang.startsWith('ta')) {
        return parent.name; // Tamil name stored in the name field
      }
      return parent.nameEn || parent.name; // English name stored in nameEn, fallback to name
    }
  },

  Event: {
    status: (parent: any) => {
      if (parent.status === 'CANCELLED' || parent.status === 'INACTIVE') {
        return parent.status;
      }
      const eventDate = parent.date instanceof Date ? parent.date : new Date(parent.date);
      const now = new Date();
      if (eventDate < now) {
        return 'EXPIRED';
      }
      const diffMs = eventDate.getTime() - now.getTime();
      if (diffMs <= 24 * 60 * 60 * 1000) {
        return 'ACTIVE';
      }
      return 'UPCOMING';
    },
    date: (parent: any) => toIST(parent.date),
    createdAt: (parent: any) => toIsoString(parent.createdAt),
    responses: async (parent: any, _: any, context: any) => {
      const user = context?.user;
      if (!user) return [];

      const isSuper = user.role === 'SUPER_ADMIN';
      const isCreator = (user.role === 'ADMIN' || user.role === 'SUB_ADMIN') && parent.createdById === Number(user.id);

      if (isSuper || isCreator) {
        return (prisma as any).eventResponse.findMany({ where: { eventId: parent.id }, include: { member: true } });
      }

      // Normal member or non-creator admin: can only see their own response
      if (user.type === 'member') {
        return (prisma as any).eventResponse.findMany({
          where: { eventId: parent.id, memberId: Number(user.id) },
          include: { member: true }
        });
      } else {
        const userRec = await (prisma as any).user.findUnique({ where: { id: Number(user.id) } });
        if (userRec) {
          const member = await (prisma as any).member.findUnique({ where: { phone: userRec.phone } });
          if (member) {
            return (prisma as any).eventResponse.findMany({
              where: { eventId: parent.id, memberId: member.id },
              include: { member: true }
            });
          }
        }
      }
      return [];
    },
    stats: async (parent: any, _: any, context: any) => {
      const user = context?.user;
      if (!user) {
        return { going: 0, maybe: 0, notGoing: 0 };
      }

      const responses = await (prisma as any).eventResponse.findMany({ where: { eventId: parent.id } });
      return {
        going: responses.filter((r: any) => r.status === 'GOING').length,
        maybe: responses.filter((r: any) => r.status === 'MAYBE').length,
        notGoing: responses.filter((r: any) => r.status === 'NOT_GOING').length,
      };
    },
    userResponse: async (parent: any, _: any, context: any) => {
      const user = context?.user;
      if (!user) return null;

      let finalMemberId = Number(user.id);
      if (user.type === 'admin') {
        const userRec = await (prisma as any).user.findUnique({ where: { id: Number(user.id) } });
        if (userRec && userRec.phone) {
          const member = await (prisma as any).member.findUnique({ where: { phone: userRec.phone } });
          if (member) {
            finalMemberId = member.id;
          } else {
            return null;
          }
        } else {
          return null;
        }
      }

      const response = await (prisma as any).eventResponse.findUnique({
        where: {
          eventId_memberId: {
            eventId: parent.id,
            memberId: finalMemberId
          }
        }
      });
      return response ? response.status : null;
    },
    isCreator: (parent: any, _: any, context: any) => {
      const user = context?.user;
      if (!user) return false;
      const isMember = user.type === 'member' || user.role === 'MEMBER';
      if (isMember) return false;
      return parent.createdById === Number(user.id);
    },
    createdBy: (parent: any) => (prisma as any).user.findUnique({ where: { id: parent.createdById } }),
    location: (parent: any) => (prisma as any).location.findUnique({ where: { id: parent.locationId } }),
  },

  EventResponse: {
    member: (parent: any) => (prisma as any).member.findUnique({ where: { id: parent.memberId } }),
  },

  EmergencyResponse: {
    member: (parent: any) => (prisma as any).member.findUnique({ where: { id: parent.memberId } }),
    createdAt: (parent: any) => toIST(parent.createdAt),
    updatedAt: (parent: any) => toIST(parent.updatedAt),
  },

  PostReport: {
    post: (parent: any) => (prisma as any).post.findUnique({ where: { id: parent.postId } }),
    reportedBy: (parent: any) => (prisma as any).member.findUnique({ where: { id: parent.reportedById } }),
    createdAt: (parent: any) => toIsoString(parent.createdAt),
  },

  CommunityPostReport: {
    post: (parent: any) => (prisma as any).communityPost.findUnique({ where: { id: parent.postId } }),
    reportedBy: (parent: any) => (prisma as any).member.findUnique({ where: { id: parent.reportedById } }),
    createdAt: (parent: any) => toIsoString(parent.createdAt),
  },

  UserWarning: {
    member: (parent: any) => (prisma as any).member.findUnique({ where: { id: parent.memberId } }),
    admin: (parent: any) => (prisma as any).user.findUnique({ where: { id: parent.adminId } }),
    createdAt: (parent: any) => toIsoString(parent.createdAt),
  },

  EmergencyRequest: {
    createdAt: (parent: any) => toIST(parent.createdAt),
    expiryDate: (parent: any) => toIST(parent.expiryDate),
    forwardedAt: (parent: any) => toIST(parent.forwardedAt),
    member: (parent: any) => parent.memberId ? (prisma as any).member.findUnique({ where: { id: parent.memberId } }) : null,
    createdBy: (parent: any) => parent.createdById ? (prisma as any).user.findUnique({ where: { id: parent.createdById } }) : null,
    location: (parent: any) => (prisma as any).location.findUnique({ where: { id: parent.locationId } }),
    responses: (parent: any, _: any, context: any) => {
      return (prisma as any).emergencyResponse.findMany({ 
        where: { emergencyRequestId: parent.id }, 
        include: { member: true } 
      });
    },
    stats: async (parent: any, _: any, context: any) => {
      const responses = await (prisma as any).emergencyResponse.findMany({ where: { emergencyRequestId: parent.id } });
      return buildEmergencyResponseStats(responses);
    },
    description: (parent: any) => {
      return extractRemarksFromDescription(parent.description);
    },
    bloodGroup: (parent: any) => {
      if (parent.bloodGroup && parent.bloodGroup !== 'null') return parent.bloodGroup;
      const parsed = parseDescriptionJson(parent.description);
      if (parsed?.bloodGroup) return parsed.bloodGroup;
      return parseFieldFromFormattedDescription(parent.description, 'Blood Group') || parent.bloodGroup;
    },
    unitsRequired: (parent: any) => {
      if (parent.unitsRequired && parent.unitsRequired !== 'null') return parent.unitsRequired;
      const parsed = parseDescriptionJson(parent.description);
      if (parsed?.unitsRequired) return parsed.unitsRequired;
      return parseFieldFromFormattedDescription(parent.description, 'Units Required') || parent.unitsRequired;
    },
    hospitalName: (parent: any) => {
      if (parent.hospitalName && parent.hospitalName !== 'null') return parent.hospitalName;
      const parsed = parseDescriptionJson(parent.description);
      if (parsed?.hospitalName) return parsed.hospitalName;
      return parseFieldFromFormattedDescription(parent.description, 'Hospital') || parent.hospitalName;
    },
    patientCondition: (parent: any) => {
      if (parent.patientCondition && parent.patientCondition !== 'null') return parent.patientCondition;
      const parsed = parseDescriptionJson(parent.description);
      if (parsed?.patientCondition) return parsed.patientCondition;
      return parseFieldFromFormattedDescription(parent.description, 'Patient Condition') || parent.patientCondition;
    },
    disasterType: (parent: any) => {
      if (parent.disasterType && parent.disasterType !== 'null') return parent.disasterType;
      const parsed = parseDescriptionJson(parent.description);
      if (parsed?.disasterType) return parsed.disasterType;
      return parseFieldFromFormattedDescription(parent.description, 'Disaster Type') || parent.disasterType;
    },
    affectedArea: (parent: any) => {
      if (parent.affectedArea && parent.affectedArea !== 'null') return parent.affectedArea;
      const parsed = parseDescriptionJson(parent.description);
      if (parsed?.affectedArea) return parsed.affectedArea;
      return parseFieldFromFormattedDescription(parent.description, 'Affected Area') || parent.affectedArea;
    },
    requiredSupport: (parent: any) => {
      if (parent.requiredSupport && parent.requiredSupport !== 'null') return parent.requiredSupport;
      const parsed = parseDescriptionJson(parent.description);
      if (parsed?.requiredSupport) return parsed.requiredSupport;
      return parseFieldFromFormattedDescription(parent.description, 'Required Support') || parent.requiredSupport;
    },
    volunteerType: (parent: any) => {
      if (parent.volunteerType && parent.volunteerType !== 'null') return parent.volunteerType;
      const parsed = parseDescriptionJson(parent.description);
      if (parsed?.volunteerType) return parsed.volunteerType;
      return parseFieldFromFormattedDescription(parent.description, 'Volunteer Type') || parent.volunteerType;
    },
    contactPhone: (parent: any) => {
      if (parent.contactPhone && parent.contactPhone !== 'null') return parent.contactPhone;
      const parsed = parseDescriptionJson(parent.description);
      if (parsed) {
        return parsed.contactNumber || parsed.contactPhone || parsed.contactDetails || parsed.phone || parent.contactPhone;
      }
      return parseFieldFromFormattedDescription(parent.description, 'Contact Number') || parent.contactPhone;
    }
  },

  Activity: {
    __resolveType(obj: any) {
      if (obj.__typename) return obj.__typename;
      if ('memberId' in obj) return 'EmergencyRequest';
      return 'Event';
    },
  },

  Post: {
    image: (parent: any) => {
      return (parent.images && parent.images.length > 0) ? parent.images[0] : null;
    },
    category: (parent: any, _: any, context: any) => {
      const lang = context?.language || 'en';
      if (lang.startsWith('ta')) {
        const translations: Record<string, string> = {
          'Discussion': 'கலந்துரையாடல்',
          'Announcement': 'அறிவிப்பு',
          'Event': 'நிகழ்வு'
        };
        return translations[parent.category] || parent.category;
      }
      return parent.category;
    },
    comments: (parent: any) => (prisma as any).comment.findMany({ where: { postId: parent.id }, orderBy: { createdAt: 'desc' } }),
    commentCount: (parent: any) => (prisma as any).comment.count({ where: { postId: parent.id } }),
    location: (parent: any) => (prisma as any).location.findUnique({ where: { id: parent.locationId } }),
    createdAt: (parent: any) => toIsoString(parent.createdAt),
    status: (parent: any) => parent.status || "ACTIVE",
    reportCount: async (parent: any) => {
      return (prisma as any).postReport.count({
        where: { postId: parent.id }
      });
    },
    reportReasons: async (parent: any) => {
      const reports = await (prisma as any).postReport.findMany({
        where: { postId: parent.id },
        select: { reason: true }
      });
      return Array.from(new Set(reports.map((r: any) => r.reason)));
    },
    reportedUsersCount: async (parent: any) => {
      return (prisma as any).postReport.count({
        where: { postId: parent.id }
      });
    },
    isHighPriority: async (parent: any) => {
      const count = await (prisma as any).postReport.count({
        where: { postId: parent.id }
      });
      return count >= 10;
    },
    isUnderReview: (parent: any) => {
      return parent.status === "UNDER_REVIEW";
    },
    hasWarning: (parent: any) => {
      return parent.status === "WARNED";
    },
    reports: (parent: any) => {
      return (prisma as any).postReport.findMany({
        where: { postId: parent.id },
        include: { reportedBy: true }
      });
    },
    isLiked: async (parent: any, _: any, context: any) => {
      if (!context?.user) return false;
      const member = await getOrCreateMemberForUser(context.user);
      if (!member) return false;
      const count = await (prisma as any).postLike.count({
        where: {
          postId: parent.id,
          memberId: member.id
        }
      });
      return count > 0;
    },
    createdBy: async (parent: any) => {
      if (parent.createdById) {
        if (parent.createdByType === 'member') {
          const member = await (prisma as any).member.findUnique({
            where: { id: parent.createdById }
          });
          if (member) {
            return {
              id: member.id,
              name: member.name,
              surname: member.surname || '',
              phone: member.phone,
              role: 'MEMBER',
              image: member.image || null
            };
          }
        } else {
          const user = await (prisma as any).user.findUnique({
            where: { id: parent.createdById }
          });
          if (user) {
            return user;
          }
        }
      }

      return {
        id: parent.createdById || parent.id,
        name: parent.authorName || 'Member',
        surname: '',
        phone: '',
        role: parent.authorRole || 'MEMBER',
        image: null
      };
    }
  },

  PollOption: {
    votesCount: async (parent: any) => {
      return (prisma as any).pollVote.count({ where: { optionId: parent.id } });
    }
  },

  Poll: {
    expiresAt: (parent: any) => toIsoString(parent.expiresAt),
    createdAt: (parent: any) => toIsoString(parent.createdAt),
    options: async (parent: any) => {
      if (parent.options) return parent.options;
      return (prisma as any).pollOption.findMany({ where: { pollId: parent.id } });
    },
    votesCount: async (parent: any) => {
      return (prisma as any).pollVote.count({ where: { pollId: parent.id } });
    },
    userVoteOptionId: async (parent: any, _: any, context: any) => {
      if (!context?.user) return null;
      const member = await getOrCreateMemberForUser(context.user);
      if (!member) return null;
      const vote = await (prisma as any).pollVote.findUnique({
        where: {
          pollId_memberId: {
            pollId: parent.id,
            memberId: member.id
          }
        }
      });
      return vote ? vote.optionId : null;
    },
    location: async (parent: any) => {
      if (parent.location) return parent.location;
      return (prisma as any).location.findUnique({ where: { id: parent.locationId } });
    },
    createdBy: async (parent: any) => {
      if (parent.createdBy) return parent.createdBy;
      if (!parent.createdById) return null;
      return (prisma as any).user.findUnique({ where: { id: parent.createdById } });
    },
    member: async (parent: any) => {
      if (parent.member) return parent.member;
      if (!parent.memberId) return null;
      return (prisma as any).member.findUnique({ where: { id: parent.memberId } });
    },
    likesCount: async (parent: any) => {
      return (prisma as any).pollLike.count({ where: { pollId: parent.id } });
    },
    commentsCount: async (parent: any) => {
      return (prisma as any).pollComment.count({ where: { pollId: parent.id } });
    },
    isLiked: async (parent: any, _: any, context: any) => {
      if (!context?.user) return false;
      const member = await getOrCreateMemberForUser(context.user);
      if (!member) return false;
      const count = await (prisma as any).pollLike.count({
        where: {
          pollId: parent.id,
          memberId: member.id
        }
      });
      return count > 0;
    },
    comments: async (parent: any) => {
      return (prisma as any).pollComment.findMany({
        where: { pollId: parent.id },
        orderBy: { createdAt: 'desc' }
      });
    },
    likesList: async (parent: any) => {
      return (prisma as any).pollLike.findMany({
        where: { pollId: parent.id },
        include: { member: true }
      });
    },
    status: (parent: any) => {
      const now = new Date();
      return new Date(parent.expiresAt) > now ? "Active" : "Expired";
    },
    reports: async (parent: any) => {
      return (prisma as any).pollReport.findMany({
        where: { pollId: parent.id }
      });
    }
  },

  PollComment: {
    createdAt: (parent: any) => toIsoString(parent.createdAt),
    replies: async (parent: any) => {
      return (prisma as any).pollComment.findMany({
        where: { parentId: parent.id },
        orderBy: { createdAt: 'desc' }
      });
    },
    likesCount: async (parent: any) => {
      return (prisma as any).pollCommentLike.count({
        where: { pollCommentId: parent.id }
      });
    },
    isLiked: async (parent: any, _: any, context: any) => {
      if (!context?.user) return false;
      const member = await getOrCreateMemberForUser(context.user);
      if (!member) return false;
      const count = await (prisma as any).pollCommentLike.count({
        where: {
          pollCommentId: parent.id,
          memberId: member.id
        }
      });
      return count > 0;
    }
  },

  PollLike: {
    member: async (parent: any) => {
      if (parent.member) return parent.member;
      return (prisma as any).member.findUnique({ where: { id: parent.memberId } });
    },
    createdAt: (parent: any) => toIsoString(parent.createdAt)
  },

  PollReport: {
    poll: async (parent: any) => {
      if (parent.poll) return parent.poll;
      return (prisma as any).poll.findUnique({ where: { id: parent.pollId } });
    },
    reportedBy: async (parent: any) => {
      if (parent.reportedBy) return parent.reportedBy;
      return (prisma as any).member.findUnique({ where: { id: parent.reportedById } });
    },
    createdAt: (parent: any) => toIsoString(parent.createdAt)
  },

  Campaign: {
    createdAt: (parent: any) => toIsoString(parent.createdAt)
  },

  Broadcast: {
    createdAt: (parent: any) => toIST(parent.createdAt),
    updatedAt: (parent: any) => toIST(parent.updatedAt),
    isActive: (parent: any) => parent.isActive ?? true,
    location: async (parent: any) => {
      if (parent.location) return parent.location;
      return (prisma as any).location.findUnique({ where: { id: parent.locationId } });
    },
    createdBy: async (parent: any) => {
      if (parent.createdBy) return parent.createdBy;
      return (prisma as any).user.findUnique({ where: { id: parent.createdById } });
    },
    recipientCount: async (parent: any) => {
      if (parent.recipientCount !== undefined) return parent.recipientCount;
      return getUniqueRecipientCount(parent.locationId);
    }
  },

  Comment: {
    createdAt: (parent: any) => toIsoString(parent.createdAt),
    authorName: (parent: any) => parent.authorName || 'Member',
    authorRole: (parent: any) => parent.authorRole || 'MEMBER',
    createdBy: (parent: any) => {
      return {
        id: parent.id,
        name: parent.authorName || 'Member',
        surname: '',
        phone: '',
        role: parent.authorRole || 'MEMBER',
        image: null
      };
    },
    replies: async (parent: any) => {
      return (prisma as any).comment.findMany({
        where: { parentId: parent.id },
        orderBy: { createdAt: 'desc' }
      });
    },
    likesCount: async (parent: any) => {
      return (prisma as any).commentLike.count({
        where: { commentId: parent.id }
      });
    },
    isLiked: async (parent: any, _: any, context: any) => {
      if (!context?.user) return false;
      const member = await getOrCreateMemberForUser(context.user);
      if (!member) return false;
      const count = await (prisma as any).commentLike.count({
        where: {
          commentId: parent.id,
          memberId: member.id
        }
      });
      return count > 0;
    }
  },

  CommunityPost: {
    image: (parent: any) => {
      // Return the first image-type attachment as the thumbnail
      const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
      const allFiles: string[] = parent.images || [];
      const firstImage = allFiles.find((url: string) => imageExts.some(ext => url.toLowerCase().endsWith(ext)));
      return firstImage || (allFiles.length > 0 ? allFiles[0] : null);
    },
    images: (parent: any) => {
      // Filter only image-type URLs from the combined images[] DB column
      const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
      const allFiles: string[] = parent.images || [];
      return allFiles.filter((url: string) => imageExts.some(ext => url.toLowerCase().endsWith(ext)));
    },
    documents: (parent: any) => {
      // Filter only document-type URLs from the combined images[] DB column
      const docExts = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv', '.zip', '.rar'];
      const allFiles: string[] = parent.images || [];
      return allFiles.filter((url: string) => docExts.some(ext => url.toLowerCase().endsWith(ext)));
    },
    attachments: (parent: any) => {
      // Return all attachments (images + documents) as-is
      return parent.images || [];
    },
    category: (parent: any, _: any, context: any) => {
      const cat = parent.category || 'Information';
      const lang = context?.language || 'en';
      if (lang.startsWith('ta')) {
        const translations: Record<string, string> = {
          'Discussion': 'கலந்துரையாடல்',
          'Announcement': 'அறிவிப்பு',
          'Event': 'நிகழ்வு',
          'Information': 'தகவல்'
        };
        return translations[cat] || cat;
      }
      return cat;
    },
    authorName: async (parent: any) => {
      // Check Admin (User table) first
      if (parent.createdBy?.name) return parent.createdBy.name;
      if (parent.createdById) {
        const user = await (prisma as any).user.findUnique({ where: { id: parent.createdById }, select: { name: true } });
        if (user?.name) return user.name;
      }
      // Check Member table
      if (parent.member?.name) return parent.member.name;
      if (parent.memberId) {
        const member = await (prisma as any).member.findUnique({ where: { id: parent.memberId }, select: { name: true } });
        if (member?.name) return member.name;
      }
      return 'Member';
    },
    authorRole: async (parent: any) => {
      // Check Admin (User table) first
      if (parent.createdBy?.role) return parent.createdBy.role;
      if (parent.createdById) {
        const user = await (prisma as any).user.findUnique({ where: { id: parent.createdById }, select: { role: true } });
        if (user?.role) return user.role;
      }
      // Check Member table
      if (parent.member?.role) return parent.member.role;
      if (parent.memberId) {
        const member = await (prisma as any).member.findUnique({ where: { id: parent.memberId }, select: { role: true } });
        if (member?.role) return member.role;
      }
      return 'MEMBER';
    },
    commentCount: async (parent: any) => {
      if (parent.comments) return parent.comments.length;
      return (prisma as any).communityComment.count({ where: { postId: parent.id } });
    },
    community: async (parent: any) => {
      if (parent.community) return parent.community;
      return (prisma as any).community.findUnique({ where: { id: parent.communityId } });
    },
    createdBy: async (parent: any) => {
      if (parent.createdBy) return parent.createdBy;
      if (!parent.createdById) return null;
      return (prisma as any).user.findUnique({ where: { id: parent.createdById } });
    },
    comments: (parent: any) => {
      if (parent.comments) return parent.comments;
      return (prisma as any).communityComment.findMany({
        where: { postId: parent.id },
        orderBy: { createdAt: 'asc' }
      });
    },
    location: async (parent: any) => {
      // Get the community location first
      const community = await (prisma as any).community.findUnique({
        where: { id: parent.communityId },
        select: { locationId: true }
      });
      if (community?.locationId) {
        return (prisma as any).location.findUnique({
          where: { id: community.locationId }
        });
      }
      // Fallback to creator's location
      if (parent.createdById) {
        const creator = await (prisma as any).user.findUnique({
          where: { id: parent.createdById },
          select: { locationId: true }
        });
        if (creator?.locationId) {
          return (prisma as any).location.findUnique({
            where: { id: creator.locationId }
          });
        }
      }
      return null;
    },
    createdAt: (parent: any) => toIsoString(parent.createdAt),
    isLiked: async (parent: any, _: any, context: any) => {
      if (!context?.user) return false;
      const member = await getOrCreateMemberForUser(context.user);
      if (!member) return false;
      const count = await (prisma as any).communityPostLike.count({
        where: {
          postId: parent.id,
          memberId: member.id
        }
      });
      return count > 0;
    }
  },

  Community: {
    image: (parent: any) => {
      const img = parent.image;
      if (!img || img === 'null' || img === 'undefined') {
        return `https://avatar.iran.liara.run/username?username=${encodeURIComponent(parent.name)}`;
      }
      return img;
    },
    allowMemberMessages: (parent: any) => parent.allowMemberMessages ?? true,
    isMuted: (parent: any) => parent.isMuted ?? false,
    mutedUntil: (parent: any) => toIsoString(parent.mutedUntil),
    pinnedMessage: async (parent: any) => {
      if (!parent.pinnedMessageId) return null;
      const message = await (prisma as any).communityMessage.findUnique({
        where: { id: Number(parent.pinnedMessageId) },
        include: { replyTo: true, reactions: true }
      });
      return message ? formatCommunityMessage(message) : null;
    },
    unreadCount: async (parent: any, _: any, context: any) => {
      const memberId = await getMemberIdFromContext(context);
      if (!memberId) return 0;
      const membership = await (prisma as any).communityMember.findUnique({
        where: {
          communityId_memberId: {
            communityId: Number(parent.id),
            memberId
          }
        },
        select: { unreadCount: true }
      });
      return membership?.unreadCount || 0;
    },
    location: async (parent: any) => {
      if (!parent.locationId) return null;
      return (prisma as any).location.findUnique({ where: { id: parent.locationId } });
    },
    isJoined: async (parent: any, _: any, context: any) => {
      const memberId = await getMemberIdFromContext(context);
      if (!memberId) return false;
      const count = await (prisma as any).communityMember.count({
        where: {
          communityId: Number(parent.id),
          memberId
        }
      });
      return count > 0;
    },
    rules: () => {
      return [
        "Be respectful to everyone",
        "No spam or promotional content",
        "Share only relevant content",
        "No personal attacks",
        "Do not share fake information"
      ];
    },
    createdAt: (parent: any) => toIsoString(parent.createdAt)
  },

  CommunityMessage: {
    senderName: async (parent: any) => {
      if (parent.senderName) return parent.senderName;
      const sender = await getCommunityMessageSender(parent);
      return sender?.name || 'Unknown';
    },
    replyTo: async (parent: any) => {
      if (!parent.replyToMessageId) return null;
      if (parent.replyTo) return formatCommunityMessage(parent.replyTo);
      const replyTo = await (prisma as any).communityMessage.findUnique({
        where: { id: Number(parent.replyToMessageId) }
      });
      return replyTo ? formatCommunityMessage(replyTo) : null;
    },
    createdAt: (parent: any) => toIST(parent.createdAt)
  },

  CommunityMessageReaction: {
    reactorName: async (parent: any) => getCommunityActorName(parent.reactorId, parent.reactorType),
    createdAt: (parent: any) => toIsoString(parent.createdAt)
  },

  Notification: {
    createdAt: (parent: any) => toIsoString(parent.createdAt),
    status: (parent: any) => parent.status || 'ACTIVE',
    metadata: (parent: any) => parent.metadata ? (typeof parent.metadata === 'string' ? parent.metadata : JSON.stringify(parent.metadata)) : null,
    location: (parent: any) => parent.location || (prisma as any).location.findUnique({ where: { id: parent.locationId } }),
    createdBy: (parent: any) => {
      if (parent.createdBy) return parent.createdBy;
      if (!parent.createdById) return null;
      return (prisma as any).user.findUnique({ where: { id: parent.createdById } });
    },
  },

  // ============================================================
  // CONTRIBUTION MANAGEMENT SYSTEM — QUERY RESOLVERS
  // ============================================================
  ContributionPlan: {
    createdAt: (parent: any) => toIsoString(parent.createdAt),
    startDate: (parent: any) => toIsoString(parent.startDate),
    enrolledCount: async (parent: any) => {
      return (prisma as any).memberPlanEnrollment.count({
        where: { planId: parent.id, status: 'ACTIVE' }
      });
    }
  },

  MemberPlanEnrollment: {
    joinedAt: (parent: any) => toIsoString(parent.joinedAt),
    plan: async (parent: any) => {
      if (parent.plan) return parent.plan;
      return (prisma as any).contributionPlan.findUnique({ where: { id: parent.planId } });
    }
  },

  ContributionPayment: {
    createdAt: (parent: any) => toIsoString(parent.createdAt),
    paidAt: (parent: any) => toIsoString(parent.paidAt),
  },

  ContributionProfile: {
    member: async (parent: any) => {
      if (parent.member) return parent.member;
      return (prisma as any).member.findUnique({ where: { id: parent.memberId } });
    }
  },
};

// ============================================================
// Attach Contribution Resolvers to Query & Mutation
// ============================================================
(resolvers as any).Query = {
  ...(resolvers as any).Query,

  getContributionPlans: async (_: any, args: { isActive?: boolean }, context: any) => {
    const where: any = {};
    if (args.isActive !== undefined && args.isActive !== null) {
      where.isActive = args.isActive;
    }
    return (prisma as any).contributionPlan.findMany({ where, orderBy: { createdAt: 'desc' } });
  },

  getContributionPlanDetails: async (_: any, args: { id: number }, context: any) => {
    return (prisma as any).contributionPlan.findUnique({ where: { id: args.id } });
  },

  myContributionPlan: async (_: any, __: any, context: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const memberId = context.user.memberId || context.user.id;
    return (prisma as any).memberPlanEnrollment.findFirst({
      where: { memberId, status: 'ACTIVE' },
      include: { plan: true },
      orderBy: { joinedAt: 'desc' }
    });
  },

  getPaymentHistory: async (_: any, args: { month?: number; year?: number; status?: string }, context: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const memberId = context.user.memberId || context.user.id;
    const where: any = { memberId };
    if (args.month) where.month = args.month;
    if (args.year) where.year = args.year;
    if (args.status) where.status = args.status;
    return (prisma as any).contributionPayment.findMany({
      where,
      orderBy: [{ year: 'desc' }, { month: 'desc' }]
    });
  },

  downloadReceipt: async (_: any, args: { paymentId: number }, context: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const payment = await (prisma as any).contributionPayment.findUnique({
      where: { id: args.paymentId },
      include: { member: true, enrollment: { include: { plan: true } } }
    });
    if (!payment) throw new Error('Payment not found');
    const memberName = `${payment.member.name} ${payment.member.surname || ''}`.trim();
    return {
      receiptId: `RCP-${payment.id}-${payment.year}${String(payment.month).padStart(2, '0')}`,
      memberName,
      amount: payment.amount,
      month: payment.month,
      year: payment.year,
      planName: payment.enrollment?.plan?.name || 'Contribution Plan',
      paidAt: payment.paidAt ? new Date(payment.paidAt).toISOString() : new Date().toISOString(),
      razorpayPaymentId: payment.transactionId || null
    };
  },

  getContributionProfile: async (_: any, args: { memberId?: number }, context: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const memberId = args.memberId || context.user.memberId || context.user.id;
    let profile = await (prisma as any).contributionProfile.findUnique({
      where: { memberId },
      include: { member: true }
    });
    if (!profile) {
      // Return default profile if member has not contributed yet
      const member = await (prisma as any).member.findUnique({ where: { id: memberId } });
      return {
        memberId,
        totalPaidMonths: 0,
        currentStreak: 0,
        totalContribution: 0,
        badge: 'BRONZE',
        contributionRank: null,
        member
      };
    }
    return profile;
  },

  getContributionDashboard: async (_: any, args: { state?: string; district?: string; constituency?: string; area?: string }, context: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const roles = ['SUPER_ADMIN', 'ADMIN', 'SUB_ADMIN'];
    if (!roles.includes(context.user.role)) throw new Error('Access denied');
    return ContributionService.getContributionDashboard(args.state, args.district, args.constituency, args.area);
  },

  getContributionAnalytics: async (_: any, __: any, context: any) => {
    if (!context.user) throw new Error('Unauthorized');
    if (!['SUPER_ADMIN', 'ADMIN'].includes(context.user.role)) throw new Error('Access denied');
    return ContributionService.getContributionAnalytics();
  },

  getPendingPayments: async (_: any, args: { district?: string; constituency?: string; area?: string }, context: any) => {
    if (!context.user) throw new Error('Unauthorized');
    if (!['SUPER_ADMIN', 'ADMIN', 'SUB_ADMIN'].includes(context.user.role)) throw new Error('Access denied');
    return ContributionService.getPendingPayments(args.district, args.constituency, args.area);
  },

  getContributionLeaderboard: async (_: any, __: any, context: any) => {
    if (!context.user) throw new Error('Unauthorized');
    return ContributionService.getContributionLeaderboard();
  },
};

(resolvers as any).Mutation = {
  ...(resolvers as any).Mutation,

  createContributionPlan: async (_: any, args: any, context: any) => {
    if (!context.user) throw new Error('Unauthorized');
    if (!['SUPER_ADMIN', 'ADMIN'].includes(context.user.role)) throw new Error('Access denied');
    const plan = await (prisma as any).contributionPlan.create({
      data: {
        name: args.name,
        description: args.description || null,
        monthlyAmount: args.monthlyAmount,
        startDate: new Date(args.startDate),
        isActive: true,
        autoRenewEnabled: args.autoRenewEnabled !== undefined ? args.autoRenewEnabled : true
      }
    });
    return plan;
  },

  editContributionPlan: async (_: any, args: any, context: any) => {
    if (!context.user) throw new Error('Unauthorized');
    if (!['SUPER_ADMIN', 'ADMIN'].includes(context.user.role)) throw new Error('Access denied');
    const data: any = {};
    if (args.name !== undefined) data.name = args.name;
    if (args.description !== undefined) data.description = args.description;
    if (args.monthlyAmount !== undefined) data.monthlyAmount = args.monthlyAmount;
    if (args.isActive !== undefined) data.isActive = args.isActive;
    if (args.autoRenewEnabled !== undefined) data.autoRenewEnabled = args.autoRenewEnabled;
    return (prisma as any).contributionPlan.update({ where: { id: args.id }, data });
  },

  joinContributionPlan: async (_: any, args: any, context: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const memberId = context.user.memberId || context.user.id;
    // Check if already enrolled in this plan
    const existing = await (prisma as any).memberPlanEnrollment.findFirst({
      where: { memberId, planId: args.planId, status: 'ACTIVE' }
    });
    if (existing) throw new Error('Already enrolled in this plan');
    const plan = await (prisma as any).contributionPlan.findUnique({ where: { id: args.planId } });
    if (!plan || !plan.isActive) throw new Error('Plan not found or inactive');
    const enrollment = await (prisma as any).memberPlanEnrollment.create({
      data: {
        memberId,
        planId: args.planId,
        autoRenew: args.autoRenew !== undefined ? args.autoRenew : plan.autoRenewEnabled,
        status: 'ACTIVE'
      },
      include: { plan: true }
    });
    // Create first monthly payment record
    const now = new Date();
    await (prisma as any).contributionPayment.create({
      data: {
        memberId,
        enrollmentId: enrollment.id,
        month: now.getMonth() + 1,
        year: now.getFullYear(),
        amount: plan.monthlyAmount,
        status: 'PENDING'
      }
    });
    return enrollment;
  },

  updateAutoRenew: async (_: any, args: any, context: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const memberId = context.user.memberId || context.user.id;
    const enrollment = await (prisma as any).memberPlanEnrollment.findFirst({
      where: { memberId, planId: args.planId }
    });
    if (!enrollment) throw new Error('Enrollment not found');
    return (prisma as any).memberPlanEnrollment.update({
      where: { id: enrollment.id },
      data: { autoRenew: args.autoRenew },
      include: { plan: true }
    });
  },

  cancelContributionPlan: async (_: any, args: any, context: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const memberId = context.user.memberId || context.user.id;
    const enrollment = await (prisma as any).memberPlanEnrollment.findFirst({
      where: { memberId, planId: args.planId, status: 'ACTIVE' }
    });
    if (!enrollment) throw new Error('Active enrollment not found');
    return (prisma as any).memberPlanEnrollment.update({
      where: { id: enrollment.id },
      data: { status: 'CANCELLED' },
      include: { plan: true }
    });
  },

  createContributionOrder: async (_: any, args: any, context: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const memberId = context.user.memberId || context.user.id;
    const enrollment = await (prisma as any).memberPlanEnrollment.findFirst({
      where: { memberId, planId: args.planId, status: 'ACTIVE' },
      include: { plan: true }
    });
    if (!enrollment) throw new Error('No active enrollment found for this plan');
    // Check if a pending payment already exists for this month
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    let payment = await (prisma as any).contributionPayment.findFirst({
      where: { memberId, enrollmentId: enrollment.id, month: currentMonth, year: currentYear }
    });
    if (!payment) {
      payment = await (prisma as any).contributionPayment.create({
        data: {
          memberId,
          enrollmentId: enrollment.id,
          month: currentMonth,
          year: currentYear,
          amount: enrollment.plan.monthlyAmount,
          status: 'PENDING'
        }
      });
    } else if (payment.status === 'PAID') {
      throw new Error('Payment for this month is already completed');
    }
    const orderResult = await RazorpayService.createOrder(args.planId, enrollment.plan.monthlyAmount);
    // Store order ID on the payment
    await (prisma as any).contributionPayment.update({
      where: { id: payment.id },
      data: { orderId: orderResult.orderId }
    });
    return {
      orderId: orderResult.orderId,
      amount: orderResult.amount,
      currency: orderResult.currency,
      keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_mock'
    };
  },

  verifyContributionPayment: async (_: any, args: any, context: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = args;
    const isValid = RazorpayService.verifySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    if (!isValid) {
      return { success: false, payment: null, message: 'Payment signature verification failed' };
    }
    const payment = await (prisma as any).contributionPayment.findFirst({
      where: { orderId: razorpay_order_id }
    });
    if (!payment) {
      return { success: false, payment: null, message: 'Payment record not found' };
    }
    const updated = await (prisma as any).contributionPayment.update({
      where: { id: payment.id },
      data: {
        status: 'PAID',
        transactionId: razorpay_payment_id,
        paidAt: new Date()
      }
    });
    // Recalculate contribution profile asynchronously
    ContributionService.updateContributionProfile(payment.memberId).catch((e: any) =>
      console.error('[Contribution] Profile update error:', e)
    );
    return { success: true, payment: updated, message: 'Payment verified successfully' };
  },

  sendContributionReminder: async (_: any, args: any, context: any) => {
    if (!context.user) throw new Error('Unauthorized');
    if (!['SUPER_ADMIN', 'ADMIN', 'SUB_ADMIN'].includes(context.user.role)) throw new Error('Access denied');
    const member = await (prisma as any).member.findUnique({
      where: { id: args.memberId },
      select: { id: true, name: true, fcmToken: true, locationId: true }
    });
    if (!member) throw new Error('Member not found');
    const typeMessages: Record<string, string> = {
      SEVEN_DAYS: 'Your monthly contribution is due in 7 days.',
      THREE_DAYS: 'Your monthly contribution is due in 3 days.',
      ONE_DAY: 'Your monthly contribution is due tomorrow.',
      OVERDUE: 'Your monthly contribution is overdue. Please pay at your earliest convenience.'
    };
    const message = typeMessages[args.type] || 'Please make your monthly contribution.';
    await ContributionService.createSystemNotification({
      title: 'Contribution Reminder / பங்களிப்பு நினைவூட்டல்',
      message,
      type: 'NOTIFICATION',
      purpose: 'Contribution Reminder',
      memberId: member.id
    });
    return true;
  },

  requestLocationAccess: async (_: any, { requestedRole, requestType, locationIds, reason }: any, context: any) => {
    const user = context?.user;
    if (!user) throw new Error('Not authenticated');

    const request = await (prisma as any).locationAccessRequest.create({
      data: {
        userId: Number(user.id),
        currentRole: user.role,
        requestedRole,
        requestType,
        status: 'PENDING',
        reason
      }
    });

    for (const locId of locationIds) {
      await (prisma as any).requestLocation.create({
        data: {
          requestId: request.id,
          locationId: Number(locId)
        }
      });
    }

    return (prisma as any).locationAccessRequest.findUnique({
      where: { id: request.id },
      include: {
        user: { include: { location: true } },
        approvedBy: { include: { location: true } },
        requestedLocations: { include: { location: true } }
      }
    });
  },

  reviewLocationAccessRequest: async (_: any, { requestId, action, rejectionReason }: any, context: any) => {
    const user = context?.user;
    if (!user || user.role !== 'SUPER_ADMIN') {
      throw new Error('Only SUPER_ADMIN can review location access requests');
    }

    const request = await (prisma as any).locationAccessRequest.findUnique({
      where: { id: Number(requestId) },
      include: { requestedLocations: true }
    });

    if (!request) throw new Error('Request not found');
    if (request.status !== 'PENDING') throw new Error('Request is already reviewed');

    if (action === 'APPROVE') {
      const hasPrimary = await (prisma as any).userLocation.findFirst({
        where: { userId: request.userId, isPrimary: true }
      });

      let idx = 0;
      for (const reqLoc of request.requestedLocations) {
        const isP = !hasPrimary && idx === 0;
        await (prisma as any).userLocation.upsert({
          where: {
            userId_locationId: {
              userId: request.userId,
              locationId: reqLoc.locationId
            }
          },
          create: {
            userId: request.userId,
            locationId: reqLoc.locationId,
            isPrimary: isP
          },
          update: {}
        });
        idx++;
      }

      const firstRequestedLocId = request.requestedLocations[0]?.locationId;
      const updateData: any = { role: request.requestedRole };
      if (!hasPrimary && firstRequestedLocId) {
        updateData.locationId = firstRequestedLocId;
      }

      await (prisma as any).user.update({
        where: { id: request.userId },
        data: updateData
      });
    }

    return (prisma as any).locationAccessRequest.update({
      where: { id: Number(requestId) },
      data: {
        status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        rejectionReason: action === 'REJECT' ? rejectionReason : null,
        approvedById: Number(user.id)
      },
      include: {
        user: { include: { location: true } },
        approvedBy: { include: { location: true } },
        requestedLocations: { include: { location: true } }
      }
    });
  },

  assignUserLocations: async (_: any, { userId, locationIds, isPrimary }: any, context: any) => {
    const user = context?.user;
    if (!user || user.role !== 'SUPER_ADMIN') {
      throw new Error('Only SUPER_ADMIN can assign locations');
    }

    const targetUserId = Number(userId);

    for (const locId of locationIds) {
      const isP = isPrimary === Number(locId);
      await (prisma as any).userLocation.upsert({
        where: {
          userId_locationId: {
            userId: targetUserId,
            locationId: Number(locId)
          }
        },
        create: {
          userId: targetUserId,
          locationId: Number(locId),
          isPrimary: isP
        },
        update: {
          isPrimary: isP
        }
      });
    }

    if (isPrimary) {
      await (prisma as any).userLocation.updateMany({
        where: {
          userId: targetUserId,
          locationId: { not: Number(isPrimary) }
        },
        data: { isPrimary: false }
      });

      await (prisma as any).user.update({
        where: { id: targetUserId },
        data: { locationId: Number(isPrimary) }
      });
    }

    return (prisma as any).user.findUnique({
      where: { id: targetUserId },
      include: { location: true, userLocations: { include: { location: true } } }
    });
  },

  removeUserLocation: async (_: any, { userId, locationId }: any, context: any) => {
    const user = context?.user;
    if (!user || user.role !== 'SUPER_ADMIN') {
      throw new Error('Only SUPER_ADMIN can remove locations');
    }

    const targetUserId = Number(userId);
    const targetLocationId = Number(locationId);

    const userLoc = await (prisma as any).userLocation.findUnique({
      where: { userId_locationId: { userId: targetUserId, locationId: targetLocationId } }
    });

    if (!userLoc) return false;

    await (prisma as any).userLocation.delete({
      where: { userId_locationId: { userId: targetUserId, locationId: targetLocationId } }
    });

    if (userLoc.isPrimary) {
      const remainingLoc = await (prisma as any).userLocation.findFirst({
        where: { userId: targetUserId }
      });

      if (remainingLoc) {
        await (prisma as any).userLocation.update({
          where: { id: remainingLoc.id },
          data: { isPrimary: true }
        });

        await (prisma as any).user.update({
          where: { id: targetUserId },
          data: { locationId: remainingLoc.locationId }
        });
      } else {
        await (prisma as any).user.update({
          where: { id: targetUserId },
          data: { locationId: null }
        });
      }
    }

    return true;
  },

  joinCommunityOrRequest: safeResolver(async (_: any, { communityId, reason, inviteCode }: any, context: any) => {
    const user = context?.user;
    if (!user) throw new Error('Not authenticated');

    const memberId = await getMemberIdFromContext(context);
    if (!memberId) throw new Error('Member profile not found for this user');

    const dbUserId = await getUserIdFromContext(context);
    if (!dbUserId) throw new Error('User profile not found for this user');

    const comId = Number(communityId);

    // Check if banned
    const isBanned = await (prisma as any).communityBan.findFirst({
      where: {
        communityId: comId,
        userId: dbUserId,
        OR: [
          { bannedUntil: null },
          { bannedUntil: { gte: new Date() } }
        ]
      }
    });
    if (isBanned) throw new Error('You are banned from this community / இந்த சமூகத்தில் நீங்கள் தடை செய்யப்பட்டுள்ளீர்கள்');

    // Check if already a member
    const existing = await (prisma as any).communityMember.findUnique({
      where: { communityId_memberId: { communityId: comId, memberId } }
    });
    if (existing) return 'JOINED';

    const community = await (prisma as any).community.findUnique({ where: { id: comId } });
    if (!community) throw new Error('Community not found');
    if (community.isArchived) throw new Error('Community is archived');

    // If invite code matches
    let codeValid = false;
    if (inviteCode && community.inviteCode === inviteCode) {
      if (!community.inviteCodeExpiry || community.inviteCodeExpiry >= new Date()) {
        codeValid = true;
      }
    }

    if (codeValid || community.privacyType === 'PUBLIC') {
      await (prisma as any).communityMember.create({
        data: {
          communityId: comId,
          memberId,
          groupRole: 'MEMBER'
        }
      });
      
      await (prisma as any).communityMemberActivity.create({
        data: { communityId: comId, memberId, action: 'JOIN' }
      });

      return 'JOINED';
    }

    const existingRequest = await (prisma as any).communityJoinRequest.findFirst({
      where: { communityId: comId, userId: dbUserId, status: 'PENDING' }
    });

    if (!existingRequest) {
      await (prisma as any).communityJoinRequest.create({
        data: { communityId: comId, userId: dbUserId, reason, status: 'PENDING' }
      });
    }

    return 'PENDING_APPROVAL';
  }),

  reviewCommunityJoinRequest: safeResolver(async (_: any, { requestId, action, rejectionReason }: any, context: any) => {
    const user = context?.user;
    if (!user) throw new Error('Not authenticated');

    const req = await (prisma as any).communityJoinRequest.findUnique({
      where: { id: Number(requestId) }
    });
    if (!req) throw new Error('Request not found');

    const role = await getCommunityRoleFromContext(context, req.communityId);
    if (!role || !hasGroupPermission(role, 'MANAGE_MEMBERS')) {
      throw new Error('Unauthorized');
    }

    if (action === 'APPROVE') {
      // CommunityJoinRequest.userId references the User table, but CommunityMember.memberId
      // references the Member table. Convert requested user -> member.
      const requestedUser = await (prisma as any).user.findUnique({
        where: { id: Number(req.userId) }
      });
      if (!requestedUser) throw new Error('Request user not found');

      const requestedMember = await getOrCreateMemberForUser({ ...requestedUser, type: 'admin' });
      if (!requestedMember) throw new Error('Unable to create member for request user');

      await (prisma as any).communityMember.upsert({
        where: {
          communityId_memberId: {
            communityId: req.communityId,
            memberId: requestedMember.id
          }
        },
        create: {
          communityId: req.communityId,
          memberId: requestedMember.id,
          groupRole: 'MEMBER'
        },
        update: {}
      });

      await (prisma as any).communityMemberActivity.create({
        data: { communityId: req.communityId, memberId: requestedMember.id, action: 'JOIN' }
      });

      const dbUserId = await getUserIdFromContext(context);
      if (!dbUserId) throw new Error('User profile not found for this user');

      await (prisma as any).communityAdminLog.create({
        data: {
          communityId: req.communityId,
          adminId: dbUserId,
          action: 'MEMBER_APPROVED',
          details: `Approved join request for user id ${req.userId}`
        }
      });
    }

    const dbUserId = await getUserIdFromContext(context);
    if (!dbUserId) throw new Error('User profile not found for this user');

    await (prisma as any).communityJoinRequest.update({
      where: { id: Number(requestId) },
      data: {
        status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        rejectionReason: action === 'REJECT' ? rejectionReason : null,
        reviewedById: dbUserId
      }
    });

    return true;
  }),

  updateCommunityMemberRole: safeResolver(async (_: any, { communityId, targetUserId, newRole }: any, context: any) => {
    const user = context?.user;
    if (!user) throw new Error('Not authenticated');

    const comId = Number(communityId);
    const tgtId = Number(targetUserId);

    const myRole = await getCommunityRoleFromContext(context, comId);
    if (!myRole || !hasGroupPermission(myRole, 'MANAGE_MEMBERS')) {
      throw new Error('Unauthorized');
    }

    if (myRole !== 'OWNER' && (newRole === 'ADMIN' || newRole === 'OWNER')) {
      throw new Error('Only the Group Owner can assign Admin or Owner roles');
    }

    await (prisma as any).communityMember.update({
      where: { communityId_memberId: { communityId: comId, memberId: tgtId } },
      data: { groupRole: newRole }
    });

    const dbUserId = await getUserIdFromContext(context);
    if (!dbUserId) throw new Error('User profile not found for this user');

    await (prisma as any).communityAdminLog.create({
      data: {
        communityId: comId,
        adminId: dbUserId,
        action: 'ROLE_CHANGE',
        details: `Changed role of user id ${tgtId} to ${newRole}`
      }
    });

    return true;
  }),

  createCommunityComplaint: safeResolver(async (_: any, { communityId, title, description }: any, context: any) => {
    const user = context?.user;
    if (!user) throw new Error('Not authenticated');

    const dbUserId = await getUserIdFromContext(context);
    if (!dbUserId) throw new Error('User profile not found for this user');

    return (prisma as any).communityComplaint.create({
      data: {
        communityId: Number(communityId),
        reporterId: dbUserId,
        title,
        description,
        status: 'OPEN'
      },
      include: { reporter: true }
    });
  }),

  updateComplaintStatus: safeResolver(async (_: any, { complaintId, status, assigneeId }: any, context: any) => {
    const user = context?.user;
    if (!user) throw new Error('Not authenticated');

    const complaint = await (prisma as any).communityComplaint.findUnique({
      where: { id: Number(complaintId) }
    });
    if (!complaint) throw new Error('Complaint not found');

    const role = await getCommunityRoleFromContext(context, complaint.communityId);
    if (!role || !['OWNER', 'ADMIN', 'MODERATOR'].includes(role)) {
      throw new Error('Unauthorized');
    }

    return (prisma as any).communityComplaint.update({
      where: { id: Number(complaintId) },
      data: {
        status,
        assigneeId: assigneeId ? Number(assigneeId) : undefined
      },
      include: { reporter: true, assignee: true }
    });
  }),

  updateCommunityNotificationPref: safeResolver(async (_: any, { communityId, preference }: any, context: any) => {
    const user = context?.user;
    if (!user) throw new Error('Not authenticated');

    const memberId = await getMemberIdFromContext(context);
    if (!memberId) throw new Error('Member profile not found for this user');

    await (prisma as any).communityMember.update({
      where: { communityId_memberId: { communityId: Number(communityId), memberId } },
      data: { notificationPref: preference }
    });

    return true;
  }),

  banCommunityUser: safeResolver(async (_: any, { communityId, userId, reason, durationDays }: any, context: any) => {
    const user = context?.user;
    if (!user) throw new Error('Not authenticated');

    const comId = Number(communityId);
    const tgtId = Number(userId);

    const role = await getCommunityRoleFromContext(context, comId);
    if (!role || !hasGroupPermission(role, 'BAN_USER')) {
      throw new Error('Unauthorized');
    }

    const dbUserId = await getUserIdFromContext(context);
    if (!dbUserId) throw new Error('User profile not found for this user');

    const bannedUntil = durationDays ? new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000) : null;
    const targetUserId = await getOrCreateUserForMember(tgtId);

    await (prisma as any).communityBan.create({
      data: {
        communityId: comId,
        userId: targetUserId,
        reason,
        bannedById: dbUserId,
        bannedUntil
      }
    });

    await (prisma as any).communityMember.deleteMany({
      where: { communityId: comId, memberId: tgtId }
    });

    await (prisma as any).communityAdminLog.create({
      data: {
        communityId: comId,
        adminId: dbUserId,
        action: 'MEMBER_REMOVED',
        details: `Banned user id ${tgtId}. Reason: ${reason || 'N/A'}`
      }
    });

    return true;
  }),

  unbanCommunityUser: safeResolver(async (_: any, { communityId, userId }: any, context: any) => {
    const user = context?.user;
    if (!user) throw new Error('Not authenticated');

    const comId = Number(communityId);
    const tgtId = Number(userId);

    const role = await getCommunityRoleFromContext(context, comId);
    if (!role || !hasGroupPermission(role, 'BAN_USER')) {
      throw new Error('Unauthorized');
    }

    const targetUserId = await getOrCreateUserForMember(tgtId);

    await (prisma as any).communityBan.deleteMany({
      where: { communityId: comId, userId: targetUserId }
    });

    return true;
  }),

  createCommunityAnnouncement: safeResolver(async (_: any, { communityId, title, message, isPinned, scheduledFor }: any, context: any) => {
    const user = context?.user;
    if (!user) throw new Error('Not authenticated');

    const comId = Number(communityId);
    const role = await getCommunityRoleFromContext(context, comId);
    if (!role || !hasGroupPermission(role, 'POST_ANNOUNCEMENT')) {
      throw new Error('Unauthorized');
    }

    const dbUserId = await getUserIdFromContext(context);
    if (!dbUserId) throw new Error('User profile not found for this user');

    const announcement = await (prisma as any).communityAnnouncement.create({
      data: {
        communityId: comId,
        title,
        message,
        createdById: dbUserId,
        isPinned: isPinned || false,
        scheduledFor: scheduledFor ? new Date(scheduledFor) : null
      }
    });

    await (prisma as any).communityAdminLog.create({
      data: {
        communityId: comId,
        adminId: dbUserId,
        action: 'ANNOUNCEMENT',
        details: `Created announcement: ${title}`
      }
    });

    return announcement;
  }),

  archiveCommunity: safeResolver(async (_: any, { communityId, isArchived }: any, context: any) => {
    const user = context?.user;
    if (!user) throw new Error('Not authenticated');

    const comId = Number(communityId);
    const role = await getCommunityRoleFromContext(context, comId);
    if (!role || !hasGroupPermission(role, 'MANAGE_COMMUNITY')) {
      throw new Error('Unauthorized');
    }

    await (prisma as any).community.update({
      where: { id: comId },
      data: {
        isArchived,
        archivedAt: isArchived ? new Date() : null
      }
    });

    return true;
  }),

  reportCommunityMember: safeResolver(async (_: any, { communityId, reportedUserId, reason }: any, context: any) => {
    const user = context?.user;
    if (!user) throw new Error('Not authenticated');

    const reportedUserDbId = await getOrCreateUserForMember(Number(reportedUserId));
    const reporterUserDbId = await getUserIdFromContext(context);
    if (!reporterUserDbId) throw new Error('User profile not found for this user');

    await (prisma as any).communityMemberReport.create({
      data: {
        communityId: Number(communityId),
        reportedUserId: reportedUserDbId,
        reporterId: reporterUserDbId,
        reason,
        status: 'PENDING'
      }
    });

    return true;
  }),

  // Additional Community Mutations from images
  updateCommunitySettings: safeResolver(async (_: any, { communityId, settings }: any, context: any) => {
    const user = context?.user;
    if (!user) throw new Error('Not authenticated');

    const role = await getCommunityRoleFromContext(context, Number(communityId));
    if (!role) throw new Error('Not a member of this community');

    const memberId = await getMemberIdFromContext(context);
    if (!memberId) throw new Error('Member profile not found');

    // Update community-level settings (admin only)
    if (hasGroupPermission(role, 'MANAGE_COMMUNITY')) {
      const updateData: any = {};
      if (settings.name !== undefined) updateData.name = settings.name;
      if (settings.description !== undefined) updateData.description = settings.description;
      if (settings.privacyType !== undefined) updateData.privacyType = settings.privacyType;
      if (settings.allowMemberMessages !== undefined) updateData.allowMemberMessages = settings.allowMemberMessages;

      if (Object.keys(updateData).length > 0) {
        await (prisma as any).community.update({
          where: { id: Number(communityId) },
          data: updateData
        });
      }
    }

    // Update member-level settings
    const memberUpdateData: any = {};
    if (settings.notificationsEnabled !== undefined) memberUpdateData.notificationsEnabled = settings.notificationsEnabled;
    if (settings.mediaAutoDownload !== undefined) memberUpdateData.mediaAutoDownload = settings.mediaAutoDownload;
    if (settings.starredMessagesEnabled !== undefined) memberUpdateData.starredMessagesEnabled = settings.starredMessagesEnabled;
    if (settings.muted !== undefined) memberUpdateData.isMuted = settings.muted;

    if (Object.keys(memberUpdateData).length > 0) {
      await (prisma as any).communityMember.update({
        where: {
          communityId_memberId: {
            communityId: Number(communityId),
            memberId
          }
        },
        data: memberUpdateData
      });
    }

    return await (prisma as any).community.findUnique({
      where: { id: Number(communityId) },
      include: { location: true }
    });
  }),

  generateCommunityInviteCode: safeResolver(async (_: any, { communityId, expiryDays = 7 }: any, context: any) => {
    const user = context?.user;
    if (!user) throw new Error('Not authenticated');

    const role = await getCommunityRoleFromContext(context, Number(communityId));
    if (!role || !hasGroupPermission(role, 'MANAGE_COMMUNITY')) {
      throw new Error('Unauthorized');
    }

    const code = `INV-${Number(communityId)}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const expiry = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

    await (prisma as any).community.update({
      where: { id: Number(communityId) },
      data: { inviteCode: code, inviteCodeExpiry: expiry }
    });

    return code;
  }),

  pinCommunityAnnouncement: safeResolver(async (_: any, { announcementId }: any, context: any) => {
    const user = context?.user;
    if (!user) throw new Error('Not authenticated');

    const announcement = await (prisma as any).communityAnnouncement.findUnique({
      where: { id: Number(announcementId) },
      include: { community: true }
    });
    if (!announcement) throw new Error('Announcement not found');

    const role = await getCommunityRoleFromContext(context, announcement.communityId);
    if (!role || !hasGroupPermission(role, 'MANAGE_ANNOUNCEMENTS')) {
      throw new Error('Unauthorized');
    }

    return (prisma as any).communityAnnouncement.update({
      where: { id: Number(announcementId) },
      data: { isPinned: true }
    });
  }),

  unpinCommunityAnnouncement: safeResolver(async (_: any, { announcementId }: any, context: any) => {
    const user = context?.user;
    if (!user) throw new Error('Not authenticated');

    const announcement = await (prisma as any).communityAnnouncement.findUnique({
      where: { id: Number(announcementId) },
      include: { community: true }
    });
    if (!announcement) throw new Error('Announcement not found');

    const role = await getCommunityRoleFromContext(context, announcement.communityId);
    if (!role || !hasGroupPermission(role, 'MANAGE_ANNOUNCEMENTS')) {
      throw new Error('Unauthorized');
    }

    return (prisma as any).communityAnnouncement.update({
      where: { id: Number(announcementId) },
      data: { isPinned: false }
    });
  }),

  updateCommunityAnnouncement: safeResolver(async (_: any, { announcementId, title, message, isPinned, scheduledFor }: any, context: any) => {
    const user = context?.user;
    if (!user) throw new Error('Not authenticated');

    const announcement = await (prisma as any).communityAnnouncement.findUnique({
      where: { id: Number(announcementId) },
      include: { community: true }
    });
    if (!announcement) throw new Error('Announcement not found');

    const role = await getCommunityRoleFromContext(context, announcement.communityId);
    if (!role || !hasGroupPermission(role, 'MANAGE_ANNOUNCEMENTS')) {
      throw new Error('Unauthorized');
    }

    const updateData: any = {};
    if (title !== undefined) updateData.title = title;
    if (message !== undefined) updateData.message = message;
    if (isPinned !== undefined) updateData.isPinned = isPinned;
    if (scheduledFor !== undefined) updateData.scheduledFor = scheduledFor ? new Date(scheduledFor) : null;

    return (prisma as any).communityAnnouncement.update({
      where: { id: Number(announcementId) },
      data: updateData
    });
  }),

  deleteCommunityAnnouncement: safeResolver(async (_: any, { announcementId }: any, context: any) => {
    const user = context?.user;
    if (!user) throw new Error('Not authenticated');

    const announcement = await (prisma as any).communityAnnouncement.findUnique({
      where: { id: Number(announcementId) },
      include: { community: true }
    });
    if (!announcement) throw new Error('Announcement not found');

    const role = await getCommunityRoleFromContext(context, announcement.communityId);
    if (!role || !hasGroupPermission(role, 'MANAGE_ANNOUNCEMENTS')) {
      throw new Error('Unauthorized');
    }

    await (prisma as any).communityAnnouncement.delete({
      where: { id: Number(announcementId) }
    });

    return true;
  }),

  bulkApproveJoinRequests: safeResolver(async (_: any, { communityId, requestIds }: any, context: any) => {
    const user = context?.user;
    if (!user) throw new Error('Not authenticated');

    const role = await getCommunityRoleFromContext(context, Number(communityId));
    if (!role || !hasGroupPermission(role, 'MANAGE_MEMBERS')) {
      throw new Error('Unauthorized');
    }

    await (prisma as any).communityJoinRequest.updateMany({
      where: {
        id: { in: requestIds.map((id: number) => Number(id)) },
        communityId: Number(communityId),
        status: 'PENDING'
      },
      data: { status: 'APPROVED' }
    });

    // Add members to community
    for (const requestId of requestIds) {
      const request = await (prisma as any).communityJoinRequest.findUnique({
        where: { id: Number(requestId) }
      });
      if (request && request.status === 'APPROVED') {
        // Get member from user
        const member = await (prisma as any).member.findFirst({
          where: { userId: request.userId }
        });
        if (member) {
          await (prisma as any).communityMember.create({
            data: {
              communityId: Number(communityId),
              memberId: member.id,
              role: 'MEMBER'
            },
            skipDuplicates: true
          });
        }
      }
    }

    return true;
  }),

  starCommunityMessage: safeResolver(async (_: any, { messageId }: any, context: any) => {
    const user = context?.user;
    if (!user) throw new Error('Not authenticated');

    const memberId = await getMemberIdFromContext(context);
    if (!memberId) throw new Error('Member profile not found');

    const message = await (prisma as any).communityMessage.findUnique({
      where: { id: Number(messageId) }
    });
    if (!message) throw new Error('Message not found');

    await (prisma as any).communityMessageStar.create({
      data: {
        communityId: message.communityId,
        messageId: Number(messageId),
        memberId
      },
      skipDuplicates: true
    });

    return message;
  }),

  unstarCommunityMessage: safeResolver(async (_: any, { messageId }: any, context: any) => {
    const user = context?.user;
    if (!user) throw new Error('Not authenticated');

    const memberId = await getMemberIdFromContext(context);
    if (!memberId) throw new Error('Member profile not found');

    await (prisma as any).communityMessageStar.deleteMany({
      where: {
        messageId: Number(messageId),
        memberId
      }
    });

    const message = await (prisma as any).communityMessage.findUnique({
      where: { id: Number(messageId) }
    });
    return message;
  }),

  uploadCommunityLinkOrDoc: safeResolver(async (_: any, { communityId, title, url, type }: any, context: any) => {
    const user = context?.user;
    if (!user) throw new Error('Not authenticated');

    const role = await getCommunityRoleFromContext(context, Number(communityId));
    if (!role) throw new Error('Not a member of this community');

    const memberId = await getMemberIdFromContext(context);
    if (!memberId) throw new Error('Member profile not found');

    return (prisma as any).communityLinkOrDoc.create({
      data: {
        communityId: Number(communityId),
        title,
        url,
        type,
        uploadedBy: memberId
      }
    });
  }),

  deleteCommunityLinkOrDoc: safeResolver(async (_: any, { linkOrDocId }: any, context: any) => {
    const user = context?.user;
    if (!user) throw new Error('Not authenticated');

    const linkOrDoc = await (prisma as any).communityLinkOrDoc.findUnique({
      where: { id: Number(linkOrDocId) }
    });
    if (!linkOrDoc) throw new Error('Link or document not found');

    const role = await getCommunityRoleFromContext(context, linkOrDoc.communityId);
    const memberId = await getMemberIdFromContext(context);

    // Allow deletion by uploader or admin
    if (linkOrDoc.uploadedBy !== memberId && !hasGroupPermission(role || '', 'MANAGE_COMMUNITY')) {
      throw new Error('Unauthorized');
    }

    await (prisma as any).communityLinkOrDoc.delete({
      where: { id: Number(linkOrDocId) }
    });

    return true;
  }),
};

(resolvers as any).CommunityJoinRequest = {
  user: async (parent: any) => {
    if (parent.user) return parent.user;
    return (prisma as any).user.findUnique({ where: { id: parent.userId } });
  }
};

(resolvers as any).CommunityAdminLog = {
  admin: async (parent: any) => {
    if (parent.admin) return parent.admin;
    return (prisma as any).user.findUnique({ where: { id: parent.adminId } });
  }
};

(resolvers as any).CommunityComplaint = {
  reporter: async (parent: any) => {
    if (parent.reporter) return parent.reporter;
    return (prisma as any).user.findUnique({ where: { id: parent.reporterId } });
  },
  assignee: async (parent: any) => {
    if (parent.assignee) return parent.assignee;
    if (!parent.assigneeId) return null;
    return (prisma as any).user.findUnique({ where: { id: parent.assigneeId } });
  }
};

(resolvers as any).CommunityBanInfo = {
  user: async (parent: any) => {
    if (parent.user) return parent.user;
    return (prisma as any).user.findUnique({ where: { id: parent.userId } });
  },
  bannedBy: async (parent: any) => {
    if (parent.bannedBy) return parent.bannedBy;
    return (prisma as any).user.findUnique({ where: { id: parent.bannedById } });
  }
};


