import prisma from './src/db.js';

async function getChildLocationIds(locationId) {
  const locations = await prisma.location.findMany({
    select: { id: true, parentId: true },
  });
  const childrenByParent = new Map();
  for (const location of locations) {
    if (location.parentId === null || location.parentId === undefined) continue;
    const siblings = childrenByParent.get(location.parentId) || [];
    siblings.push(location.id);
    childrenByParent.set(location.parentId, siblings);
  }
  const ids = [];
  const queue = [...(childrenByParent.get(locationId) || [])];
  while (queue.length > 0) {
    const id = queue.shift();
    ids.push(id);
    queue.push(...(childrenByParent.get(id) || []));
  }
  return ids;
}

async function getCounts(locationId) {
  const allLocationIds = [locationId, ...(await getChildLocationIds(locationId))];
  
  const subAdmins = await prisma.user.count({
    where: { locationId: { in: allLocationIds }, role: 'SUB_ADMIN' }
  });

  const membersFromMember = await prisma.member.count({
    where: { locationId: { in: allLocationIds }, approvalStatus: 'APPROVED' }
  });
  
  const membersFromUser = await prisma.user.count({
    where: { locationId: { in: allLocationIds }, role: 'MEMBER', approvalStatus: 'APPROVED' }
  });

  return {
    locationId,
    subAdmins,
    totalMembers: membersFromMember + membersFromUser
  };
}

async function main() {
  console.log('Counts for 834 (District Nagapattinam):', await getCounts(834));
  console.log('Counts for 839 (Taluk Nagapattinam):', await getCounts(839));
}

main().finally(() => prisma.$disconnect());
