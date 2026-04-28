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

  const state = await prisma.location.create({
    data: { name: 'Tamil Nadu', type: 'STATE' },
  });

  // Helper to create a hierarchy
  const createStreet = async (districtName: string, zoneName: string, streetName: string, memberCount: number) => {
    let district = await prisma.location.findFirst({ where: { name: districtName, type: 'DISTRICT' } });
    if (!district) {
      district = await prisma.location.create({ data: { name: districtName, type: 'DISTRICT', parentId: state.id } });
    }

    let zone = await prisma.location.findFirst({ where: { name: zoneName, type: 'TALUK', parentId: district.id } });
    if (!zone) {
      zone = await prisma.location.create({ data: { name: zoneName, type: 'TALUK', parentId: district.id } });
    }

    const street = await prisma.location.create({ data: { name: streetName, type: 'STREET', parentId: zone.id } });

    // Create dummy members
    const members = Array.from({ length: memberCount }).map((_, i) => ({
      name: `Member ${i + 1} of ${streetName}`,
      phone: `${Math.floor(1000000000 + Math.random() * 9000000000)}`,
      locationId: street.id,
    }));

    await prisma.member.createMany({ data: members });
    return street;
  };

  await createStreet('Central District', 'Zone A', 'Gandhi Street', 120);
  await createStreet('North Ridge', 'Zone B', 'Oak Avenue', 85);
  await createStreet('Riverside', 'Zone C', 'Maple Boulevard', 243);
  await createStreet('Market Square', 'Zone A', 'Main Road', 512);
  await createStreet('Old Town', 'Zone D', 'Victoria Lane', 64);
  await createStreet('Hillside', 'Zone B', 'Sunset Boulevard', 198);

  // 2. Create Users (Roles)
  const centralDistrict = await prisma.location.findFirst({ where: { name: 'Central District' } });
  const zoneA = await prisma.location.findFirst({ where: { name: 'Zone A' } });
  const gandhiStreet = await prisma.location.findFirst({ where: { name: 'Gandhi Street' } });

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
        locationId: centralDistrict?.id,
      },
      {
        name: 'Area Captain',
        phone: '9000000003',
        password: 'hashed_password',
        role: 'CAPTAIN',
        locationId: zoneA?.id,
      },
    ],
  });

  // 3. Create Members
  await prisma.member.createMany({
    data: [
      { name: 'Arjun K', phone: '9876543210', profession: 'Lawyer', locationId: gandhiStreet?.id || 0 },
      { name: 'Priya S', phone: '9876543211', profession: 'Doctor', locationId: gandhiStreet?.id || 0 },
      { name: 'Karthik R', phone: '9876543212', profession: 'Farmer', locationId: gandhiStreet?.id || 0 },
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
