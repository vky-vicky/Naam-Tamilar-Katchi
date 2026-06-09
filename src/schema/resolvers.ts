import { UserRole } from '@prisma/client';
import prisma from '../db.js';
import { whatsappService } from '../services/whatsapp.service.js';
import { I18nService } from '../services/i18n.service.js';
import { sendNotificationToLocation, sendNotificationToCommunity, sendNotificationToToken } from '../services/fcm.service.js';
import { ContributionService } from '../services/contribution.service.js';
import { RazorpayService } from '../services/razorpay.service.js';

function getReadableError(err: any, lang: string = 'en') {
  const prismaCode = err?.code;
  const target = Array.isArray(err?.meta?.target) ? err.meta.target.join(', ') : '';
  const message = err?.message ?? '';

  if (prismaCode === 'P2002' || (message.includes('Unique constraint failed') && message.includes('phone'))) {
    return {
      code: 'USER_PHONE_ALREADY_EXISTS',
      message: I18nService.translate('phone_already_registered', lang),
      detail: target ? `Duplicate unique field: ${target}` : 'Duplicate phone number'
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

// Helper to get all child location IDs without one DB query per tree node.
async function getChildLocationIds(locationId: number): Promise<number[]> {
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
  const queue = [...(childrenByParent.get(locationId) || [])];

  while (queue.length > 0) {
    const id = queue.shift()!;
    ids.push(id);
    queue.push(...(childrenByParent.get(id) || []));
  }

  return ids;
}

// Helper to get all parent/ancestor location IDs up to the root.
async function getAncestorLocationIds(locationId: number): Promise<number[]> {
  const ids: number[] = [locationId];
  let currentId = locationId;
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
  const notification = await (prisma as any).notification.create({
    data: {
      title,
      message,
      type,
      locationId,
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
        }).then((broadcastObj: any) => {
          if (broadcastObj) {
            io.emit('newBroadcast', broadcastObj);
            io.emit('broadcast', broadcastObj);
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

  await sendNotificationToLocation(locationId, title, message, {
    ...data,
    type,
    notificationId: notification.id
  }).catch(e => console.error('[FCM] Error sending push notification:', e));

  return notification;
}

function toIsoString(value: any) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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
    const ancestorIds = await getAncestorLocationIds(userLocId);
    visibleLocationIds = ancestorIds;
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
  if (isActive !== undefined && isActive !== null) where.isActive = Boolean(isActive);

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
      const targetIds = await getChildLocationIds(broadcast.locationId);
      const allIds = [broadcast.locationId, ...targetIds];
      const recipientCount = await (prisma as any).member.count({
        where: { locationId: { in: allIds }, isActive: true },
      });
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
  // 1. SUPER_ADMIN has full access — can target any location at any level
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

  // 2. ADMIN — can target their assigned location or any location under it
  if (role === 'ADMIN') {
    if (!userLocationId) {
      throw new Error(I18nService.translate("admin_no_scope", lang));
    }
    // Exact match — admin targeting their own assigned location
    if (userLocationId === targetLocationId) {
      return true;
    }
    // Check if target is a child of admin's location (any level deep)
    const childIds = await getChildLocationIds(userLocationId);
    if (childIds.includes(targetLocationId)) {
      return true;
    }
    throw new Error(I18nService.translate("admin_outside_scope", lang));
  }

  // 3. SUB_ADMIN — can target their assigned location or any location under it
  if (role === 'SUB_ADMIN') {
    if (!userLocationId) {
      throw new Error(I18nService.translate("subadmin_no_scope", lang));
    }
    // Exact match — sub admin targeting their own assigned location
    if (userLocationId === targetLocationId) {
      return true;
    }
    // Check if target is a child of sub admin's location
    const childIds = await getChildLocationIds(userLocationId);
    if (childIds.includes(targetLocationId)) {
      return true;
    }
    throw new Error(I18nService.translate("subadmin_outside_scope", lang));
  }

  // 4. MEMBERS are not allowed to create events or broadcasts
  throw new Error(I18nService.translate("member_not_allowed", lang));
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

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'SUB_ADMIN'];
const NAME_REGEX = /^[a-zA-Z\u0B80-\u0BFF\s]+$/;

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
  if (!dateInput) return new Date().toISOString();
  const d = new Date(dateInput);
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(d.getTime() + istOffset);
  return istTime.toISOString().replace('Z', '+05:30');
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

    const mutedUntil = membership?.mutedUntil ? new Date(membership.mutedUntil).getTime() : null;
    if (membership?.isMuted && (!mutedUntil || mutedUntil > Date.now())) {
      throw new Error("You are muted in this community");
    }

    if (!community.allowMemberMessages) {
      throw new Error("Only admin can message");
    }
  } else if (!isAdmin && user.type !== 'admin') {
    throw new Error("Only community members can message");
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
      createdAt: reaction.createdAt instanceof Date ? reaction.createdAt.toISOString() : new Date(reaction.createdAt).toISOString()
    }))),
    readByCount,
    metadata: message.metadata ? (typeof message.metadata === 'string' ? message.metadata : JSON.stringify(message.metadata)) : null,
    editedAt: message.editedAt ? (message.editedAt instanceof Date ? message.editedAt.toISOString() : new Date(message.editedAt).toISOString()) : null,
    deletedAt: message.deletedAt ? (message.deletedAt instanceof Date ? message.deletedAt.toISOString() : new Date(message.deletedAt).toISOString()) : null,
    createdAt: message.createdAt instanceof Date ? message.createdAt.toISOString() : new Date(message.createdAt).toISOString()
  };
}

export const resolvers = {
  Query: {
    me: async (_: any, __: any, context: any) => {
      if (!context.user) return null;
      
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
      if (role) {
        filter.role = { equals: role, mode: 'insensitive' };
        userFilter.role = role.toUpperCase();
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

      return uniqueMembers
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(offset, offset + limit)
        .map((m: any) => {
          const canSeePhone = context?.user?.role === 'SUPER_ADMIN' || (context?.user?.role === 'ADMIN' && context?.user?.locationId === m.locationId);
          return {
            ...m,
            role: m.role ? m.role.toUpperCase() : m.role,
            phone: canSeePhone ? m.phone : null,
          };
        });
    },

    dashboardStats: async (_: any, { locationId }: any, context: any) => {
      let locationName = 'Tamil Nadu';

      const contextUser = context?.user;
      const effectiveLocationId: number | null = locationId ?? (contextUser?.locationId ?? null);

      // Pre-compute all location IDs ONCE before any queries
      let dashLocationIds: number[] | null = null;
      if (effectiveLocationId) {
        const loc = await (prisma as any).location.findUnique({ where: { id: effectiveLocationId }, select: { name: true } });
        if (loc) locationName = loc.name;
        const childIds = await getChildLocationIds(effectiveLocationId);
        dashLocationIds = [effectiveLocationId, ...childIds];
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
        newMembersTodayFromMember,
        newMembersTodayFromUser,
        approvedTodayFromMember,
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
        (prisma as any).member.count({
          where: { createdAt: { gte: todayStart, lte: todayEnd }, ...memberLocFilter }
        }),
        // New members today from User table
        (prisma as any).user.count({
          where: { role: 'MEMBER', createdAt: { gte: todayStart, lte: todayEnd }, ...memberLocFilter }
        }),
        // Approved today from Member table
        (prisma as any).member.count({
          where: { approvalStatus: 'APPROVED', updatedAt: { gte: todayStart, lte: todayEnd }, ...memberLocFilter }
        }),
        // Total Towns (AREA)
        (prisma as any).location.count({
          where: { type: 'AREA', ...locationIdFilter }
        }),
        // Total Streets
        (prisma as any).location.count({
          where: { type: 'STREET', ...locationIdFilter }
        }),
        // Active Events
        (prisma as any).event.count({
          where: { status: 'ACTIVE', ...memberLocFilter }
        }),
        // Emergency requests pending today
        (prisma as any).emergencyRequest.count({
          where: { status: 'PENDING', createdAt: { gte: todayStart, lte: todayEnd }, ...memberLocFilter }
        }),
        // Active broadcasts today
        (prisma as any).broadcast.count({
          where: { isActive: true, createdAt: { gte: todayStart, lte: todayEnd }, ...memberLocFilter }
        }),
      ]);

      // Combine and deduplicate globally by phone
      // Member table gets PRIORITY over User table
      // (some people exist in both — Member table role is the ground truth)
      const formattedMembers = allMembers.map((m: any) => ({
        phone: m.phone,
        role: m.role ? m.role.toUpperCase() : 'MEMBER'
      }));

      const formattedUsers = allUsers.map((u: any) => ({
        phone: u.phone,
        role: u.role === 'Member' ? 'MEMBER' : (u.role ? u.role.toUpperCase() : 'MEMBER')
      }));

      // User table first, Member table second → Member table overwrites (priority)
      const combined = [...formattedUsers, ...formattedMembers];
      const uniquePeople = Array.from(new Map(combined.map(item => [item.phone, item])).values());

      const totalAdmins = uniquePeople.filter(p => p.role === 'ADMIN' || p.role === 'SUPER_ADMIN').length;
      const totalSubAdmins = uniquePeople.filter(p => p.role === 'SUB_ADMIN').length;
      const totalMembers = uniquePeople.filter(p => p.role === 'MEMBER').length;

      const pendingApprovals = pendingFromMemberTable + pendingFromUserTable;
      const newMembersToday = newMembersTodayFromMember + newMembersTodayFromUser;
      const approvedToday = approvedTodayFromMember;

      return {
        locationName,
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

    getMemberDetails: async (_: any, { id }: any) => {
      if (Number(id) < 0 || Number(id) >= 1000000) {
        const userId = Number(id) < 0 ? Math.abs(Number(id)) : (Number(id) - 1000000);
        const user = await (prisma as any).user.findUnique({
          where: { id: userId },
          include: { location: true }
        });
        return user ? userToMemberShape(user) : null;
      }

      const memberRecord = await (prisma as any).member.findUnique({
        where: { id },
        include: { location: true, profession: true }
      });
      if (memberRecord && memberRecord.role) {
        memberRecord.role = memberRecord.role.toUpperCase();
      }
      return memberRecord;
    },

    recentActivity: async (_: any, { locationId, limit = 10, offset = 0, search, type, fromDate, toDate }: any, context: any) => {
      const user = context?.user;
      if (!user) {
        throw new Error(I18nService.translate("unauthorized_login", context?.language));
      }

      if (user.role === 'MEMBER') {
        return [];
      }

      let targetLocationId: number | null = null;

      if (user.role === 'SUPER_ADMIN') {
        if (locationId) {
          targetLocationId = locationId;
        }
      } else {
        // ADMIN or SUB_ADMIN
        if (!user.locationId) {
          return []; // Admin with no assigned location sees nothing
        }

        const adminLocationIds = [user.locationId, ...(await getChildLocationIds(user.locationId))];

        if (locationId) {
          // If a filter is requested, verify it is within the admin's scope
          if (adminLocationIds.includes(locationId)) {
            targetLocationId = locationId;
          } else {
            // Trying to filter outside scope, restrict to their assigned location
            targetLocationId = user.locationId;
          }
        } else {
          // Default to their assigned scope
          targetLocationId = user.locationId;
        }
      }

      let filter: any = {};
      let allLocationIds: number[] = [];
      if (targetLocationId) {
        allLocationIds = [targetLocationId, ...(await getChildLocationIds(targetLocationId))];
        filter.locationId = { in: allLocationIds };
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
            where: { ...filter, ...eventSearch, ...dateFilter },
            take: takeLimit,
            orderBy: { createdAt: 'desc' },
            include: { location: true, createdBy: true }
          }).then((events: any[]) => events.map((e: any) => ({
            id: e.id,
            activityType: 'EVENT',
            title: e.title,
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
            } : null
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
          }).then((requests: any[]) => requests.map((r: any) => ({
            id: r.id,
            activityType: 'EMERGENCY',
            title: r.title,
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
            } : null
          })))
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
                approvalStatus: 'APPROVED',
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
                approvalStatus: 'APPROVED',
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
              const approvedByName = m.approvedBy?.name || m.createdBy?.name || 'Admin';
              const actionText = m.approvedById ? 'approved' : 'added';
              return {
                id: m.id,
                activityType: 'MEMBER',
                title: m.approvedById ? 'Member Approved' : 'Member Added',
                description: `Member request ${actionText} for ${m.name} ${m.surname || ''} by ${approvedByName}`,
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
                } : null
              };
            });

            const userActivities = users.map((u: any) => {
              const addedByName = u.parent?.name || 'Admin';
              return {
                id: 1000000 + u.id,
                activityType: 'MEMBER',
                title: 'Member Added',
                description: `Member ${u.name} ${u.surname || ''} added by ${addedByName}`,
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
                } : null
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
            const addedByName = u.parent?.name || 'Admin';
            return {
              id: u.id,
              activityType: 'ADMIN',
              title: u.role === 'ADMIN' ? 'Admin Added' : 'Super Admin Added',
              description: `${u.role.replace('_', ' ')} ${u.name} ${u.surname || ''} added by ${addedByName}`,
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
              } : null
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
            const addedByName = u.parent?.name || 'Admin';
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
              } : null
            };
          }))
        );
      }

      if (shouldQuery('BROADCAST')) {
        promises.push(
          (prisma as any).broadcast.findMany({
            where: { ...filter, ...broadcastSearch, ...dateFilter },
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
            } : null
          })))
        );
      }

      if (shouldQuery('ROLE_CHANGE')) {
        // Build audit where carefully — merge user filters without spread conflict
        const auditUserFilter: any = {};
        if (targetLocationId) {
          auditUserFilter.locationId = { in: allLocationIds };
        }
        if (search) {
          auditUserFilter.name = { contains: search, mode: 'insensitive' };
        }

        const auditWhere: any = {
          action: { contains: 'role', mode: 'insensitive' },
          ...(Object.keys(auditUserFilter).length > 0 ? { user: auditUserFilter } : {}),
          ...(search ? { OR: [
            { action: { contains: search, mode: 'insensitive' } },
            { details: { contains: search, mode: 'insensitive' } },
          ]} : {}),
          ...dateFilter
        };

        promises.push(
          (prisma as any).auditLog.findMany({
            where: auditWhere,
            take: takeLimit,
            orderBy: { createdAt: 'desc' },
            include: { user: { include: { location: true } } }
          }).then((logs: any[]) => logs.map((l: any) => ({
            id: l.id,
            activityType: 'ROLE_CHANGE',
            title: 'Role Changed',
            description: l.details || `Role changed for user ${l.user.name}`,
            createdAt: toIST(l.createdAt),
            member: {
              id: l.user.id,
              name: l.user.name,
              phone: l.user.phone,
              role: l.user.role
            },
            location: l.user.location ? {
              id: l.user.location.id,
              name: l.user.location.name
            } : null
          })))
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
          feedScore
        };
      }));

      // Sort descending by feedScore
      return scoredPosts.sort((a, b) => b.feedScore - a.feedScore);
    },

    getPollList: async (_: any, { locationId, communityId }: any, context: any) => {
      const where: any = {};
      const user = context?.user;

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
      } else if (locationId) {
        const ancestorIds = await getAncestorLocationIds(locationId);
        const childIds = await getChildLocationIds(locationId);
        const allLocationIds = [...ancestorIds, locationId, ...childIds];
        where.locationId = { in: allLocationIds };
      } else if (user) {
        if (user.role === 'MEMBER') {
          if (user.locationId) {
            const ancestorIds = await getAncestorLocationIds(user.locationId);
            where.locationId = { in: ancestorIds };
          } else {
            where.locationId = -1;
          }
        } else if (user.role === 'ADMIN' || user.role === 'SUB_ADMIN') {
          if (user.locationId) {
            const childIds = await getChildLocationIds(user.locationId);
            where.locationId = { in: [user.locationId, ...childIds] };
          } else {
            where.locationId = -1;
          }
        }
      }
      return (prisma as any).poll.findMany({
        where,
        orderBy: { createdAt: 'desc' },
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

    getPostDetails: async (_: any, { id }: any) => {
      return (prisma as any).post.findUnique({
        where: { id: Number(id) }
      });
    },

    notifications: async (_: any, { locationId }: any, context: any) => {
      if (!context?.user) {
        throw new Error(I18nService.translate("unauthorized_login", context?.language));
      }

      const role = context.user.role;
      const userLocId = context.user.locationId;
      const where: any = {};

      if (role === 'SUPER_ADMIN') {
        if (locationId) {
          const allLocationIds = [locationId, ...(await getChildLocationIds(locationId))];
          where.locationId = { in: allLocationIds };
        }
      } else if (role === 'ADMIN' || role === 'SUB_ADMIN') {
        if (!userLocId) return [];
        const adminLocationIds = [userLocId, ...(await getChildLocationIds(userLocId))];

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

      return (prisma as any).notification.findMany({
        where,
        include: { location: true, createdBy: true },
        orderBy: { createdAt: 'desc' }
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
      const userLocId = context.user.locationId;
      if (role === 'ADMIN' || role === 'SUB_ADMIN') {
        if (!userLocId) throw new Error('Unauthorized notification scope');
        const allowedIds = [userLocId, ...(await getChildLocationIds(userLocId))];
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
        const targetIds = await getChildLocationIds(broadcast.locationId);
        const allIds = [broadcast.locationId, ...targetIds];
        const totalRecipients = await (prisma as any).member.count({
          where: { locationId: { in: allIds }, isActive: true }
        });
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

    getEventList: async (_: any, { locationId, status, eventId }: any) => {
      const where: any = {};
      if (eventId) {
        where.id = eventId;
      } else {
        if (locationId) {
          const ancestorIds = await getAncestorLocationIds(locationId);
          const childIds = await getChildLocationIds(locationId);
          const allLocationIds = [...ancestorIds, locationId, ...childIds];
          where.locationId = { in: allLocationIds };
        }
        if (status) {
          const now = new Date();
          const oneDayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000);
          
          if (status === 'COMPLETED') {
            where.OR = [
              { status: 'COMPLETED' },
              { date: { lt: now } }
            ];
            where.status = { notIn: ['CANCELLED', 'INACTIVE'] };
          } else if (status === 'ACTIVE') {
            where.status = 'ACTIVE';
            where.date = { gte: now }; // active future events
          } else if (status === 'UPCOMING') {
            where.status = 'ACTIVE';
            where.date = { gt: oneDayFromNow }; // upcoming events starting after 24 hours
          } else {
            where.status = status;
          }
        }
      }
      
      return (prisma as any).event.findMany({
        where,
        include: { location: true, createdBy: true },
        orderBy: { date: 'desc' }
      });
    },

    getEmergencyRequestList: async (_: any, { locationId, status }: any) => {
      const where: any = {};
      if (locationId) {
        const ancestorIds = await getAncestorLocationIds(locationId);
        const childIds = await getChildLocationIds(locationId);
        const allLocationIds = [...ancestorIds, locationId, ...childIds];
        where.locationId = { in: allLocationIds };
      }
      if (status) where.status = status;
      
      return (prisma as any).emergencyRequest.findMany({
        where,
        include: { location: true, member: true, createdBy: true },
        orderBy: { createdAt: 'desc' }
      });
    },

    getCommunities: async (_: any, __: any, context: any) => {
      const user = context?.user;
      const where: any = {};

      if (user) {
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
        } else if (user.role === 'ADMIN' || user.role === 'SUB_ADMIN') {
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
          createdAt: community.createdAt.toISOString()
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
          comments: {
            orderBy: { createdAt: 'asc' }
          }
        },
        orderBy: { createdAt: 'desc' }
      });
      return posts.map((p: any) => ({
        ...p,
        createdAt: p.createdAt.toISOString()
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

      if (context.user.type !== 'member' && context.user.role !== 'MEMBER') return 0;

      const membership = await (prisma as any).communityMember.findUnique({
        where: {
          communityId_memberId: {
            communityId: Number(communityId),
            memberId: Number(context.user.id)
          }
        },
        select: { unreadCount: true }
      });

      return membership?.unreadCount || 0;
    },

    getCommunityMembers: async (_: any, { communityId }: any, context: any) => {
      await assertCommunityReadAccess(Number(communityId), context);

      const community = await (prisma as any).community.findUnique({
        where: { id: Number(communityId) }
      });
      if (!community) throw new Error("Community not found");

      // 1. Fetch all members in CommunityMember table
      const memberships = await (prisma as any).communityMember.findMany({
        where: { communityId: Number(communityId) },
        include: { member: { include: { location: true } } }
      });

      const memberDetails = memberships.map((m: any) => ({
        id: m.member.id,
        name: `${m.member.name} ${m.member.surname || ''}`.trim(),
        phone: m.member.phone,
        image: m.member.image,
        role: 'MEMBER',
        isGroupAdmin: false,
        isMuted: m.isMuted
      }));

      // 2. Fetch all admins who are in the same location or parents of the location
      let adminUsers: any[] = [];
      if (community.locationId) {
        // Fetch users (admins) who have locationId in the ancestor tree of community.locationId
        const ancestorIds = await getAncestorLocationIds(community.locationId);
        adminUsers = await (prisma as any).user.findMany({
          where: {
            role: { in: ['SUPER_ADMIN', 'ADMIN', 'SUB_ADMIN'] },
            locationId: { in: ancestorIds }
          },
          include: { location: true }
        });
      } else {
        // State-level community, get all super admins
        adminUsers = await (prisma as any).user.findMany({
          where: { role: 'SUPER_ADMIN' },
          include: { location: true }
        });
      }

      const adminDetails = adminUsers.map((u: any) => ({
        id: -Number(u.id), // negative ID for User/Admin to avoid key collision
        name: `${u.name} ${u.surname || ''}`.trim(),
        phone: u.phone,
        image: u.image,
        role: u.role,
        isGroupAdmin: true,
        isMuted: false
      }));

      return [...adminDetails, ...memberDetails];
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

    getBroadcasts: async (_: any, { locationId, scope, broadcastId, isActive }: any, context: any) => {
      if (broadcastId || isActive !== undefined) {
        return getBroadcastListForContext({ locationId, scope, broadcastId, isActive }, context);
      }
      // Only return broadcasts that the user is authorized to see
      const user = context.user;
      if (!user) return [];
      const role = user.role;
      const userLocId = user.locationId;

      // Build a list of location IDs the user can view based on role
      let visibleLocationIds: number[] = [];
      if (role === 'SUPER_ADMIN') {
        // Super admin can see everything – fetch all broadcasts optionally filtered
        visibleLocationIds = [];
      } else if (role === 'ADMIN' || role === 'SUB_ADMIN') {
        if (!userLocId) return [];
        const childIds = await getChildLocationIds(userLocId);
        const ancestorIds = await getAncestorLocationIds(userLocId);
        visibleLocationIds = Array.from(new Set([...ancestorIds, ...childIds]));
      } else {
        // Members see broadcasts targeted to their ancestor chain
        if (!userLocId) return [];
        const ancestorIds = await getAncestorLocationIds(userLocId);
        visibleLocationIds = ancestorIds;
      }

      const where: any = {};
      if (locationId !== undefined) {
        const ancestorIds = await getAncestorLocationIds(locationId);
        const childIds = await getChildLocationIds(locationId);
        const selectedLocationIds = [...ancestorIds, locationId, ...childIds];
        if (visibleLocationIds.length > 0) {
          where.locationId = { in: selectedLocationIds.filter(id => visibleLocationIds.includes(id)) };
        } else {
          where.locationId = { in: selectedLocationIds };
        }
      } else if (visibleLocationIds.length > 0) {
        where.locationId = { in: visibleLocationIds };
      }
      if (scope) where.scope = scope;

      const broadcasts = await (prisma as any).broadcast.findMany({
        where,
        include: { location: true, createdBy: true },
        orderBy: { createdAt: 'desc' },
      });

      // Compute recipient count for each broadcast (members in that location subtree)
      const withCount = await Promise.all(
        broadcasts.map(async (b: any) => {
          const targetIds = await getChildLocationIds(b.locationId);
          const allIds = [b.locationId, ...targetIds];
          const recipientCount = await (prisma as any).member.count({
            where: { locationId: { in: allIds }, isActive: true },
          });
          return { ...b, recipientCount };
        })
      );
      return withCount;
    },

    // ─────────────────────────────────────────────────────────────
    // Pending Members – ADMIN / SUPER_ADMIN மட்டுமே பார்க்கலாம்
    // ─────────────────────────────────────────────────────────────
    pendingMembers: async (_: any, { locationId }: any, context: any) => {
      const user = context?.user;
      const lang = context?.language || 'en';

      if (!user || (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN' && user.role !== 'SUB_ADMIN')) {
        throw new Error(I18nService.translate('member_not_allowed', lang));
      }

      const where: any = { approvalStatus: 'PENDING' };

      // Role‑based location scoping
      if (user.role === 'SUPER_ADMIN') {
        // Super admin – optional filter
        if (locationId) {
          const childIds = await getChildLocationIds(Number(locationId));
          where.locationId = { in: [Number(locationId), ...childIds] };
        }
      } else {
        // ADMIN / SUB_ADMIN – scope to their own location subtree
        let scopeId = user.locationId;
        if (locationId && user.locationId) {
          const allowedIds = [user.locationId, ...(await getChildLocationIds(user.locationId))];
          if (allowedIds.includes(Number(locationId))) {
            scopeId = Number(locationId);
          }
        }
        if (scopeId) {
          const childIds = await getChildLocationIds(Number(scopeId));
          where.locationId = { in: [Number(scopeId), ...childIds] };
        }
      }

      const pending = await (prisma as any).member.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { location: true, profession: true },
      });

      return pending.map((m: any) => ({
        ...m,
        createdAt: m.createdAt instanceof Date
          ? m.createdAt.toISOString()
          : new Date(m.createdAt).toISOString(),
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
      const normalizedBloodGroup = normalizeBloodGroup(rest.bloodGroup);
      if (!normalizedBloodGroup) {
        throw new Error("please_select_blood_group");
      }
      if (!professionName || String(professionName).trim() === '' || String(professionName).trim().toLowerCase() === 'select') {
        throw new Error("please_select_profession");
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

      const locFields = await getLocationFields(finalLocationId);

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

      if (finalLocationId) {
        userData.location = { connect: { id: finalLocationId } };
      }

      return (prisma as any).user.create({
        data: userData,
        include: { location: true }
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
      const normalizedBloodGroupMember = normalizeBloodGroup(rest.bloodGroup);
      if (!normalizedBloodGroupMember) {
        throw new Error("please_select_blood_group");
      }
      if (!professionName || String(professionName).trim() === '' || String(professionName).trim().toLowerCase() === 'select') {
        throw new Error("please_select_profession");
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

      if (professionName) {
        await autoJoinCommunities(member.id, professionName);
      }

      return member;
    }),

    updateMemberStatus: safeResolver(async (_: any, { id, status }: any, context: any) => {
      // Permission Check (Only Admins/SuperAdmins can approve)
      if (context?.user?.role === 'MEMBER') throw new Error(I18nService.translate("member_not_allowed", context?.language));

      const data: any = { approvalStatus: status };
      
      // Track who approved the member
      if (status === 'APPROVED' && context?.user?.id) {
        data.approvedById = context.user.id;
      }

      if (Number(id) < 0 || Number(id) >= 1000000) {
        const userId = Number(id) < 0 ? Math.abs(Number(id)) : (Number(id) - 1000000);
        const updatedUser = await (prisma as any).user.update({
          where: { id: userId },
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
        where: { id },
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
      

      const isUserTable = Number(id) < 0 || Number(id) >= 1000000;
      const targetId = isUserTable 
        ? (Number(id) < 0 ? Math.abs(Number(id)) : (Number(id) - 1000000))
        : Number(id);

      // Normal Member can only edit their own profile.
      const isMember = context.user.role === 'MEMBER';
      if (isMember && Number(context.user.id) !== targetId) {
        throw new Error(I18nService.translate("unauthorized_edit_member", context?.language));
      }

      let updateData: any = { ...rest };

      if (updateData.profilePicture !== undefined) {
        updateData.image = updateData.profilePicture;
        delete updateData.profilePicture;
      }


      // Determine the most specific location ID
      const finalLocationId = streetId || areaId || talukId || districtId || locationId;
      if (finalLocationId) {
        updateData.locationId = finalLocationId;
        const locFields = await getLocationFields(finalLocationId);
        Object.assign(updateData, locFields);
      }

      // Handle Profession update if name provided
      if (professionName) {
        const profession = await (prisma as any).profession.upsert({
          where: { name: professionName },
          update: {},
          create: { name: professionName }
        });
        updateData.professionId = profession.id;
      }

      if (isUserTable) {
        delete updateData.professionId;
        const updatedUser = await (prisma as any).user.update({
          where: { id: targetId },
          data: updateData,
          include: { location: true }
        });
        return userToMemberShape(updatedUser);
      }

      const updatedMember = await (prisma as any).member.update({
        where: { id: targetId },
        data: updateData,
        include: { location: true, profession: true }
      });
      
      if (professionName) {
        await autoJoinCommunities(updatedMember.id, professionName);
      }

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

      // 4. Create the event with a GUARANTEED valid creatorId
      const event = await (prisma as any).event.create({
        data: {
          title,
          description,
          date: new Date(date),
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

        // 6. Retrieve phone numbers of all active members in this location & all its children
        const allLocationIds = [Number(locationId), ...(await getChildLocationIds(Number(locationId)))];
        
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

      // 5. Get all target location IDs (including all sub-locations recursively)
      const allLocationIds = [Number(locationId), ...(await getChildLocationIds(Number(locationId)))];
      
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

      // Send WhatsApp broadcast to all members in the target subtree
      const targetIds = await getChildLocationIds(broadcast.locationId);
      const allIds = [broadcast.locationId, ...targetIds];
      const recipientCount = await (prisma as any).member.count({
        where: { locationId: { in: allIds }, isActive: true },
      });
      const members = await (prisma as any).member.findMany({
        where: { locationId: { in: allIds }, isActive: true },
        select: { phone: true },
      });
      const phoneNumbers = members.map((m: any) => m.phone).filter(Boolean);
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

      await (prisma as any).notification.delete({ where: { id: Number(id) } });
      return true;
    },

    respondToEvent: async (_: any, { eventId, memberId, status }: any, context: any) => {
      let finalMemberId = Number(memberId);
      
      const isMappedUser = finalMemberId >= 1000000;
      const targetUserId = isMappedUser ? (finalMemberId - 1000000) : null;
      const user = context?.user;
      
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
        memberId = userId;
      } else {
        createdById = userId;
        // Enforce geographic targeting based on role
        const dbUser = await (prisma as any).user.findUnique({ where: { id: userId } });
        if (dbUser) {
          await validateLocationTargeting(dbUser.id, dbUser.role, dbUser.locationId, Number(locationId), context?.language);
        }
      }

      const expiryDateTime = expiryDate ? new Date(expiryDate) : null;

      const request = await (prisma as any).emergencyRequest.create({
        data: {
          title,
          description,
          type,
          locationId: Number(locationId),
          status: initialStatus as any,
          audience,
          contactName,
          contactPhone,
          expiryDate: expiryDateTime,
          collectResponse: collectResponse !== undefined ? collectResponse : true,
          bloodGroup,
          unitsRequired,
          hospitalName,
          patientCondition,
          disasterType,
          affectedArea,
          requiredSupport,
          volunteerType,
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
          entityId: request.id
        }).catch(e => console.error(e));
      } else {
        // Push Notification, DB Notification, and Socket.IO for standard admin creation
        await sendSystemNotification({
          title: "Emergency Request: " + title,
          message: description || "Urgent help needed in your area",
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
            }
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
            entityId: request.id
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
            }
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
            entityId: request.id
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
            }
          });

          return updated;
        }
      }

      throw new Error(`Invalid review action ('${action}') or request status ('${currentStatus}')`);
    },

    createPost: async (_: any, args: any, context: any) => {
      const postImages = args.images || (args.image ? [args.image] : []);
      const createdById = context?.user ? Number(context.user.id) : null;
      const createdByType = context?.user?.type || null;

      const post = await (prisma as any).post.create({
        data: {
          content: args.content,
          category: args.category || "Discussion",
          images: postImages,
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

      return (prisma as any).post.update({
        where: { id: post.id },
        data: {
          content,
          images: images || post.images
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

      let isAuthorized = isOwner || isLegacyOwner || user.role === 'SUPER_ADMIN';

      if (!isAuthorized && (user.role === 'ADMIN' || user.role === 'SUB_ADMIN')) {
        try {
          await validateLocationTargeting(Number(user.id), user.role, user.locationId, post.locationId, lang);
          isAuthorized = true;
        } catch {
          isAuthorized = false;
        }
      }

      if (!isAuthorized) {
        throw new Error("Unauthorized: You do not have permission to delete this post.");
      }

      await (prisma as any).comment.deleteMany({
        where: { postId: post.id }
      });

      await (prisma as any).post.delete({
        where: { id: post.id }
      });

      return true;
    },

    createPoll: async (_: any, { question, options, durationDays, locationId, communityId }: any, context: any) => {
      if (!context.user) {
        throw new Error(I18nService.translate("unauthorized_login", context?.language));
      }
      
      const isMember = context.user.type === 'member' || context.user.role === 'MEMBER';
      const createdById = isMember ? null : Number(context.user.id);
      const memberId = isMember ? Number(context.user.id) : null;
      
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + durationDays);
      
      const poll = await (prisma as any).poll.create({
        data: {
          question,
          locationId,
          communityId,
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
             locationId: Number(locationId),
             time: 'Just now'
           }
         });
         const io = (global as any).io;
         if (io) {
           io.emit('newNotification', notification);
         }

         // Also inject it into the community chat stream
         const chatMsg = await (prisma as any).communityMessage.create({
           data: {
             communityId: Number(communityId),
             senderId: createdById || memberId || 1,
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
      } else if (locationId) {
         await sendSystemNotification({
           title: "New Poll",
           message: question,
           type: 'POLL',
           locationId: Number(locationId),
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

    likePost: async (_: any, { id }: any) => {
      return (prisma as any).post.update({
        where: { id },
        data: {
          likes: {
            increment: 1
          }
        }
      });
    },

    addComment: async (_: any, { postId, content, authorName, authorRole }: any) => {
      const comment = await (prisma as any).comment.create({
        data: {
          postId,
          content,
          authorName,
          authorRole
        }
      });
      
      // Send notification to post author's location (optional, simplified)
      const post = await (prisma as any).post.findUnique({ where: { id: Number(postId) } });
      if (post && post.locationId) {
        sendNotificationToLocation(Number(post.locationId), "New Comment", `${authorName || 'Someone'} commented on a post`, { type: 'ALERT', postId: post.id }).catch(e => console.error(e));
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

    createCommunity: async (_: any, { name, description, image, allowMemberMessages }: any, context: any) => {
      if (!context.user) throw new Error(I18nService.translate("unauthorized_login", context?.language));
      if (context.user.role !== 'SUPER_ADMIN' && context.user.role !== 'ADMIN') {
        throw new Error(I18nService.translate("member_not_allowed", context?.language));
      }

      const community = await (prisma as any).community.upsert({
        where: { name },
        update: {
          description,
          image,
          ...(allowMemberMessages !== undefined ? { allowMemberMessages } : {})
        },
        create: {
          name,
          description,
          image,
          allowMemberMessages: allowMemberMessages ?? true
        }
      });

      return {
        ...community,
        memberCount: 0,
        createdAt: community.createdAt.toISOString()
      };
    },

    joinCommunity: async (_: any, { communityId, memberId }: any) => {
      await (prisma as any).communityMember.upsert({
        where: {
          communityId_memberId: {
            communityId,
            memberId
          }
        },
        update: {},
        create: {
          communityId,
          memberId
        }
      });
      return true;
    },

    createCommunityPost: async (_: any, { communityId, title, content, category, images }: any, context: any) => {
      if (!context.user) throw new Error(I18nService.translate("unauthorized_login", context?.language));
      if (context.user.role !== 'SUPER_ADMIN' && context.user.role !== 'ADMIN') {
        throw new Error(I18nService.translate("member_not_allowed", context?.language));
      }
      // Validate title is provided and non-empty
      if (!title || title.trim() === '') {
        throw new Error('Title is required for community posts');
      }

      const community = await (prisma as any).community.findUnique({
        where: { id: communityId }
      });
      if (!community) throw new Error("Community not found");

      const post = await (prisma as any).communityPost.create({
        data: {
          title,
          content,
          category: category || "Information",
          images: images || [],
          communityId,
          createdById: Number(context.user.id)
        },
        include: {
          community: true,
          createdBy: true,
          comments: true
        }
      });

      // 4. WhatsApp-style Broadcast
      const members = await (prisma as any).communityMember.findMany({
        where: { communityId },
        include: { member: true }
      });

      const phoneNumbers = members.map((m: any) => m.member.phone).filter(Boolean);
      if (phoneNumbers.length > 0) {
        try {
          const broadcastMsg = `📢 *${community.name}*\n🌟 *${title}*\n\n${content}`;
          await whatsappService.sendMessage(phoneNumbers, broadcastMsg);

          for (const m of members) {
            await (prisma as any).notification.create({
              data: {
                title: `${community.name}: ${title}`,
                message: content,
                type: 'COMMUNITY',
                locationId: m.member.locationId,
                createdById: Number(context.user.id),
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
          }

          // Push FCM notification to community
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
        createdAt: post.createdAt.toISOString(),
        likes: 0,
        comments: []
      };
    },

    likeCommunityPost: async (_: any, { postId }: any) => {
      try {
        const post = await (prisma as any).communityPost.update({
          where: { id: postId },
          data: { likes: { increment: 1 } },
          include: {
            community: true,
            createdBy: true,
            comments: {
              orderBy: { createdAt: 'asc' }
            }
          }
        });
        return {
          ...post,
          createdAt: post.createdAt.toISOString()
        };
      } catch (err) {
        // Fallback for regular posts when the mobile app calls likeCommunityPost
        const regularPost = await (prisma as any).post.findUnique({
          where: { id: postId }
        });
        
        if (regularPost) {
          const updatedRegularPost = await (prisma as any).post.update({
            where: { id: postId },
            data: { likes: { increment: 1 } }
          });
          
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
            createdAt: updatedRegularPost.createdAt.toISOString(),
            updatedAt: updatedRegularPost.createdAt.toISOString()
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

      return {
        ...comment,
        createdAt: comment.createdAt.toISOString()
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
        createdAt: community.createdAt.toISOString()
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
          // If they exist in User table, migrate to Member table (if not exists) and remove from User table
          if (!dbMember) {
            await (prisma as any).member.create({
              data: {
                name: dbUser.name,
                surname: dbUser.surname,
                phone: dbUser.phone,
                password: dbUser.password,
                locationId: dbUser.locationId || 1,
                role: 'Member',
                approvalStatus: 'APPROVED',
                isActive: true
              }
            });
          } else {
            await (prisma as any).member.update({
              where: { id: dbMember.id },
              data: { role: 'Member' }
            });
          }
          // Remove from User table so they can't log in as admin anymore
          await (prisma as any).user.delete({ where: { id: dbUser.id } });
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
              isActive: true
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
      await (prisma as any).auditLog.create({
        data: {
          userId: dbUser ? dbUser.id : dbMember!.id,
          action: 'role_change',
          details: 'Role changed to ' + targetRole
        }
      });

      return true;
    },
  },

  Member: {
    createdAt: (parent: any) => {
      if (!parent.createdAt) return null;
      return parent.createdAt instanceof Date ? parent.createdAt.toISOString() : new Date(parent.createdAt).toISOString();
    },
    profession: async (parent: any) => {
      if (!parent.professionId) return null;
      const prof = await (prisma as any).profession.findUnique({ where: { id: parent.professionId } });
      return prof?.name || null;
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
    district: async (parent: any) => {
      if (parent.district) return parent.district;
      const fields = await getLocationFields(parent.locationId);
      return fields.district;
    },
    constituency: async (parent: any) => {
      if (parent.constituency) return parent.constituency;
      const fields = await getLocationFields(parent.locationId);
      return fields.constituency;
    },
    area: async (parent: any) => {
      if (parent.area) return parent.area;
      const fields = await getLocationFields(parent.locationId);
      return fields.area;
    },
    street: async (parent: any) => {
      if (parent.street) return parent.street;
      const fields = await getLocationFields(parent.locationId);
      return fields.street;
    },
    profilePicture: (parent: any) => parent.image,
  },

  User: {
    addedBy: async (parent: any) => {
      if (!parent.parentId) return "Self";
      const parentUser = await (prisma as any).user.findUnique({ where: { id: parent.parentId } });
      return parentUser ? parentUser.name : "Self";
    },
    createdAt: (parent: any) => {
      if (!parent.createdAt) return null;
      return parent.createdAt instanceof Date ? parent.createdAt.toISOString() : new Date(parent.createdAt).toISOString();
    },
    district: async (parent: any) => {
      if (parent.district) return parent.district;
      const fields = await getLocationFields(parent.locationId);
      return fields.district;
    },
    constituency: async (parent: any) => {
      if (parent.constituency) return parent.constituency;
      const fields = await getLocationFields(parent.locationId);
      return fields.constituency;
    },
    area: async (parent: any) => {
      if (parent.area) return parent.area;
      const fields = await getLocationFields(parent.locationId);
      return fields.area;
    },
    street: async (parent: any) => {
      if (parent.street) return parent.street;
      const fields = await getLocationFields(parent.locationId);
      return fields.street;
    },
    profilePicture: (parent: any) => parent.image,
  },

  Location: {
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

  Event: {
    status: (parent: any) => {
      if (parent.status === 'CANCELLED' || parent.status === 'INACTIVE') {
        return parent.status;
      }
      const eventDate = parent.date instanceof Date ? parent.date : new Date(parent.date);
      const now = new Date();
      if (eventDate < now) {
        return 'COMPLETED';
      }
      const diffMs = eventDate.getTime() - now.getTime();
      if (diffMs <= 24 * 60 * 60 * 1000) {
        return 'ACTIVE';
      }
      return 'UPCOMING';
    },
    date: (parent: any) => {
      if (!parent.date) return null;
      return parent.date instanceof Date ? parent.date.toISOString() : new Date(parent.date).toISOString();
    },
    createdAt: (parent: any) => {
      if (!parent.createdAt) return null;
      return parent.createdAt instanceof Date ? parent.createdAt.toISOString() : new Date(parent.createdAt).toISOString();
    },
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

      const isSuper = user.role === 'SUPER_ADMIN';
      const isCreator = (user.role === 'ADMIN' || user.role === 'SUB_ADMIN') && parent.createdById === Number(user.id);

      if (!isSuper && !isCreator) {
        return { going: 0, maybe: 0, notGoing: 0 };
      }

      const responses = await (prisma as any).eventResponse.findMany({ where: { eventId: parent.id } });
      return {
        going: responses.filter((r: any) => r.status === 'GOING').length,
        maybe: responses.filter((r: any) => r.status === 'MAYBE').length,
        notGoing: responses.filter((r: any) => r.status === 'NOT_GOING').length,
      };
    },
    createdBy: (parent: any) => (prisma as any).user.findUnique({ where: { id: parent.createdById } }),
    location: (parent: any) => (prisma as any).location.findUnique({ where: { id: parent.locationId } }),
  },

  EventResponse: {
    member: (parent: any) => (prisma as any).member.findUnique({ where: { id: parent.memberId } }),
  },

  EmergencyResponse: {
    member: (parent: any) => (prisma as any).member.findUnique({ where: { id: parent.memberId } }),
    createdAt: (parent: any) => toIsoString(parent.createdAt),
    updatedAt: (parent: any) => toIsoString(parent.updatedAt),
  },

  EmergencyRequest: {
    createdAt: (parent: any) => {
      if (!parent.createdAt) return null;
      return parent.createdAt instanceof Date ? parent.createdAt.toISOString() : new Date(parent.createdAt).toISOString();
    },
    expiryDate: (parent: any) => {
      if (!parent.expiryDate) return null;
      return parent.expiryDate instanceof Date ? parent.expiryDate.toISOString() : new Date(parent.expiryDate).toISOString();
    },
    forwardedAt: (parent: any) => {
      if (!parent.forwardedAt) return null;
      return parent.forwardedAt instanceof Date ? parent.forwardedAt.toISOString() : new Date(parent.forwardedAt).toISOString();
    },
    member: (parent: any) => parent.memberId ? (prisma as any).member.findUnique({ where: { id: parent.memberId } }) : null,
    createdBy: (parent: any) => parent.createdById ? (prisma as any).user.findUnique({ where: { id: parent.createdById } }) : null,
    location: (parent: any) => (prisma as any).location.findUnique({ where: { id: parent.locationId } }),
    responses: (parent: any, _: any, context: any) => {
      const user = context?.user;
      if (user?.role === 'MEMBER') {
        return (prisma as any).emergencyResponse.findMany({
          where: { 
            emergencyRequestId: parent.id, 
            memberId: Number(user.id) 
          },
          include: { member: true }
        });
      }
      return (prisma as any).emergencyResponse.findMany({ 
        where: { emergencyRequestId: parent.id }, 
        include: { member: true } 
      });
    },
    stats: async (parent: any, _: any, context: any) => {
      const user = context?.user;
      if (user?.role === 'MEMBER') {
        return {
          total: 0,
          going: 0,
          maybe: 0,
          notGoing: 0,
          coming: 0,
          onTheWay: 0,
          reached: 0,
          unable: 0,
          contactRequested: 0
        };
      }
      const responses = await (prisma as any).emergencyResponse.findMany({ where: { emergencyRequestId: parent.id } });
      return buildEmergencyResponseStats(responses);
    },
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
    comments: (parent: any) => (prisma as any).comment.findMany({ where: { postId: parent.id }, orderBy: { createdAt: 'desc' } }),
    commentCount: (parent: any) => (prisma as any).comment.count({ where: { postId: parent.id } }),
    location: (parent: any) => (prisma as any).location.findUnique({ where: { id: parent.locationId } }),
    createdAt: (parent: any) => {
      if (!parent.createdAt) return null;
      return parent.createdAt instanceof Date ? parent.createdAt.toISOString() : new Date(parent.createdAt).toISOString();
    }
  },

  PollOption: {
    votesCount: async (parent: any) => {
      return (prisma as any).pollVote.count({ where: { optionId: parent.id } });
    }
  },

  Poll: {
    expiresAt: (parent: any) => parent.expiresAt instanceof Date ? parent.expiresAt.toISOString() : new Date(parent.expiresAt).toISOString(),
    createdAt: (parent: any) => parent.createdAt instanceof Date ? parent.createdAt.toISOString() : new Date(parent.createdAt).toISOString(),
    options: async (parent: any) => {
      if (parent.options) return parent.options;
      return (prisma as any).pollOption.findMany({ where: { pollId: parent.id } });
    },
    votesCount: async (parent: any) => {
      return (prisma as any).pollVote.count({ where: { pollId: parent.id } });
    },
    userVoteOptionId: async (parent: any, _: any, context: any) => {
      if (!context?.user || context.user.role !== 'MEMBER') return null;
      const memberId = Number(context.user.id);
      const vote = await (prisma as any).pollVote.findUnique({
        where: {
          pollId_memberId: {
            pollId: parent.id,
            memberId
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
    }
  },

  Campaign: {
    createdAt: (parent: any) => {
      if (!parent.createdAt) return null;
      return parent.createdAt instanceof Date ? parent.createdAt.toISOString() : new Date(parent.createdAt).toISOString();
    }
  },

  Broadcast: {
    createdAt: (parent: any) => {
      if (!parent.createdAt) return null;
      return parent.createdAt instanceof Date ? parent.createdAt.toISOString() : new Date(parent.createdAt).toISOString();
    },
    updatedAt: (parent: any) => {
      if (!parent.updatedAt) return null;
      return parent.updatedAt instanceof Date ? parent.updatedAt.toISOString() : new Date(parent.updatedAt).toISOString();
    },
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
      const targetIds = await getChildLocationIds(parent.locationId);
      const allIds = [parent.locationId, ...targetIds];
      return (prisma as any).member.count({
        where: { locationId: { in: allIds }, isActive: true },
      });
    }
  },

  Comment: {
    createdAt: (parent: any) => {
      if (!parent.createdAt) return null;
      return parent.createdAt instanceof Date ? parent.createdAt.toISOString() : new Date(parent.createdAt).toISOString();
    }
  },

  CommunityPost: {
    image: (parent: any) => {
      return (parent.images && parent.images.length > 0) ? parent.images[0] : null;
    },
    authorName: async (parent: any) => {
      if (parent.createdBy?.name) return parent.createdBy.name;
      if (!parent.createdById) return null;
      const user = await (prisma as any).user.findUnique({ where: { id: parent.createdById }, select: { name: true } });
      return user?.name || null;
    },
    authorRole: async (parent: any) => {
      if (parent.createdBy?.role) return parent.createdBy.role;
      if (!parent.createdById) return null;
      const user = await (prisma as any).user.findUnique({ where: { id: parent.createdById }, select: { role: true } });
      return user?.role || null;
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
    createdAt: (parent: any) => {
      if (!parent.createdAt) return null;
      return parent.createdAt instanceof Date ? parent.createdAt.toISOString() : new Date(parent.createdAt).toISOString();
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
    mutedUntil: (parent: any) => {
      if (!parent.mutedUntil) return null;
      return parent.mutedUntil instanceof Date ? parent.mutedUntil.toISOString() : new Date(parent.mutedUntil).toISOString();
    },
    pinnedMessage: async (parent: any) => {
      if (!parent.pinnedMessageId) return null;
      const message = await (prisma as any).communityMessage.findUnique({
        where: { id: Number(parent.pinnedMessageId) },
        include: { replyTo: true, reactions: true }
      });
      return message ? formatCommunityMessage(message) : null;
    },
    unreadCount: async (parent: any, _: any, context: any) => {
      if (context?.user?.role !== 'MEMBER') return 0;
      const membership = await (prisma as any).communityMember.findUnique({
        where: {
          communityId_memberId: {
            communityId: Number(parent.id),
            memberId: Number(context.user.id)
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
    createdAt: (parent: any) => {
      if (!parent.createdAt) return null;
      return parent.createdAt instanceof Date ? parent.createdAt.toISOString() : new Date(parent.createdAt).toISOString();
    }
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
    createdAt: (parent: any) => {
      if (!parent.createdAt) return null;
      return parent.createdAt instanceof Date ? parent.createdAt.toISOString() : new Date(parent.createdAt).toISOString();
    }
  },

  CommunityMessageReaction: {
    reactorName: async (parent: any) => getCommunityActorName(parent.reactorId, parent.reactorType),
    createdAt: (parent: any) => {
      if (!parent.createdAt) return null;
      return parent.createdAt instanceof Date ? parent.createdAt.toISOString() : new Date(parent.createdAt).toISOString();
    }
  },

  Notification: {
    createdAt: (parent: any) => {
      if (!parent.createdAt) return null;
      return parent.createdAt instanceof Date ? parent.createdAt.toISOString() : new Date(parent.createdAt).toISOString();
    },
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
    createdAt: (parent: any) =>
      parent.createdAt instanceof Date ? parent.createdAt.toISOString() : new Date(parent.createdAt).toISOString(),
    startDate: (parent: any) =>
      parent.startDate instanceof Date ? parent.startDate.toISOString() : new Date(parent.startDate).toISOString(),
    enrolledCount: async (parent: any) => {
      return (prisma as any).memberPlanEnrollment.count({
        where: { planId: parent.id, status: 'ACTIVE' }
      });
    }
  },

  MemberPlanEnrollment: {
    joinedAt: (parent: any) =>
      parent.joinedAt instanceof Date ? parent.joinedAt.toISOString() : new Date(parent.joinedAt).toISOString(),
    plan: async (parent: any) => {
      if (parent.plan) return parent.plan;
      return (prisma as any).contributionPlan.findUnique({ where: { id: parent.planId } });
    }
  },

  ContributionPayment: {
    createdAt: (parent: any) =>
      parent.createdAt instanceof Date ? parent.createdAt.toISOString() : new Date(parent.createdAt).toISOString(),
    paidAt: (parent: any) =>
      parent.paidAt ? (parent.paidAt instanceof Date ? parent.paidAt.toISOString() : new Date(parent.paidAt).toISOString()) : null,
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
      razorpayPaymentId: payment.razorpayPaymentId || null
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
        planId: args.planId,
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
      where: { memberId, planId: args.planId, month: currentMonth, year: currentYear }
    });
    if (!payment) {
      payment = await (prisma as any).contributionPayment.create({
        data: {
          memberId,
          enrollmentId: enrollment.id,
          planId: args.planId,
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
      data: { razorpayOrderId: orderResult.orderId }
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
      where: { razorpayOrderId: razorpay_order_id }
    });
    if (!payment) {
      return { success: false, payment: null, message: 'Payment record not found' };
    }
    const updated = await (prisma as any).contributionPayment.update({
      where: { id: payment.id },
      data: {
        status: 'PAID',
        razorpayPaymentId: razorpay_payment_id,
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
};
