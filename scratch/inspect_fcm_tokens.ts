import prisma from '../src/db.js';

async function main() {
  const usersWithToken = await (prisma as any).user.findMany({
    where: { fcmToken: { not: null } },
    select: { id: true, name: true, role: true, phone: true, fcmToken: true }
  });

  const membersWithToken = await (prisma as any).member.findMany({
    where: { fcmToken: { not: null } },
    select: { id: true, name: true, role: true, phone: true, fcmToken: true }
  });

  console.log('=== Users with FCM Token ===');
  console.table(usersWithToken);

  console.log('=== Members with FCM Token ===');
  console.table(membersWithToken);
}

main().finally(() => prisma.$disconnect());
