import prisma from '../src/db.js';

async function main() {
  console.log('🌱 Seeding CRM database with Captain Flow...');

  // Clean existing data
  await prisma.auditLog.deleteMany();
  await prisma.messageLog.deleteMany();
  await prisma.campaignTarget.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.oTP.deleteMany();
  await prisma.member.deleteMany();
  await prisma.user.deleteMany();
  await prisma.profession.deleteMany();
  await prisma.location.deleteMany();

  // 1. Create State
  const state = await prisma.location.create({
    data: { name: 'Tamil Nadu', type: 'STATE' },
  });

  // 2. Create Professions
  const doctor = await prisma.profession.create({ data: { name: 'Doctor' } });
  const lawyer = await prisma.profession.create({ data: { name: 'Lawyer' } });
  const farmer = await prisma.profession.create({ data: { name: 'Farmer' } });
  const engineer = await prisma.profession.create({ data: { name: 'Engineer' } });
  const student = await prisma.profession.create({ data: { name: 'Student' } });

  const professions = [doctor, lawyer, farmer, engineer, student];
  const bloodGroups = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];

  // 3. Create Locations (Nagapattinam Flow)
  const naga = await prisma.location.create({ data: { name: 'Nagapattinam', type: 'DISTRICT', parentId: state.id } });
  const veda = await prisma.location.create({ data: { name: 'Vedaranyam', type: 'TALUK', parentId: naga.id } });
  const pushpa = await prisma.location.create({ data: { name: 'Pushpavanam', type: 'AREA', parentId: veda.id } });
  
  const streets = ['Kanjamalai street', 'Main Road', 'Gandhi Street'];
  const streetNodes = [];

  for (const sName of streets) {
    const street = await prisma.location.create({ data: { name: sName, type: 'STREET', parentId: pushpa.id } });
    streetNodes.push(street);

    // Add 10 random members per street
    for (let i = 0; i < 10; i++) {
      await prisma.member.create({
        data: {
          name: `Member ${i + 1} of ${sName}`,
          phone: `9${Math.floor(100000000 + Math.random() * 900000000)}`,
          bloodGroup: bloodGroups[Math.floor(Math.random() * bloodGroups.length)],
          professionId: professions[Math.floor(Math.random() * professions.length)].id,
          locationId: street.id,
        }
      });
    }
  }

  // 4. Create Users (Roles)
  // Super Admin (Seeman)
  await prisma.user.create({
    data: {
      name: 'Thalaivar Seeman',
      phone: '9000000001',
      password: 'admin123',
      role: 'SUPER_ADMIN',
    }
  });

  // Admin (Constituency Leader - Vedaranyam)
  await prisma.user.create({
    data: {
      name: 'Vedaranyam Admin',
      phone: '9000000002',
      password: 'admin123',
      role: 'CANDIDATE',
      locationId: veda.id,
    }
  });

  // Captain (Area Leader - Pushpavanam)
  await prisma.user.create({
    data: {
      name: 'Pushpavanam Captain',
      phone: '9000000003',
      password: 'captain123',
      role: 'CAPTAIN',
      locationId: pushpa.id,
    }
  });

  console.log('✅ CRM Seeding completed with Captain Flow!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
