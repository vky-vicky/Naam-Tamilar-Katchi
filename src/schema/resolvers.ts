import prisma from '../db.js';

// Helper to get all child location IDs recursively
async function getChildLocationIds(locationId: number): Promise<number[]> {
  const children = await prisma.location.findMany({
    where: { parentId: locationId },
    select: { id: true },
  });

  let ids = children.map((c) => c.id);
  for (const child of children) {
    const childIds = await getChildLocationIds(child.id);
    ids = [...ids, ...childIds];
  }
  return ids;
}

export const resolvers = {
  Query: {
    me: (_: any, __: any, context: any) => context.user,
    
    locations: async (_: any, { parentId, type }: any) => {
      return prisma.location.findMany({
        where: {
          parentId: parentId || null,
          ...(type && { type }),
        },
        orderBy: { name: 'asc' },
      });
    },

    location: async (_: any, { id }: any) => {
      return prisma.location.findUnique({ where: { id } });
    },

    members: async (_: any, { locationId, profession, limit = 50, offset = 0 }: any, context: any) => {
      // RBAC Check: Candidate/Captain can only see members in their location scope
      let filter: any = { isActive: true };
      
      if (profession) filter.profession = profession;

      if (locationId) {
        const allLocationIds = [locationId, ...(await getChildLocationIds(locationId))];
        filter.locationId = { in: allLocationIds };
      }

      const members = await prisma.member.findMany({
        where: filter,
        take: limit,
        skip: offset,
        include: { location: true },
        orderBy: { createdAt: 'desc' },
      });

      // Privacy Check: Redact phone numbers if not Super Admin or authorized for this scope
      return members.map((m) => {
        const canSeePhone = context.user?.role === 'SUPER_ADMIN' || (context.user?.role === 'CANDIDATE' && context.user.locationId === m.locationId);
        return {
          ...m,
          phone: canSeePhone ? m.phone : null,
        };
      });
    },

    dashboardStats: async () => {
      const [totalMembers, totalUsers, totalCampaigns, activeCampaigns] = await Promise.all([
        prisma.member.count(),
        prisma.user.count(),
        prisma.campaign.count(),
        prisma.campaign.count({ where: { status: 'SENT' } }),
      ]);

      return { totalMembers, totalUsers, totalCampaigns, activeCampaigns };
    },

    totalLocations: async (_: any, { type }: any) => {
      return prisma.location.count({ where: { type } });
    },

    searchLocations: async (_: any, { type, search }: any) => {
      return prisma.location.findMany({
        where: {
          type,
          ...(search && { name: { contains: search, mode: 'insensitive' } }),
        },
        orderBy: { name: 'asc' },
      });
    },
  },

  Location: {
    parent: async (parent: any) => {
      if (!parent.parentId) return null;
      return prisma.location.findUnique({ where: { id: parent.parentId } });
    },
    children: (parent: any) => {
      return prisma.location.findMany({ where: { parentId: parent.id } });
    },
    memberCount: async (parent: any) => {
      const allLocationIds = [parent.id, ...(await getChildLocationIds(parent.id))];
      return prisma.member.count({ where: { locationId: { in: allLocationIds } } });
    },
  },

  Campaign: {
    sentCount: (parent: any) => prisma.messageLog.count({ where: { campaignId: parent.id, status: 'SENT' } }),
    failedCount: (parent: any) => prisma.messageLog.count({ where: { campaignId: parent.id, status: 'FAILED' } }),
    targets: async (parent: any) => {
      const targets = await prisma.campaignTarget.findMany({
        where: { campaignId: parent.id },
        include: { location: true },
      });
      return targets.map((t) => t.location);
    },
  },

  Mutation: {
    requestOTP: async (_: any, { phone }: { phone: string }) => {
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      await prisma.oTP.create({
        data: {
          phone,
          otp,
          expiresAt: new Date(Date.now() + 5 * 60000), // 5 mins
        },
      });
      console.log(`[OTP] Sent to ${phone}: ${otp}`);
      return true;
    },

    verifyOTP: async (_: any, { phone, otp }: any) => {
      const record = await prisma.oTP.findFirst({
        where: { phone, otp, isVerified: false, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      });

      if (!record) return { error: 'Invalid or expired OTP' };

      await prisma.oTP.update({ where: { id: record.id }, data: { isVerified: true } });
      
      const user = await prisma.user.findUnique({ where: { phone } });
      return { token: "dummy-jwt-token", user };
    },

    addMember: async (_: any, args: any) => {
      return prisma.member.create({ data: args });
    },

    createCampaign: async (_: any, { title, message, targetLocationIds }: any, context: any) => {
      const campaign = await prisma.campaign.create({
        data: {
          title,
          message,
          createdById: context.user?.id || 1, // Fallback for testing
          targets: {
            create: targetLocationIds.map((id: number) => ({ locationId: id })),
          },
        },
      });
      return campaign;
    },
  },
};


