import prisma from '../db.js';

export class CronService {
  private static intervalId: any = null;

  /**
   * Starts the monthly billing cron simulation.
   * Runs checkBilling immediately, and then schedules it every 12 hours.
   */
  static startBillingScheduler() {
    this.checkAndGenerateBilling().catch(err => console.error('[Cron Billing] Initial check failed:', err));
    
    // Check every 12 hours
    this.intervalId = setInterval(() => {
      this.checkAndGenerateBilling().catch(err => console.error('[Cron Billing] Scheduled execution failed:', err));
    }, 12 * 60 * 60 * 1000);

    console.log('[Cron Service] Monthly contribution billing scheduler started (12h cycle).');
  }

  /**
   * Stops the scheduler.
   */
  static stopBillingScheduler() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Generates pending billing records for all active enrollments for the current month/year.
   */
  static async checkAndGenerateBilling(): Promise<void> {
    const now = new Date();
    const currentMonth = now.getMonth() + 1; // 1-indexed (1-12)
    const currentYear = now.getFullYear();

    console.log(`[Cron Billing] Running billing check for ${currentMonth}/${currentYear}...`);

    try {
      // Find all ACTIVE enrollments
      const enrollments = await (prisma as any).memberPlanEnrollment.findMany({
        where: { status: 'ACTIVE' },
        include: { plan: true }
      });

      let createdCount = 0;

      for (const enrollment of enrollments) {
        // Check if a payment record already exists for this member/month/year
        const existing = await (prisma as any).contributionPayment.findFirst({
          where: {
            memberId: enrollment.memberId,
            month: currentMonth,
            year: currentYear
          }
        });

        // If not exists, create a PENDING payment record
        if (!existing) {
          await (prisma as any).contributionPayment.create({
            data: {
              enrollmentId: enrollment.id,
              memberId: enrollment.memberId,
              amount: enrollment.plan.monthlyAmount,
              month: currentMonth,
              year: currentYear,
              status: 'PENDING'
            }
          });
          createdCount++;
        }
      }

      if (createdCount > 0) {
        console.log(`[Cron Billing] Generated ${createdCount} pending contribution billing records for ${currentMonth}/${currentYear}.`);
      } else {
        console.log(`[Cron Billing] Billing is up to date for ${currentMonth}/${currentYear}. No records created.`);
      }
    } catch (err: any) {
      console.error('[Cron Billing] Error in billing job:', err.message);
    }
  }
}
