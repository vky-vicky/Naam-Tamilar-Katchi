import prisma from './src/db.ts';

async function main() {
  const plans = await prisma.contributionPlan.findMany();
  console.log("Existing Plans:", plans);

  // Enroll all members in Plan 1 just to be safe for testing
  const allMembers = await prisma.member.findMany();
  let enrolledCount = 0;
  let alreadyEnrolledCount = 0;

  for (const member of allMembers) {
    const existing = await prisma.memberPlanEnrollment.findUnique({
      where: {
        memberId_planId: { memberId: member.id, planId: 1 }
      }
    });

    if (!existing) {
      await prisma.memberPlanEnrollment.create({
        data: {
          memberId: member.id,
          planId: 1,
          status: 'ACTIVE',
          autoRenew: true
        }
      });
      enrolledCount++;
    } else {
      alreadyEnrolledCount++;
    }
  }

  console.log(`Successfully enrolled ${enrolledCount} new members. ${alreadyEnrolledCount} members were already enrolled.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
