import prisma from '../src/db.js';

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

async function main() {
  console.log('🔄 Backfilling location fields (district, constituency, area, street) for existing Members...');
  const members = await (prisma as any).member.findMany({
    select: { id: true, locationId: true }
  });

  for (const member of members) {
    const locFields = await getLocationFields(member.locationId);
    await (prisma as any).member.update({
      where: { id: member.id },
      data: locFields
    });
  }
  console.log(`✅ Backfilled ${members.length} Members.`);

  console.log('🔄 Backfilling location fields for existing Users...');
  const users = await (prisma as any).user.findMany({
    select: { id: true, locationId: true }
  });

  for (const user of users) {
    if (user.locationId) {
      const locFields = await getLocationFields(user.locationId);
      await (prisma as any).user.update({
        where: { id: user.id },
        data: locFields
      });
    }
  }
  console.log(`✅ Backfilled ${users.length} Users.`);
}

main()
  .catch((e) => {
    console.error('Error during backfill:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
