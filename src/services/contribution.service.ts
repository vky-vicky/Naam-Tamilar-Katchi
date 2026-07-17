import prisma from '../db.js';
import { I18nService } from './i18n.service.js';
import { sendNotificationToLocation } from './fcm.service.js';

export class ContributionService {
  /**
   * Helper to get all child location IDs for a location.
   */
  private static async getChildLocationIds(locationId: number): Promise<number[]> {
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

  /**
   * Resolves a location from state/district/constituency/area names.
   */
  private static async resolveLocationScope(
    state?: string | null,
    district?: string | null,
    constituency?: string | null,
    area?: string | null
  ): Promise<number[]> {
    let targetLocationName = '';
    let targetType = '';

    if (area) {
      targetLocationName = area;
      targetType = 'AREA';
    } else if (constituency) {
      targetLocationName = constituency;
      targetType = 'TALUK';
    } else if (district) {
      targetLocationName = district;
      targetType = 'DISTRICT';
    } else if (state) {
      targetLocationName = state;
      targetType = 'STATE';
    }

    if (!targetLocationName) return [];

    const location = await (prisma as any).location.findFirst({
      where: {
        name: { equals: targetLocationName, mode: 'insensitive' },
        type: targetType as any
      },
      select: { id: true }
    });

    if (!location) return [];

    const childIds = await this.getChildLocationIds(location.id);
    return [location.id, ...childIds];
  }

  /**
   * Recalculates streak, total contribution, and badge for a member.
   */
  static async updateContributionProfile(memberId: number): Promise<any> {
    const paidPayments = await (prisma as any).contributionPayment.findMany({
      where: { memberId, status: 'PAID' },
      orderBy: [{ year: 'desc' }, { month: 'desc' }]
    });

    const totalContribution = paidPayments.reduce((sum: number, p: any) => sum + p.amount, 0);
    const totalPaidMonths = paidPayments.length;

    // Calculate streak
    let currentStreak = 0;
    if (paidPayments.length > 0) {
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;

      const latest = paidPayments[0];
      const monthsDiff = (currentYear - latest.year) * 12 + (currentMonth - latest.month);

      // Grace period: streak holds if latest payment is from current or previous month
      if (monthsDiff <= 1) {
        currentStreak = 1;
        for (let i = 1; i < paidPayments.length; i++) {
          const prev = paidPayments[i - 1];
          const curr = paidPayments[i];
          const diff = (prev.year - curr.year) * 12 + (prev.month - curr.month);

          if (diff === 1) {
            currentStreak++;
          } else if (diff > 1) {
            break; // Streak broken
          }
        }
      }
    }

    // Determine badge based on total paid months
    let badge: 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM' = 'BRONZE';
    if (totalPaidMonths >= 24) badge = 'PLATINUM';
    else if (totalPaidMonths >= 12) badge = 'GOLD';
    else if (totalPaidMonths >= 6) badge = 'SILVER';

    // Retrieve original profile to detect badge upgrade
    const existingProfile = await (prisma as any).contributionProfile.findUnique({
      where: { memberId }
    });

    const profile = await (prisma as any).contributionProfile.upsert({
      where: { memberId },
      update: {
        totalPaidMonths,
        currentStreak,
        totalContribution,
        badge
      },
      create: {
        memberId,
        totalPaidMonths,
        currentStreak,
        totalContribution,
        badge
      }
    });

    // If badge upgraded, create system notification and FCM notification
    if (existingProfile && existingProfile.badge !== badge) {
      await this.createSystemNotification({
        title: 'Badge Earned! / புதிய பதக்கம்!',
        message: `Congratulations! You have earned the ${badge} Badge for your consistent contributions.`,
        type: 'NOTIFICATION',
        purpose: 'Badge Earned',
        memberId
      });
    }

    // Recalculate ranks globally (simple rank by total contribution descending)
    const allProfiles = await (prisma as any).contributionProfile.findMany({
      orderBy: { totalContribution: 'desc' }
    });

    for (let index = 0; index < allProfiles.length; index++) {
      await (prisma as any).contributionProfile.update({
        where: { id: allProfiles[index].id },
        data: { contributionRank: index + 1 }
      });
    }

    return profile;
  }

  /**
   * Helper to create system notifications.
   */
  static async createSystemNotification({
    title,
    message,
    type,
    purpose,
    memberId
  }: {
    title: string;
    message: string;
    type: string;
    purpose?: string;
    memberId: number;
  }) {
    const member = await (prisma as any).member.findUnique({
      where: { id: memberId },
      select: { locationId: true, fcmToken: true }
    });

    const notification = await (prisma as any).notification.create({
      data: {
        title,
        message,
        type,
        purpose: purpose || null,
        locationId: member?.locationId || 1,
        time: 'Just now'
      }
    });

    const io = (global as any).io;
    if (io) {
      io.emit('newNotification', notification);
    }

    if (member?.fcmToken) {
      await sendNotificationToLocation(member.locationId, title, message, {
        type,
        notificationId: notification.id
      }).catch(e => console.error('[FCM] Notification error:', e));
    }

    return notification;
  }

  /**
   * Collection dashboard statistics — dynamic expected calculation.
   */
  private static superAdminCache: { data: any; expiry: number } | null = null;

  static async getContributionDashboard(
    state?: string | null,
    district?: string | null,
    constituency?: string | null,
    area?: string | null
  ): Promise<any> {
    const isSuperAdminQuery = !state && !district && !constituency && !area;
    if (isSuperAdminQuery && this.superAdminCache && Date.now() < this.superAdminCache.expiry) {
      console.log('[Cache Hit] Returning cached Super Admin Dashboard Metrics');
      return this.superAdminCache.data;
    }

    const allowedLocationIds = await this.resolveLocationScope(state, district, constituency, area);
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const memberWhere: any = { isActive: true };
    if (allowedLocationIds.length > 0) {
      memberWhere.locationId = { in: allowedLocationIds };
    }

    const totalMembers = await (prisma as any).member.count({ where: memberWhere });

    // Dynamic expectedCollection: sum of plan amounts from active enrollments
    const enrollmentWhere: any = { status: 'ACTIVE', member: { isActive: true } };
    if (allowedLocationIds.length > 0) {
      enrollmentWhere.member = { ...enrollmentWhere.member, locationId: { in: allowedLocationIds } };
    }
    const activeEnrollments = await (prisma as any).memberPlanEnrollment.findMany({
      where: enrollmentWhere,
      include: { plan: true }
    });
    const expectedCollection = activeEnrollments.reduce((sum: number, e: any) => sum + (e.plan?.monthlyAmount || 0), 0);

    const paymentWhere: any = { month: currentMonth, year: currentYear };
    if (allowedLocationIds.length > 0) {
      paymentWhere.member = { locationId: { in: allowedLocationIds } };
    }

    const paidPayments = await (prisma as any).contributionPayment.findMany({
      where: { ...paymentWhere, status: 'PAID' },
      select: { amount: true, memberId: true, paidAt: true }
    });

    const failedCount = await (prisma as any).contributionPayment.count({
      where: { ...paymentWhere, status: 'FAILED' }
    });

    const totalCollection = paidPayments.reduce((sum: number, p: any) => sum + p.amount, 0);
    const todaysCollection = paidPayments
      .filter((p: any) => p.paidAt && new Date(p.paidAt) >= today && new Date(p.paidAt) < tomorrow)
      .reduce((sum: number, p: any) => sum + p.amount, 0);

    const paidMembers = paidPayments.length;
    const pendingMembers = Math.max(0, totalMembers - paidMembers);
    const pendingAmount = Math.max(0, expectedCollection - totalCollection);
    const collectionPercentage = expectedCollection > 0 ? (totalCollection / expectedCollection) * 100 : 0;

    let locationName = 'All Tamil Nadu';
    if (allowedLocationIds.length > 0) {
      const loc = await (prisma as any).location.findUnique({
        where: { id: allowedLocationIds[0] },
        select: { name: true }
      });
      locationName = loc?.name || locationName;
    }

    const result = {
      locationName,
      totalMembers,
      paidMembers,
      pendingMembers,
      failedMembers: failedCount,
      totalCollection,
      expectedCollection,
      pendingAmount,
      todaysCollection,
      collectionPercentage
    };

    if (isSuperAdminQuery) {
      this.superAdminCache = { data: result, expiry: Date.now() + 5 * 60 * 1000 };
    }

    return result;
  }

  /**
   * District-scoped dashboard.
   */
  static async getDistrictDashboard(district: string): Promise<any> {
    const locationIds = await this.resolveLocationScope(null, district, null, null);
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const memberWhere: any = { isActive: true };
    if (locationIds.length > 0) memberWhere.locationId = { in: locationIds };

    const totalMembers = await (prisma as any).member.count({ where: memberWhere });

    const enrollWhere: any = { status: 'ACTIVE', member: { isActive: true } };
    if (locationIds.length > 0) enrollWhere.member = { ...enrollWhere.member, locationId: { in: locationIds } };
    const enrollments = await (prisma as any).memberPlanEnrollment.findMany({ where: enrollWhere, include: { plan: true } });
    const expectedCollection = enrollments.reduce((sum: number, e: any) => sum + (e.plan?.monthlyAmount || 0), 0);

    const payWhere: any = { month: currentMonth, year: currentYear };
    if (locationIds.length > 0) payWhere.member = { locationId: { in: locationIds } };

    const paidPayments = await (prisma as any).contributionPayment.findMany({
      where: { ...payWhere, status: 'PAID' },
      select: { amount: true }
    });
    const totalCollection = paidPayments.reduce((sum: number, p: any) => sum + p.amount, 0);
    const paidMembers = paidPayments.length;
    const pendingMembers = Math.max(0, totalMembers - paidMembers);
    const pendingAmount = Math.max(0, expectedCollection - totalCollection);
    const collectionPercentage = expectedCollection > 0 ? (totalCollection / expectedCollection) * 100 : 0;

    return { districtName: district, totalMembers, paidMembers, pendingMembers, totalCollection, pendingAmount, collectionPercentage };
  }

  /**
   * Constituency-scoped dashboard.
   */
  static async getConstituencyDashboard(constituency: string): Promise<any> {
    const locationIds = await this.resolveLocationScope(null, null, constituency, null);
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const memberWhere: any = { isActive: true };
    if (locationIds.length > 0) memberWhere.locationId = { in: locationIds };
    const totalMembers = await (prisma as any).member.count({ where: memberWhere });

    const enrollWhere: any = { status: 'ACTIVE', member: { isActive: true } };
    if (locationIds.length > 0) enrollWhere.member = { ...enrollWhere.member, locationId: { in: locationIds } };
    const enrollments = await (prisma as any).memberPlanEnrollment.findMany({ where: enrollWhere, include: { plan: true } });
    const expectedCollection = enrollments.reduce((sum: number, e: any) => sum + (e.plan?.monthlyAmount || 0), 0);

    const payWhere: any = { month: currentMonth, year: currentYear };
    if (locationIds.length > 0) payWhere.member = { locationId: { in: locationIds } };

    const paidPayments = await (prisma as any).contributionPayment.findMany({
      where: { ...payWhere, status: 'PAID' },
      select: { amount: true, paidAt: true }
    });
    const thisMonthCollection = paidPayments.reduce((sum: number, p: any) => sum + p.amount, 0);
    const todaysCollection = paidPayments
      .filter((p: any) => p.paidAt && new Date(p.paidAt) >= today && new Date(p.paidAt) < tomorrow)
      .reduce((sum: number, p: any) => sum + p.amount, 0);
    const paidMembers = paidPayments.length;
    const pendingMembers = Math.max(0, totalMembers - paidMembers);
    const collectionPercentage = expectedCollection > 0 ? (thisMonthCollection / expectedCollection) * 100 : 0;

    return { constituencyName: constituency, totalMembers, paidMembers, pendingMembers, todaysCollection, thisMonthCollection, collectionPercentage };
  }

  /**
   * Area-scoped dashboard.
   */
  static async getAreaDashboard(area: string): Promise<any> {
    const locationIds = await this.resolveLocationScope(null, null, null, area);
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const memberWhere: any = { isActive: true };
    if (locationIds.length > 0) memberWhere.locationId = { in: locationIds };
    const totalMembers = await (prisma as any).member.count({ where: memberWhere });

    const enrollWhere: any = { status: 'ACTIVE', member: { isActive: true } };
    if (locationIds.length > 0) enrollWhere.member = { ...enrollWhere.member, locationId: { in: locationIds } };
    const enrollments = await (prisma as any).memberPlanEnrollment.findMany({ where: enrollWhere, include: { plan: true } });
    const expectedCollection = enrollments.reduce((sum: number, e: any) => sum + (e.plan?.monthlyAmount || 0), 0);

    const payWhere: any = { month: currentMonth, year: currentYear };
    if (locationIds.length > 0) payWhere.member = { locationId: { in: locationIds } };
    const paidPayments = await (prisma as any).contributionPayment.findMany({
      where: { ...payWhere, status: 'PAID' },
      select: { amount: true }
    });
    const totalCollection = paidPayments.reduce((sum: number, p: any) => sum + p.amount, 0);
    const paidMembers = paidPayments.length;
    const pendingMembers = Math.max(0, totalMembers - paidMembers);
    const collectionPercentage = expectedCollection > 0 ? (totalCollection / expectedCollection) * 100 : 0;

    return { areaName: area, totalMembers, paidMembers, pendingMembers, collectionPercentage };
  }

  /**
   * Per-street breakdown within an area.
   */
  static async getStreetDashboards(area: string): Promise<any[]> {
    const areaLocation = await (prisma as any).location.findFirst({
      where: { name: { equals: area, mode: 'insensitive' }, type: 'AREA' },
      select: { id: true }
    });
    if (!areaLocation) return [];

    const streetLocations = await (prisma as any).location.findMany({
      where: { parentId: areaLocation.id },
      select: { id: true, name: true }
    });

    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const results: any[] = [];
    for (const street of streetLocations) {
      const totalMembers = await (prisma as any).member.count({ where: { locationId: street.id, isActive: true } });
      const paidPayments = await (prisma as any).contributionPayment.findMany({
        where: { status: 'PAID', month: currentMonth, year: currentYear, member: { locationId: street.id } },
        select: { amount: true }
      });
      const totalCollection = paidPayments.reduce((sum: number, p: any) => sum + p.amount, 0);
      const paidMembers = paidPayments.length;
      const pendingMembers = Math.max(0, totalMembers - paidMembers);
      results.push({ streetName: street.name, paidMembers, pendingMembers, totalCollection });
    }
    return results;
  }

  /**
   * Pending payments list with enhanced location fields.
   */
  static async getPendingPayments(
    district?: string | null,
    constituency?: string | null,
    area?: string | null
  ): Promise<any[]> {
    const allowedLocationIds = await this.resolveLocationScope(null, district, constituency, area);

    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const memberWhere: any = {
      isActive: true,
      enrollments: { some: { status: 'ACTIVE' } }
    };
    if (allowedLocationIds.length > 0) {
      memberWhere.locationId = { in: allowedLocationIds };
    }

    const members = await (prisma as any).member.findMany({
      where: memberWhere,
      include: {
        location: { include: { parent: { include: { parent: { include: { parent: true } } } } } },
        enrollments: { where: { status: 'ACTIVE' }, include: { plan: true } }
      }
    });

    const pendingList: any[] = [];

    for (const member of members) {
      const unpaid = await (prisma as any).contributionPayment.findMany({
        where: {
          memberId: member.id,
          status: { in: ['PENDING', 'PROCESSING', 'FAILED'] }
        }
      });

      if (unpaid.length > 0) {
        const dueAmount = unpaid.reduce((sum: number, p: any) => sum + (p.amount || member.enrollments[0]?.plan?.monthlyAmount || 100), 0);
        // Resolve location hierarchy
        const loc = member.location;
        let streetName = '', areaName = '', constituencyName = '', districtName = '';
        if (loc) {
          streetName = loc.name || '';
          const p1 = loc.parent;
          if (p1) {
            areaName = p1.name || '';
            const p2 = p1.parent;
            if (p2) {
              constituencyName = p2.name || '';
              const p3 = p2.parent;
              if (p3) districtName = p3.name || '';
            }
          }
        }
        pendingList.push({
          memberId: member.id,
          memberName: `${member.name} ${member.surname || ''}`.trim(),
          phone: member.phone,
          street: streetName,
          area: areaName,
          constituency: constituencyName,
          district: districtName,
          dueAmount,
          pendingMonths: unpaid.length
        });
      }
    }

    return pendingList;
  }

  /**
   * Analytics queries.
   */
  static async getContributionAnalytics(): Promise<any> {
    const now = new Date();
    
    // 1. Monthly collection trends (last 6 months)
    const trends: any[] = [];
    for (let i = 5; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const m = date.getMonth() + 1;
      const y = date.getFullYear();

      const sumObj = await (prisma as any).contributionPayment.aggregate({
        where: { month: m, year: y, status: 'PAID' },
        _sum: { amount: true }
      });
      trends.push({
        label: `${date.toLocaleString('default', { month: 'short' })} ${y}`,
        amount: sumObj._sum.amount || 0
      });
    }

    // 2. District, constituency, area collections
    const districtWise: any[] = [];
    const constituencyWise: any[] = [];
    const areaWise: any[] = [];

    const payments = await (prisma as any).contributionPayment.findMany({
      where: { status: 'PAID' },
      include: { member: { include: { location: true } } }
    });

    const districts = new Map<string, number>();
    const constituencies = new Map<string, number>();
    const areas = new Map<string, number>();

    const locationCache = new Map<number, { district: string | null, constituency: string | null, area: string | null }>();
    async function getLocFields(locationId: number) {
      if (locationCache.has(locationId)) return locationCache.get(locationId)!;
      const fields = { district: null as string | null, constituency: null as string | null, area: null as string | null };
      let currentId = locationId;
      while (currentId) {
        const loc = await (prisma as any).location.findUnique({
          where: { id: currentId },
          select: { id: true, name: true, type: true, parentId: true }
        });
        if (!loc) break;
        if (loc.type === 'DISTRICT') fields.district = loc.name;
        else if (loc.type === 'TALUK') fields.constituency = loc.name;
        else if (loc.type === 'AREA') fields.area = loc.name;
        
        if (!loc.parentId) break;
        currentId = loc.parentId;
      }
      locationCache.set(locationId, fields);
      return fields;
    }

    for (const p of payments) {
      const member = p.member;
      if (member && member.locationId) {
        const locFields = await getLocFields(member.locationId);
        if (locFields.district) {
          districts.set(locFields.district, (districts.get(locFields.district) || 0) + p.amount);
        }
        if (locFields.constituency) {
          constituencies.set(locFields.constituency, (constituencies.get(locFields.constituency) || 0) + p.amount);
        }
        if (locFields.area) {
          areas.set(locFields.area, (areas.get(locFields.area) || 0) + p.amount);
        }
      }
    }

    districts.forEach((amount, name) => districtWise.push({ name, amount }));
    constituencies.forEach((amount, name) => constituencyWise.push({ name, amount }));
    areas.forEach((amount, name) => areaWise.push({ name, amount }));

    districtWise.sort((a, b) => b.amount - a.amount);
    constituencyWise.sort((a, b) => b.amount - a.amount);
    areaWise.sort((a, b) => b.amount - a.amount);

    const totalPayments = await (prisma as any).contributionPayment.count();
    const paidCount = await (prisma as any).contributionPayment.count({ where: { status: 'PAID' } });
    const successRate = totalPayments > 0 ? (paidCount / totalPayments) * 100 : 0;

    const topContributors = await (prisma as any).contributionProfile.findMany({
      take: 5,
      orderBy: { totalContribution: 'desc' },
      include: { member: true }
    });

    return {
      monthlyCollectionTrend: trends,
      districtWiseCollection: districtWise.slice(0, 10),
      constituencyWiseCollection: constituencyWise.slice(0, 10),
      areaWiseCollection: areaWise.slice(0, 10),
      paymentSuccessRate: successRate,
      topContributors: topContributors.map((c: any) => ({
        memberId: c.memberId,
        memberName: `${c.member.name} ${c.member.surname || ''}`.trim(),
        totalContribution: c.totalContribution,
        badge: c.badge
      })),
      topLocations: districtWise.slice(0, 3).map((d: any) => d.name)
    };
  }

  /**
   * Enhanced Leaderboard: Member, Area, District.
   */
  static async getContributionLeaderboard(): Promise<any> {
    // Member Leaderboard
    const topProfiles = await (prisma as any).contributionProfile.findMany({
      take: 10,
      orderBy: { totalContribution: 'desc' },
      include: { member: true }
    });
    const memberLeaderboard = topProfiles.map((c: any, index: number) => ({
      rank: index + 1,
      memberId: c.memberId,
      memberName: `${c.member.name} ${c.member.surname || ''}`.trim(),
      totalContribution: c.totalContribution,
      badge: c.badge
    }));
    const topCollectionAmount = memberLeaderboard.length > 0 ? memberLeaderboard[0].totalContribution : 0;

    // Area Leaderboard — collection % per area
    const areaLocations = await (prisma as any).location.findMany({
      where: { type: 'AREA' },
      select: { id: true, name: true }
    });
    const areaLeaderboard: any[] = [];
    const now = new Date();
    for (const areaLoc of areaLocations) {
      const childIds = await this.getChildLocationIds(areaLoc.id);
      const locationIds = [areaLoc.id, ...childIds];
      const totalMem = await (prisma as any).member.count({ where: { isActive: true, locationId: { in: locationIds } } });
      if (totalMem === 0) continue;
      const paidPay = await (prisma as any).contributionPayment.count({
        where: { status: 'PAID', month: now.getMonth() + 1, year: now.getFullYear(), member: { locationId: { in: locationIds } } }
      });
      const enrolls = await (prisma as any).memberPlanEnrollment.findMany({
        where: { status: 'ACTIVE', member: { locationId: { in: locationIds } } },
        include: { plan: true }
      });
      const expected = enrolls.reduce((s: number, e: any) => s + (e.plan?.monthlyAmount || 0), 0);
      const paidAmtAgg = await (prisma as any).contributionPayment.aggregate({
        where: { status: 'PAID', month: now.getMonth() + 1, year: now.getFullYear(), member: { locationId: { in: locationIds } } },
        _sum: { amount: true }
      });
      const collected = paidAmtAgg._sum.amount || 0;
      const pct = expected > 0 ? (collected / expected) * 100 : 0;
      areaLeaderboard.push({ areaName: areaLoc.name, collectionPercentage: pct, totalCollection: collected });
    }
    areaLeaderboard.sort((a, b) => b.collectionPercentage - a.collectionPercentage);

    // District Leaderboard
    const districtLocations = await (prisma as any).location.findMany({
      where: { type: 'DISTRICT' },
      select: { id: true, name: true }
    });
    const districtLeaderboard: any[] = [];
    for (const dLoc of districtLocations) {
      const childIds = await this.getChildLocationIds(dLoc.id);
      const locationIds = [dLoc.id, ...childIds];
      const enrolls = await (prisma as any).memberPlanEnrollment.findMany({
        where: { status: 'ACTIVE', member: { locationId: { in: locationIds } } },
        include: { plan: true }
      });
      const expected = enrolls.reduce((s: number, e: any) => s + (e.plan?.monthlyAmount || 0), 0);
      const paidAmtAgg = await (prisma as any).contributionPayment.aggregate({
        where: { status: 'PAID', month: now.getMonth() + 1, year: now.getFullYear(), member: { locationId: { in: locationIds } } },
        _sum: { amount: true }
      });
      const collected = paidAmtAgg._sum.amount || 0;
      const pct = expected > 0 ? (collected / expected) * 100 : 0;
      districtLeaderboard.push({ districtName: dLoc.name, totalCollection: collected, collectionPercentage: pct });
    }
    districtLeaderboard.sort((a, b) => b.totalCollection - a.totalCollection);

    return {
      memberLeaderboard,
      areaLeaderboard: areaLeaderboard.slice(0, 10),
      districtLeaderboard: districtLeaderboard.slice(0, 10),
      topCollectionAmount
    };
  }

  /**
   * Admin search: paginated, filtered payment list.
   */
  static async searchPayments(args: {
    name?: string | null;
    phone?: string | null;
    memberId?: number | null;
    street?: string | null;
    status?: string | null;
    month?: number | null;
    year?: number | null;
    limit?: number | null;
    offset?: number | null;
    sortBy?: string | null;
    sortOrder?: string | null;
    allowedLocationIds?: number[];
  }): Promise<{ payments: any[]; totalCount: number }> {
    const limit = Math.min(args.limit || 20, 100);
    const offset = args.offset || 0;
    const sortBy = ['createdAt', 'amount', 'paidAt', 'month', 'year'].includes(args.sortBy || '') ? args.sortBy! : 'createdAt';
    const sortOrder = args.sortOrder === 'asc' ? 'asc' : 'desc';

    const memberWhere: any = { isActive: true };
    if (args.name) memberWhere.OR = [
      { name: { contains: args.name, mode: 'insensitive' } },
      { surname: { contains: args.name, mode: 'insensitive' } }
    ];
    if (args.phone) memberWhere.phone = { contains: args.phone };
    if (args.memberId) memberWhere.id = Number(args.memberId);
    if (args.street) {
      const streetLoc = await (prisma as any).location.findFirst({
        where: { name: { contains: args.street, mode: 'insensitive' } },
        select: { id: true }
      });
      if (streetLoc) memberWhere.locationId = streetLoc.id;
    }
    if ((args.allowedLocationIds || []).length > 0) {
      memberWhere.locationId = { in: args.allowedLocationIds };
    }

    const paymentWhere: any = { member: memberWhere };
    if (args.status) paymentWhere.status = args.status;
    if (args.month) paymentWhere.month = args.month;
    if (args.year) paymentWhere.year = args.year;

    const [totalCount, payments] = await Promise.all([
      (prisma as any).contributionPayment.count({ where: paymentWhere }),
      (prisma as any).contributionPayment.findMany({
        where: paymentWhere,
        orderBy: { [sortBy]: sortOrder },
        take: limit,
        skip: offset
      })
    ]);

    return { payments, totalCount };
  }
}
