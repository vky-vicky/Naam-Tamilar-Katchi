import prisma from '../src/db.js';

async function main() {
  console.log('🌱 Seeding CRM database...');

  // Clean existing data
  await prisma.auditLog.deleteMany();
  await prisma.messageLog.deleteMany();
  await prisma.campaignTarget.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.oTP.deleteMany();
  await prisma.member.deleteMany();
  await prisma.user.deleteMany();
  await prisma.location.deleteMany();

  // 1. Create Location Hierarchy
  const state = await prisma.location.create({
    data: { name: 'Tamil Nadu', type: 'STATE' },
  });

  const district = await prisma.location.create({
    data: { name: 'Nagapattinam', type: 'DISTRICT', parentId: state.id },
  });

  const taluk = await prisma.location.create({
    data: { name: 'Vedharanyam', type: 'TALUK', parentId: district.id },
  });

  const area = await prisma.location.create({
    data: { name: 'Sector 4', type: 'AREA', parentId: taluk.id },
  });

  const street = await prisma.location.create({
    data: { name: 'Greenwood Avenue', type: 'STREET', parentId: area.id },
  });

  // 2. Create Users (Roles)
  await prisma.user.createMany({
    data: [
      {
        name: 'Leader',
        phone: '9000000001',
        password: 'hashed_password',
        role: 'SUPER_ADMIN',
      },
      {
        name: 'District Candidate',
        phone: '9000000002',
        password: 'hashed_password',
        role: 'CANDIDATE',
        locationId: district.id,
      },
      {
        name: 'Area Captain',
        phone: '9000000003',
        password: 'hashed_password',
        role: 'CAPTAIN',
        locationId: area.id,
      },
    ],
  });

  // 3. Create Members
  await prisma.member.createMany({
    data: [
      { name: 'Arjun K', phone: '9876543210', profession: 'Lawyer', locationId: street.id },
      { name: 'Priya S', phone: '9876543211', profession: 'Doctor', locationId: street.id },
      { name: 'Karthik R', phone: '9876543212', profession: 'Farmer', locationId: street.id },
      { name: 'Vijay M', phone: '9876543213', profession: 'Engineer', locationId: area.id },
    ],
  });

  // 4. Create a Sample Campaign
  const leader = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
  if (leader) {
    await prisma.campaign.create({
      data: {
        title: 'Statewide Farmers Support',
        message: 'Join us for the farmers support rally tomorrow!',
        createdById: leader.id,
        status: 'DRAFT',
        targets: {
          create: [{ locationId: state.id }],
        },
      },
    });
  }

  console.log('✅ CRM Seeding completed!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
