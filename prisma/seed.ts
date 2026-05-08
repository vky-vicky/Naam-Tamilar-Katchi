import prisma from '../src/db.js';

async function main() {
  console.log('🌱 Seeding CRM database with Persistent Data...');

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

  const bloodGroups = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];

  // 3. Ensure Locations exist (Nagapattinam Flow)
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
  
  // 3.1 Ensure Chennai District exists
  let chennai = await prisma.location.findFirst({ where: { name: 'Chennai', type: 'DISTRICT' } });
  if (!chennai) {
    chennai = await prisma.location.create({ data: { name: 'Chennai', type: 'DISTRICT', parentId: state.id } });
  }

  // 4. Ensure Streets and Members
  const streets = ['Kanjamalai street', 'Main Road', 'Gandhi Street'];
  const realisticNames = ["Arulmozhi", "Senthamizhan", "Vetrivel", "Anbazhagan", "Kayalvizhi", "Tamilarasan", "Ezhil", "Iniyan", "Thamizhisai", "Karkivel"];

  for (const sName of streets) {
    let street = await prisma.location.findFirst({ where: { name: sName, type: 'STREET', parentId: pushpa.id } });
    if (!street) {
      street = await prisma.location.create({ data: { name: sName, type: 'STREET', parentId: pushpa.id } });
    }

    // Check if members already exist for this street
    const existingCount = await prisma.member.count({ where: { locationId: street.id } });
    if (existingCount === 0) {
      for (let i = 0; i < 10; i++) {
        await prisma.member.create({
          data: {
            name: `${realisticNames[i]} - ${sName}`,
            phone: `9${Math.floor(100000000 + Math.random() * 900000000)}`,
            bloodGroup: bloodGroups[Math.floor(Math.random() * bloodGroups.length)] || null,
            professionId: professions[Math.floor(Math.random() * professions.length)].id,
            locationId: street.id,
            role: 'Member',
            isActive: true
          }
        });
      }
    }
  }

  // 5. Ensure Users
  await prisma.user.upsert({
    where: { phone: '9000000001' },
    update: { password: 'admin123' },
    create: { name: 'Thalaivar Seeman', phone: '9000000001', password: 'admin123', role: 'SUPER_ADMIN' }
  });

  await prisma.user.upsert({
    where: { phone: '9000000002' },
    update: { password: 'admin123', locationId: veda.id },
    create: { name: 'Vedaranyam Admin', phone: '9000000002', password: 'admin123', role: 'ADMIN', locationId: veda.id }
  });

  console.log('✅ CRM Seeding completed with Persistent Data Flow!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
