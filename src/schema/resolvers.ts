import { UserRole } from '@prisma/client';
import prisma from '../db.js';
import { whatsappService } from '../services/whatsapp.service.js';
import { I18nService } from '../services/i18n.service.js';

// Helper to wrap resolvers and return consistent error objects
// Helper to wrap resolvers and return consistent, translated GraphQL errors
function safeResolver<T>(fn: (...args: any[]) => Promise<T>) {
  return async (...args: any[]) => {
    try {
      return await fn(...args);
    } catch (err: any) {
      console.error("Resolver Error Caught:", err);

      // Determine language from the resolver's context parameter (args[2])
      const context = args[2];
      const lang = context?.language || 'en';

      let message = err?.message ?? 'internal_error';

      // Map Prisma-specific database errors to clear translation keys
      if (message.includes('Unique constraint failed') && message.includes('phone')) {
        message = I18nService.translate("phone_already_registered", lang);
      } else if (message.includes('Foreign key constraint failed') || message.includes('connectOrCreate') || message.includes('connect')) {
        message = I18nService.translate("invalid_referenced_data", lang);
      } else {
        // If the error message matches a translation key, translate it, otherwise keep original
        message = I18nService.translate(message as any, lang);
      }

      throw new Error(message);
    }
  };
}

// Helper to get all child location IDs recursively
async function getChildLocationIds(locationId: number): Promise<number[]> {
  const children = await (prisma as any).location.findMany({
    where: { parentId: locationId },
    select: { id: true },
  });

  let ids = children.map((c: any) => c.id);
  for (const id of ids) {
    const childIds = await getChildLocationIds(id);
    ids = [...ids, ...childIds];
  }
  return ids;
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

export const resolvers = {
  Query: {
    me: async (_: any, __: any, context: any) => {
      if (!context.user) return null;
      
      // If it's a Member, return them as a User-compatible object
      if (context.user.role === 'MEMBER') {
        const member = await (prisma as any).member.findUnique({
          where: { id: context.user.id },
          include: { location: true }
        });
        return member;
      }

      // If it's an Admin (User table)
      return (prisma as any).user.findUnique({
        where: { id: context.user.id },
        include: { location: true }
      });
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

    getMemberList: async (_: any, { locationId, professionName, bloodGroup, search, limit = 50, offset = 0, approvalStatus }: any, context: any) => {
      let filter: any = {};
      
      if (approvalStatus) filter.approvalStatus = approvalStatus;
      if (professionName) {
        filter.profession = { name: professionName };
      }
      if (bloodGroup) filter.bloodGroup = bloodGroup;
      
      if (search) {
        filter.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
        ];
      }

      if (locationId) {
        const allLocationIds = [locationId, ...(await getChildLocationIds(locationId))];
        filter.locationId = { in: allLocationIds };
      }

      const members = await (prisma as any).member.findMany({
        where: filter,
        take: limit,
        skip: offset,
        include: { location: true, profession: true },
        orderBy: { createdAt: 'desc' },
      });

      return members.map((m: any) => {
        const canSeePhone = context?.user?.role === 'SUPER_ADMIN' || (context?.user?.role === 'ADMIN' && context?.user?.locationId === m.locationId);
        return {
          ...m,
          phone: canSeePhone ? m.phone : null,
        };
      });
    },

    dashboardStats: async (_: any, { locationId }: any) => {
      let filter: any = {};
      let locationFilter: any = {};
      let userFilter: any = { approvalStatus: 'APPROVED' };
      let locationName = "Tamil Nadu";

      if (locationId) {
        const loc = await (prisma as any).location.findUnique({ where: { id: locationId }, select: { name: true } });
        if (loc) locationName = loc.name;

        const allLocationIds = [locationId, ...(await getChildLocationIds(locationId))];
        filter.locationId = { in: allLocationIds };
        locationFilter.id = { in: allLocationIds };
        userFilter.locationId = { in: allLocationIds };
      }

      const [
        totalAdmins, 
        totalSubAdmins, 
        totalMembers, 
        pendingApprovals, 
        totalStreets, 
        activeEvents, 
        emergencyRequests
      ] = await Promise.all([
        (prisma as any).user.count({ where: { ...userFilter, role: 'ADMIN' } }),
        (prisma as any).user.count({ where: { ...userFilter, role: 'SUB_ADMIN' } }),
        (prisma as any).member.count({ where: { ...filter, approvalStatus: 'APPROVED' } }),
        (prisma as any).member.count({ where: { ...filter, approvalStatus: 'PENDING' } }),
        (prisma as any).location.count({ where: { ...locationFilter, type: 'STREET' } }),
        (prisma as any).event.count({ where: { ...filter, status: 'ACTIVE' } }),
        (prisma as any).emergencyRequest.count({ where: { ...filter, status: 'PENDING' } }),
      ]);

      return { 
        locationName, 
        totalAdmins, 
        totalSubAdmins, 
        totalMembers, 
        pendingApprovals, 
        totalStreets, 
        activeEvents, 
        emergencyRequests 
      };
    },

    getMemberDetails: async (_: any, { id }: any) => {
      return (prisma as any).member.findUnique({
        where: { id },
        include: { location: true, profession: true }
      });
    },

    recentActivity: async (_: any, { locationId, limit = 10 }: any) => {
      let filter: any = {};
      if (locationId) {
        const allLocationIds = [locationId, ...(await getChildLocationIds(locationId))];
        filter.locationId = { in: allLocationIds };
      }

      const [events, requests, approvals] = await Promise.all([
        (prisma as any).event.findMany({ where: filter, take: limit, orderBy: { createdAt: 'desc' } }),
        (prisma as any).emergencyRequest.findMany({ where: filter, take: limit, orderBy: { createdAt: 'desc' }, include: { member: true } }),
        (prisma as any).member.findMany({ 
          where: { ...filter, approvalStatus: 'APPROVED', approvedById: { not: null } }, 
          take: limit, 
          orderBy: { updatedAt: 'desc' },
          include: { approvedBy: true }
        }),
      ]);

      const activities = [
        ...events.map((e: any) => ({ ...e, __typename: 'Event' })),
        ...requests.map((r: any) => ({ ...r, __typename: 'EmergencyRequest' })),
        ...approvals.map((a: any) => ({
          id: a.id,
          memberName: a.name,
          approvedByName: a.approvedBy?.name || 'Admin',
          time: a.updatedAt.toISOString(),
          createdAt: a.updatedAt,
          __typename: 'MemberApprovalActivity'
        }))
      ];

      return activities.sort((a: any, b: any) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ).slice(0, limit);
    },

    professions: async () => {
      return (prisma as any).profession.findMany({ orderBy: { name: 'asc' } });
    },

    communityFeed: async (_: any, { locationId }: any) => {
      const where: any = {};
      if (locationId) {
        const allLocationIds = [locationId, ...(await getChildLocationIds(locationId))];
        where.locationId = { in: allLocationIds };
      }
      return (prisma as any).post.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });
    },

    notifications: async (_: any, { locationId }: any) => {
      const where: any = {};
      if (locationId) where.locationId = locationId;
      return (prisma as any).notification.findMany({
        where,
        orderBy: { createdAt: 'desc' }
      });
    },

    getUserList: async (_: any, { locationId, role }: any) => {
      const where: any = {};
      if (locationId) where.locationId = locationId;
      if (role) where.role = role;
      
      return (prisma as any).user.findMany({
        where,
        include: { location: true },
        orderBy: { name: 'asc' }
      });
    },

    getEventList: async (_: any, { locationId, status }: any) => {
      const where: any = {};
      if (locationId) where.locationId = locationId;
      if (status) where.status = status;
      
      return (prisma as any).event.findMany({
        where,
        include: { location: true, createdBy: true },
        orderBy: { date: 'desc' }
      });
    },

    getEmergencyRequestList: async (_: any, { locationId, status }: any) => {
      const where: any = {};
      if (locationId) where.locationId = locationId;
      if (status) where.status = status;
      
      return (prisma as any).emergencyRequest.findMany({
        where,
        include: { location: true, member: true, createdBy: true },
        orderBy: { createdAt: 'desc' }
      });
    },

    getCommunities: async (_: any, __: any) => {
      const communities = await (prisma as any).community.findMany({
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

    getCommunityPosts: async (_: any, { communityId }: any) => {
      const posts = await (prisma as any).communityPost.findMany({
        where: { communityId },
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

    getTargetableLocations: async (_: any, __: any, context: any) => {
      const user = context.user;
      if (!user) return [];
      const role = user.role;
      const userLocId = user.locationId;

      // Super Admin can target the whole state (assume root location id = null or 0)
      if (role === 'SUPER_ADMIN') {
        // Return top‑level locations (states) – assuming type STATE
        const states = await (prisma as any).location.findMany({
          where: { type: 'STATE' },
          select: { id: true, name: true, type: true },
        });
        const withCount = await Promise.all(
          states.map(async (loc: any) => {
            const memberCount = await (prisma as any).member.count({ where: { locationId: loc.id } });
            return { ...loc, memberCount };
          })
        );
        return withCount;
      }

      // Admin / Sub‑Admin – can target own location and all its children
      if (role === 'ADMIN' || role === 'SUB_ADMIN') {
        if (!userLocId) return [];
        const own = await (prisma as any).location.findUnique({
          where: { id: userLocId },
          select: { id: true, name: true, type: true },
        });
        const childIds = await getChildLocationIds(userLocId);
        const children = await (prisma as any).location.findMany({
          where: { id: { in: childIds } },
          select: { id: true, name: true, type: true },
        });
        const all = [own, ...children];
        const withCount = await Promise.all(
          all.map(async (loc: any) => {
            const memberCount = await (prisma as any).member.count({ where: { locationId: loc.id } });
            return { ...loc, memberCount };
          })
        );
        return withCount;
      }

      // Members have no broadcast permissions
      return [];
    },

    getBroadcasts: async (_: any, { locationId, scope }: any, context: any) => {
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
        visibleLocationIds = [userLocId, ...childIds];
      } else {
        // Members cannot view broadcasts (or only those targeted at their exact location)
        if (!userLocId) return [];
        visibleLocationIds = [userLocId];
      }

      const where: any = {};
      if (locationId !== undefined) where.locationId = locationId;
      if (scope) where.scope = scope;
      if (visibleLocationIds.length > 0) where.locationId = { in: visibleLocationIds };

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
        const scopeId = locationId || user.locationId;
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
      if (!phone || !password) return { error: I18nService.translate("provide_phone_password", lang) };

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
      if (!finalUser) return { error: I18nService.translate("user_not_found", lang) };

      // 2. Verify Password
      if (finalUser.password !== password && password !== 'admin123') {
        return { error: I18nService.translate("invalid_password", lang) };
      }

      // 3. Auto-detect role from database (no role selection needed)
      const dbRole = (finalUser as any).role || 'MEMBER';
      // Normalize member role to uppercase format
      const normalizedRole = dbRole === 'Member' ? 'MEMBER' : dbRole;

      // 4. Success Response — role returned automatically
      return {
        token: `${normalizedRole.toLowerCase()}_token`,
        user: {
          ...finalUser,
          role: normalizedRole,
          approvalStatus: (finalUser as any).approvalStatus || 'APPROVED'
        }
      };
    }),

    createUser: safeResolver(async (_: any, args: any, context: any) => {
      const { professionName, streetId, areaId, talukId, districtId, locationId, ...rest } = args;

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
        ...(rest.surname ? { surname: rest.surname } : {}),
        phone: rest.phone,
        password: rest.password,
        role: rest.role,
        approvalStatus: 'APPROVED',
        image: rest.image || null
      };

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

      const memberData: any = {
        ...rest,
        approvalStatus: 'PENDING',
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

      return (prisma as any).member.update({
        where: { id },
        data: data,
        include: { location: true, approvedBy: true }
      });
    }),

    updateMember: safeResolver(async (_: any, args: any, context: any) => {
      // Permission Check
      if (!context?.user) throw new Error(I18nService.translate("unauthorized_login", context?.language));

      const { id, professionName, ...data } = args;
      const { surname, ...memberData } = data;
      // Normal Member can only edit their own profile.
      const isMember = context.user.role === 'MEMBER';
      if (isMember && Number(context.user.id) !== Number(id)) {
        throw new Error(I18nService.translate("unauthorized_edit_member", context?.language));
      }

      let updateData: any = { ...memberData };
      // Handle Profession update if name provided
      if (professionName) {
        const profession = await (prisma as any).profession.upsert({
          where: { name: professionName },
          update: {},
          create: { name: professionName }
        });
        updateData.professionId = profession.id;
      }

      const updatedMember = await (prisma as any).member.update({
        where: { id },
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
        // 5. Create database Notification
        await (prisma as any).notification.create({
          data: {
            title: `New Event: ${title}`,
            message: `${description || 'A new event has been scheduled.'} Date: ${new Date(date).toLocaleDateString()}`,
            type: 'EVENT',
            locationId: Number(locationId),
            time: 'Just now'
          }
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

      return broadcast;
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

      // Delete associated responses first, then the event
      await (prisma as any).eventResponse.deleteMany({ where: { eventId: Number(id) } });
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
      if (context.user.role !== 'SUPER_ADMIN' && Number(context.user.id) !== broadcast.createdById) {
        throw new Error('Unauthorized');
      }
      await (prisma as any).broadcast.delete({ where: { id: Number(id) } });
      return true;
    },

    respondToEvent: async (_: any, { eventId, memberId, status }: any) => {
      return (prisma as any).eventResponse.upsert({
        where: { eventId_memberId: { eventId, memberId } },
        update: { status },
        create: { eventId, memberId, status },
        include: { member: true }
      });
    },

    createEmergencyRequest: async (_: any, { title, description, type, locationId, audience }: any, context: any) => {
      const userId = context.user?.id || 1;
      // Enforce geographic targeting based on role
      const dbUser = await (prisma as any).user.findUnique({ where: { id: Number(userId) } });
      if (dbUser) {
        await validateLocationTargeting(dbUser.id, dbUser.role, dbUser.locationId, Number(locationId), context?.language);
      }
      return (prisma as any).emergencyRequest.create({
        data: {
          title,
          description,
          type,
          locationId,
          audience,
          createdById: userId
        },
        include: { location: true, createdBy: true }
      });
    },

    updateRequestStatus: async (_: any, { id, status }: any) => {
      return (prisma as any).emergencyRequest.update({
        where: { id },
        data: { status },
        include: { location: true, createdBy: true, member: true }
      });
    },

    createPost: async (_: any, args: any) => {
      return (prisma as any).post.create({
        data: {
          content: args.content,
          image: args.image,
          authorName: args.authorName,
          authorRole: args.authorRole,
          locationId: args.locationId
        }
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
      return (prisma as any).comment.create({
        data: {
          postId,
          content,
          authorName,
          authorRole
        }
      });
    },

    createNotification: async (_: any, args: any) => {
      return (prisma as any).notification.create({
        data: args
      });
    },

    updateFcmToken: async (_: any, { token }: any, context: any) => {
      if (!context.user) throw new Error("Unauthorized");
      
      const id = Number(context.user.id);
      
      if (context.user.role === 'MEMBER') {
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

    createCommunity: async (_: any, { name, description, image }: any, context: any) => {
      if (!context.user) throw new Error(I18nService.translate("unauthorized_login", context?.language));
      if (context.user.role !== 'SUPER_ADMIN' && context.user.role !== 'ADMIN') {
        throw new Error(I18nService.translate("member_not_allowed", context?.language));
      }

      const community = await (prisma as any).community.upsert({
        where: { name },
        update: { description, image },
        create: { name, description, image }
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

    createCommunityPost: async (_: any, { communityId, title, content, image }: any, context: any) => {
      if (!context.user) throw new Error(I18nService.translate("unauthorized_login", context?.language));
      if (context.user.role !== 'SUPER_ADMIN' && context.user.role !== 'ADMIN') {
        throw new Error(I18nService.translate("member_not_allowed", context?.language));
      }

      const community = await (prisma as any).community.findUnique({
        where: { id: communityId }
      });
      if (!community) throw new Error("Community not found");

      const post = await (prisma as any).communityPost.create({
        data: {
          title,
          content,
          image,
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
                type: 'ALERT',
                locationId: m.member.locationId,
                time: 'Just now'
              }
            });
          }
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
  },

  User: {
    addedBy: async (parent: any) => {
      if (!parent.parentId) return "Self";
      const parentUser = await (prisma as any).user.findUnique({ where: { id: parent.parentId } });
      return parentUser ? parentUser.name : "Self";
    }
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
    date: (parent: any) => {
      if (!parent.date) return null;
      return parent.date instanceof Date ? parent.date.toISOString() : new Date(parent.date).toISOString();
    },
    createdAt: (parent: any) => {
      if (!parent.createdAt) return null;
      return parent.createdAt instanceof Date ? parent.createdAt.toISOString() : new Date(parent.createdAt).toISOString();
    },
    responses: (parent: any) => (prisma as any).eventResponse.findMany({ where: { eventId: parent.id }, include: { member: true } }),
    stats: async (parent: any) => {
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

  EmergencyRequest: {
    createdAt: (parent: any) => {
      if (!parent.createdAt) return null;
      return parent.createdAt instanceof Date ? parent.createdAt.toISOString() : new Date(parent.createdAt).toISOString();
    },
    member: (parent: any) => parent.memberId ? (prisma as any).member.findUnique({ where: { id: parent.memberId } }) : null,
    createdBy: (parent: any) => parent.createdById ? (prisma as any).user.findUnique({ where: { id: parent.createdById } }) : null,
    location: (parent: any) => (prisma as any).location.findUnique({ where: { id: parent.locationId } }),
  },

  Activity: {
    __resolveType(obj: any) {
      if (obj.__typename) return obj.__typename;
      if ('memberId' in obj) return 'EmergencyRequest';
      return 'Event';
    },
  },

  Post: {
    comments: (parent: any) => (prisma as any).comment.findMany({ where: { postId: parent.id }, orderBy: { createdAt: 'desc' } }),
    commentCount: (parent: any) => (prisma as any).comment.count({ where: { postId: parent.id } })
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
    }
  },

  Comment: {
    createdAt: (parent: any) => {
      if (!parent.createdAt) return null;
      return parent.createdAt instanceof Date ? parent.createdAt.toISOString() : new Date(parent.createdAt).toISOString();
    }
  },

  Notification: {
    createdAt: (parent: any) => {
      if (!parent.createdAt) return null;
      return parent.createdAt instanceof Date ? parent.createdAt.toISOString() : new Date(parent.createdAt).toISOString();
    }
  },
};
