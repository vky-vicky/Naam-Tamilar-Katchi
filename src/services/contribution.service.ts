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
   * Collection dashboard statistics.
   */
  static async getContributionDashboard(
    state?: string | null,
    district?: string | null,
    constituency?: string | null,
    area?: string | null
  ): Promise<any> {
    const allowedLocationIds = await this.resolveLocationScope(state, district, constituency, area);
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const memberWhere: any = { isActive: true };
    const paymentWhere: any = { month: currentMonth, year: currentYear };

    if (allowedLocationIds.length > 0) {
      memberWhere.locationId = { in: allowedLocationIds };
      paymentWhere.member = { locationId: { in: allowedLocationIds } };
    }

    const totalMembers = await (prisma as any).member.count({ where: memberWhere });
    
    // Paid vs Pending
    const paidPayments = await (prisma as any).contributionPayment.findMany({
      where: { ...paymentWhere, status: 'PAID' },
      select: { amount: true, memberId: true }
    });

    const paidMemberIds = paidPayments.map((p: any) => p.memberId);
    const totalCollection = paidPayments.reduce((sum: number, p: any) => sum + p.amount, 0);

    const paidMembers = paidMemberIds.length;
    const pendingMembers = Math.max(0, totalMembers - paidMembers);

    // Assume target of ₹100 per member per month
    const monthlyTarget = totalMembers * 100;
    const monthlyAchieved = totalCollection;
    const collectionPercentage = monthlyTarget > 0 ? (monthlyAchieved / monthlyTarget) * 100 : 0;

    // Resolve name of scope
    let locationName = 'All Tamil Nadu';
    if (allowedLocationIds.length > 0) {
      const loc = await (prisma as any).location.findUnique({
        where: { id: allowedLocationIds[0] },
        select: { name: true }
      });
      locationName = loc?.name || locationName;
    }

    return {
      locationName,
      totalMembers,
      paidMembers,
      pendingMembers,
      totalCollection,
      monthlyTarget,
      monthlyAchieved,
      collectionPercentage
    };
  }

  /**
   * Pending payments list with filters.
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
      enrollments: {
        some: { status: 'ACTIVE' }
      }
    };
    if (allowedLocationIds.length > 0) {
      memberWhere.locationId = { in: allowedLocationIds };
    }

    // Get all active members enrolled in plans
    const members = await (prisma as any).member.findMany({
      where: memberWhere,
      include: {
        location: true,
        enrollments: { where: { status: 'ACTIVE' }, include: { plan: true } }
      }
    });

    const pendingList: any[] = [];

    for (const member of members) {
      // Find unpaid payments for this member
      const unpaid = await (prisma as any).contributionPayment.findMany({
        where: {
          memberId: member.id,
          status: { in: ['PENDING', 'FAILED'] }
        },
        include: { enrollment: { include: { plan: true } } }
      });

      if (unpaid.length > 0) {
        const dueAmount = unpaid.reduce((sum: number, p: any) => sum + (p.amount || p.enrollment?.plan?.monthlyAmount || 100), 0);
        pendingList.push({
          memberId: member.id,
          memberName: `${member.name} ${member.surname || ''}`.trim(),
          phone: member.phone,
          location: member.location.name,
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

    for (const p of payments) {
      const member = p.member;
      if (member.district) {
        districts.set(member.district, (districts.get(member.district) || 0) + p.amount);
      }
      if (member.constituency) {
        constituencies.set(member.constituency, (constituencies.get(member.constituency) || 0) + p.amount);
      }
      if (member.area) {
        areas.set(member.area, (areas.get(member.area) || 0) + p.amount);
      }
    }

    districts.forEach((amount, name) => districtWise.push({ name, amount }));
    constituencies.forEach((amount, name) => constituencyWise.push({ name, amount }));
    areas.forEach((amount, name) => areaWise.push({ name, amount }));

    // Sort descending
    districtWise.sort((a, b) => b.amount - a.amount);
    constituencyWise.sort((a, b) => b.amount - a.amount);
    areaWise.sort((a, b) => b.amount - a.amount);

    // 3. Payment Success Rate
    const totalPayments = await (prisma as any).contributionPayment.count();
    const paidCount = await (prisma as any).contributionPayment.count({ where: { status: 'PAID' } });
    const failedCount = await (prisma as any).contributionPayment.count({ where: { status: 'FAILED' } });
    const successRate = totalPayments > 0 ? (paidCount / totalPayments) * 100 : 0;

    // 4. Top Contributors
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
      topLocations: districtWise.slice(0, 3).map(d => d.name)
    };
  }

  /**
   * Leaderboard statistics.
   */
  static async getContributionLeaderboard(): Promise<any> {
    const topContributors = await (prisma as any).contributionProfile.findMany({
      take: 10,
      orderBy: { totalContribution: 'desc' },
      include: { member: true }
    });

    const districtSum = await (prisma as any).contributionPayment.groupBy({
      by: ['memberId'],
      where: { status: 'PAID' },
      _sum: { amount: true }
    });

    // Map aggregates geographically
    const districtWise: any[] = [];
    const constituencyWise: any[] = [];
    const areaWise: any[] = [];

    const profiles = await (prisma as any).contributionProfile.findMany({
      include: { member: true }
    });

    const dMap = new Map<string, number>();
    const cMap = new Map<string, number>();
    const aMap = new Map<string, number>();

    for (const profile of profiles) {
      const m = profile.member;
      if (m.district) dMap.set(m.district, (dMap.get(m.district) || 0) + profile.totalContribution);
      if (m.constituency) cMap.set(m.constituency, (cMap.get(m.constituency) || 0) + profile.totalContribution);
      if (m.area) aMap.set(m.area, (aMap.get(m.area) || 0) + profile.totalContribution);
    }

    dMap.forEach((amount, name) => districtWise.push({ name, amount }));
    cMap.forEach((amount, name) => constituencyWise.push({ name, amount }));
    aMap.forEach((amount, name) => areaWise.push({ name, amount }));

    districtWise.sort((a, b) => b.amount - a.amount);
    constituencyWise.sort((a, b) => b.amount - a.amount);
    areaWise.sort((a, b) => b.amount - a.amount);

    return {
      topContributors: topContributors.map((c: any) => ({
        memberName: `${c.member.name} ${c.member.surname || ''}`.trim(),
        amount: c.totalContribution,
        badge: c.badge
      })),
      topDistricts: districtWise.slice(0, 5),
      topConstituencies: constituencyWise.slice(0, 5),
      topAreas: areaWise.slice(0, 5),
      topCollectionAmount: districtWise.length > 0 ? districtWise[0].amount : 0
    };
  }
}
