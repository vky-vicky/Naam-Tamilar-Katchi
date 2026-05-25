import prisma from '../src/db.js';

async function main() {
  console.log('🌱 Seeding CRM with Professional Hierarchy (Super Admin > Admin > Sub Admin)...');

  // 1. Ensure State exists
  let state = await prisma.location.findFirst({ where: { name: 'Tamil Nadu', type: 'STATE' } });
  if (!state) {
    state = await prisma.location.create({ data: { name: 'Tamil Nadu', type: 'STATE' } });
  }

  // 2. Ensure Professions exist
  const professionNames = ['Doctor', 'Lawyer', 'Farmer', 'Engineer', 'Student'];
  const professions = [];
  for (const name of professionNames) {
    let prof = await prisma.profession.findUnique({ where: { name } });
    if (!prof) {
      prof = await prisma.profession.create({ data: { name } });
    }
    professions.push(prof);
  }

  // 3. Create Hierarchy Locations
  let naga = await prisma.location.findFirst({ where: { name: 'Nagapattinam', type: 'DISTRICT' } });
  if (!naga) {
    naga = await prisma.location.create({ data: { name: 'Nagapattinam', type: 'DISTRICT', parentId: state.id } });
  }

  let veda = await prisma.location.findFirst({ where: { name: 'Vedaranyam', type: 'TALUK', parentId: naga.id } });
  if (!veda) {
    veda = await prisma.location.create({ data: { name: 'Vedaranyam', type: 'TALUK', parentId: naga.id, password: 'admin123' } });
  }

  let pushpa = await prisma.location.findFirst({ where: { name: 'Pushpavanam', type: 'AREA', parentId: veda.id } });
  if (!pushpa) {
    pushpa = await prisma.location.create({ data: { name: 'Pushpavanam', type: 'AREA', parentId: veda.id, password: 'admin123' } });
  }

  // 4. Create Users (Roles)
  // Super Admin (Created Manually via Seed)
  const superAdmin = await prisma.user.upsert({
    where: { phone: '9000000001' },
    update: { approvalStatus: 'APPROVED' },
    create: { 
      name: 'Thalaivar Seeman', 
      phone: '9000000001', 
      password: 'admin123', 
      role: 'SUPER_ADMIN',
      approvalStatus: 'APPROVED'
    }
  });

  // District Admin
  const admin = await prisma.user.upsert({
    where: { phone: '9000000002' },
    update: { locationId: veda.id, approvalStatus: 'APPROVED' },
    create: { 
      name: 'Vedaranyam Admin', 
      phone: '9000000002', 
      password: 'admin123', 
      role: 'ADMIN',
      locationId: veda.id,
      approvalStatus: 'APPROVED',
      parentId: superAdmin.id
    }
  });

  // Area Sub Admin
  const subAdmin = await prisma.user.upsert({
    where: { phone: '9000000003' },
    update: { locationId: pushpa.id, approvalStatus: 'APPROVED' },
    create: { 
      name: 'Pushpavanam Sub-Admin', 
      phone: '9000000003', 
      password: 'admin123', 
      role: 'SUB_ADMIN',
      locationId: pushpa.id,
      approvalStatus: 'APPROVED',
      parentId: admin.id
    }
  });

  // 5. Create Members with mixed Approval Status
  const streets = ['Kanjamalai street', 'Main Road'];
  const realisticNames = ["Arulmozhi", "Senthamizhan", "Vetrivel", "Anbazhagan", "Kayalvizhi", "Tamilarasan", "Ezhil", "Iniyan", "Thamizhisai", "Karkivel"];

  for (const sName of streets) {
    let street = await prisma.location.findFirst({ where: { name: sName, type: 'STREET', parentId: pushpa.id } });
    if (!street) {
      street = await prisma.location.create({ data: { name: sName, type: 'STREET', parentId: pushpa.id } });
    }

    const existingCount = await prisma.member.count({ where: { locationId: street.id } });
    if (existingCount === 0) {
      for (let i = 0; i < 10; i++) {
        const bg = ['A+', 'O+', 'B+'][Math.floor(Math.random() * 3)] || 'O+';
        const randomProf = professions[Math.floor(Math.random() * professions.length)];
        const profId = randomProf ? randomProf.id : null;
        const nameVal = realisticNames[i] ? `${realisticNames[i]} - ${sName}` : `Member - ${sName}`;

        await prisma.member.create({
          data: {
            name: nameVal,
            phone: `9${Math.floor(100000000 + Math.random() * 900000000)}`,
            bloodGroup: bg,
            professionId: profId,
            locationId: street.id,
            role: 'Member',
            approvalStatus: i < 5 ? 'APPROVED' : 'PENDING', // 5 approved, 5 pending
            isActive: true,
            createdById: subAdmin.id
          }
        });
      }
    }
  }

  // 6. Ensure default Communities exist
  const defaultCommunities = [
    { name: 'Lawyers', description: 'Lawyers Community' },
    { name: 'Police', description: 'Police Assistance Community' },
    { name: 'Farmers', description: 'Farmers Coordination Community' },
    { name: 'Students', description: 'Students Community' },
    { name: 'Doctors', description: 'Doctors & Medical Community' }
  ];
  const dbCommunities = [];
  for (const comm of defaultCommunities) {
    let community = await (prisma as any).community.findUnique({ where: { name: comm.name } });
    if (!community) {
      community = await (prisma as any).community.create({
        data: {
          name: comm.name,
          description: comm.description,
          image: `https://avatar.iran.liara.run/username?username=${comm.name}`
        }
      });
    }
    dbCommunities.push(community);
  }

  // 7. Auto-join seeded members to matching communities based on profession
  const allMembers = await (prisma as any).member.findMany({
    include: { profession: true }
  });
  for (const m of allMembers) {
    if (m.profession) {
      const normalized = m.profession.name.toLowerCase().trim();
      for (const dbComm of dbCommunities) {
        const normalCommunity = dbComm.name.toLowerCase();
        if (normalCommunity.includes(normalized) || normalized.includes(normalCommunity)) {
          await (prisma as any).communityMember.upsert({
            where: {
              communityId_memberId: {
                communityId: dbComm.id,
                memberId: m.id
              }
            },
            create: {
              communityId: dbComm.id,
              memberId: m.id
            },
            update: {}
          });
        }
      }
    }
  }

  console.log('✅ Hierarchy Seeding completed! Use phones 9000000001, 9000000002, 9000000003 for testing.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
