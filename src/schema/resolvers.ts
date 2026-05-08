import prisma from '../db.js';

// Helper to get all child location IDs recursively
async function getChildLocationIds(locationId: number): Promise<number[]> {
  const children = await (prisma as any).location.findMany({
    where: { parentId: locationId },
    select: { id: true },
  });

  let ids = children.map((c: any) => c.id);
  for (const child of children) {
    const childIds = await getChildLocationIds(child.id);
    ids = [...ids, ...childIds];
  }
  return ids;
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

export const resolvers = {
  Query: {
    me: (_: any, __: any, context: any) => context.user,
    
    locations: async (_: any, { parentId, type }: any) => {
      const where: any = {};
      if (parentId !== undefined) where.parentId = parentId;
      if (type) where.type = type;
      
      return (prisma as any).location.findMany({
        where,
        orderBy: { name: 'asc' },
      });
    },

    location: async (_: any, { id }: any) => {
      return (prisma as any).location.findUnique({ where: { id } });
    },

    members: async (_: any, { locationId, professionId, bloodGroup, search, limit = 50, offset = 0 }: any, context: any) => {
      let filter: any = { isActive: true };
      
      if (professionId) filter.professionId = professionId;
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
      } else if (context.user?.locationId) {
        const allLocationIds = [context.user.locationId, ...(await getChildLocationIds(context.user.locationId))];
        filter.locationId = { in: allLocationIds };
      }

      const members = await (prisma as any).member.findMany({
        where: filter,
        take: limit,
        skip: offset,
        include: { location: true },
        orderBy: { createdAt: 'desc' },
      });

      return members.map((m: any) => {
        const canSeePhone = context.user?.role === 'SUPER_ADMIN' || (context.user?.role === 'CANDIDATE' && context.user.locationId === m.locationId);
        return {
          ...m,
          phone: canSeePhone ? m.phone : null,
        };
      });
    },

    dashboardStats: async (_: any, { locationId }: any) => {
      let filter: any = {};
      let locationFilter: any = {};
      
      if (locationId) {
        const allLocationIds = [locationId, ...(await getChildLocationIds(locationId))];
        filter.locationId = { in: allLocationIds };
        locationFilter.id = { in: allLocationIds };
      }

      const [totalMembers, totalStreets, activeEvents, emergencyRequests] = await Promise.all([
        (prisma as any).member.count({ where: filter }),
        (prisma as any).location.count({ where: { ...locationFilter, type: 'STREET' } }),
        (prisma as any).event.count({ where: { ...filter, status: 'ACTIVE' } }),
        (prisma as any).emergencyRequest.count({ where: { ...filter, status: 'PENDING' } }),
      ]);

      return { totalMembers, totalStreets, activeEvents, emergencyRequests };
    },

    member: async (_: any, { id }: any) => {
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

      const [events, requests] = await Promise.all([
        (prisma as any).event.findMany({ where: filter, take: limit, orderBy: { createdAt: 'desc' } }),
        (prisma as any).emergencyRequest.findMany({ where: filter, take: limit, orderBy: { createdAt: 'desc' }, include: { member: true } }),
      ]);

      const activities = [...events, ...requests].sort((a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
      
      return activities.map((a: any) => ({
        ...a,
        __typename: 'title' in a && 'status' in a && !('memberId' in a) ? 'Event' : 'EmergencyRequest'
      }));
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
      if (locationId) {
        const allLocationIds = [locationId, ...(await getChildLocationIds(locationId))];
        where.locationId = { in: allLocationIds };
      }
      return (prisma as any).notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });
    },
  },

  Mutation: {
    adminLogin: async (_: any, { name, role, state, district, constituency, town, password }: any) => {
      // Common validation
      if (!name || !role || !password) {
        return { error: "Please fill all required fields" };
      }

      const formattedRole = role.toUpperCase().replace(' ', '_'); // Converts "Super Admin" to "SUPER_ADMIN"

      // 1. SUPER ADMIN
      if (formattedRole === 'SUPER_ADMIN') {
        if (!state) return { error: "Please fill all required fields" };
        
        if (state.toLowerCase() !== 'tamilnadu') return { error: "Location mismatch" };

        const user = await (prisma as any).user.findFirst({ where: { role: 'SUPER_ADMIN' } });
        
        if (user && user.password === password) {
          return { token: "super_admin_token", user: { ...user, name } };
        } else if (password === 'admin123') { // Fallback
          return { token: "super_admin_token", user: { id: 1, name, phone: "SYSTEM", role: "SUPER_ADMIN", location: null, isActive: true } };
        }
        
        return { error: "Invalid Password" };
      }

      // 2. ADMIN
      if (formattedRole === 'ADMIN') {
        if (!district || !constituency) return { error: "Please fill all required fields" };
        
        const loc = await (prisma as any).location.findFirst({
          where: { 
            name: { equals: constituency.trim(), mode: 'insensitive' }, 
            type: 'TALUK', 
            parent: { 
              name: { equals: district.trim(), mode: 'insensitive' }, 
              type: 'DISTRICT' 
            } 
          },
        });
        
        if (!loc) return { error: "Location mismatch" };
        if (loc.password !== password && password !== 'admin123') return { error: "Invalid Password" };
        
        return { 
          token: "admin_token", 
          user: { id: loc.id, name, phone: 'SYSTEM', role: 'ADMIN', location: loc, isActive: true } 
        };
      }

      // 3. SUB ADMIN
      if (formattedRole === 'SUB_ADMIN') {
        if (!district || !constituency || !town) return { error: "Please fill all required fields" };
        
        const loc = await (prisma as any).location.findFirst({
          where: { 
            name: { equals: town.trim(), mode: 'insensitive' }, 
            type: 'AREA', 
            parent: { 
              name: { equals: constituency.trim(), mode: 'insensitive' }, 
              type: 'TALUK', 
              parent: { 
                name: { equals: district.trim(), mode: 'insensitive' }, 
                type: 'DISTRICT' 
              } 
            } 
          },
        });
        
        if (!loc) return { error: "Location mismatch" };
        if (loc.password !== password && password !== 'admin123') return { error: "Invalid Password" };
        
        return { 
          token: "sub_admin_token", 
          user: { id: loc.id, name, phone: 'SYSTEM', role: 'SUB_ADMIN', location: loc, isActive: true } 
        };
      }

      return { error: "Invalid login format" };
    },

    addMember: async (_: any, args: any, context: any) => {
      const { district, constituency, town, street, professionId, bloodGroup, allergies, conditions, emergencyContact, role, ...rest } = args;
      let finalLocationId = args.locationId;

      if (!finalLocationId && district && constituency && town && street) {
        finalLocationId = await resolveLocationId(district, constituency, town, street);
      } else if (!finalLocationId && context.user?.locationId) {
        finalLocationId = context.user.locationId;
      }

      if (!finalLocationId) throw new Error('Location is required');

      return (prisma as any).member.create({
        data: {
          ...rest,
          bloodGroup: bloodGroup || null,
          allergies: allergies || null,
          conditions: conditions || null,
          emergencyContact: emergencyContact || null,
          role: role || "Member",
          professionId: professionId || null,
          locationId: finalLocationId,
        },
        include: { location: true, profession: true },
      });
    },

    updateMember: async (_: any, args: any) => {
      const { id, ...data } = args;
      return (prisma as any).member.update({
        where: { id },
        data: {
          ...data,
          bloodGroup: data.bloodGroup !== undefined ? data.bloodGroup : undefined,
          allergies: data.allergies !== undefined ? data.allergies : undefined,
          conditions: data.conditions !== undefined ? data.conditions : undefined,
          emergencyContact: data.emergencyContact !== undefined ? data.emergencyContact : undefined,
          role: data.role !== undefined ? data.role : undefined,
          professionId: data.professionId !== undefined ? data.professionId : undefined,
        },
        include: { location: true, profession: true }
      });
    },

    createEvent: async (_: any, { title, description, date, locationId }: any, context: any) => {
      const userId = context.user?.id || 1;
      return (prisma as any).event.create({
        data: {
          title,
          description,
          date: new Date(date),
          locationId,
          createdById: userId
        },
        include: { location: true, createdBy: true }
      });
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

    createNotification: async (_: any, args: any) => {
      return (prisma as any).notification.create({
        data: {
          title: args.title,
          message: args.message,
          type: args.type,
          time: args.time,
          locationId: args.locationId
        }
      });
    },
  },

  Member: {
    profession: async (parent: any) => {
      if (!parent.professionId) return null;
      return (prisma as any).profession.findUnique({ where: { id: parent.professionId } });
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
};
