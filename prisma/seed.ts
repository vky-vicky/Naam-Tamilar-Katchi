import prisma from '../src/db.js';

async function main() {
  console.log('🌱 Seeding CRM database with Captain Flow...');

  // Clean existing data
  await prisma.auditLog.deleteMany();
  await prisma.messageLog.deleteMany();
  await prisma.campaignTarget.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.oTP.deleteMany();
  await prisma.eventResponse.deleteMany();
  await prisma.event.deleteMany();
  await prisma.emergencyRequest.deleteMany();
  await prisma.user.deleteMany();
  await prisma.member.deleteMany();
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
  const veda = await prisma.location.create({ data: { name: 'Vedaranyam', type: 'TALUK', parentId: naga.id, password: 'admin123' } });
  const pushpa = await prisma.location.create({ data: { name: 'Pushpavanam', type: 'AREA', parentId: veda.id, password: 'admin123' } });
  
  // 3.1 Create Chennai District
  const chennai = await prisma.location.create({ data: { name: 'Chennai', type: 'DISTRICT', parentId: state.id } });
  const marylapore = await prisma.location.create({ data: { name: 'Mylapore', type: 'TALUK', parentId: chennai.id, password: 'admin123' } });
  await prisma.location.create({ data: { name: 'Egmore', type: 'TALUK', parentId: chennai.id, password: 'admin123' } });
  await prisma.location.create({ data: { name: 'Velachery', type: 'TALUK', parentId: chennai.id, password: 'admin123' } });
  await prisma.location.create({ data: { name: 'T. Nagar', type: 'TALUK', parentId: chennai.id, password: 'admin123' } });
  
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
          bloodGroup: bloodGroups[Math.floor(Math.random() * bloodGroups.length)] || null,
          professionId: (professions[Math.floor(Math.random() * professions.length)] as any).id,
          locationId: street.id,
        }
      });
    }
  }

  // 4. Create Users (Roles)
  const seeman = await prisma.user.create({
    data: {
      name: 'Thalaivar Seeman',
      phone: '9000000001',
      password: 'admin123',
      role: 'SUPER_ADMIN',
    }
  });

  const vedaAdmin = await prisma.user.create({
    data: {
      name: 'Vedaranyam Admin',
      phone: '9000000002',
      password: 'admin123',
      role: 'CANDIDATE',
      locationId: veda.id,
    }
  });

  // 5. Create Events
  await prisma.event.create({
    data: {
      title: 'Clean-up Drive',
      description: 'Monthly village clean-up activity',
      date: new Date(),
      locationId: pushpa.id,
      status: 'ACTIVE',
      createdById: seeman.id
    }
  });

  // 6. Create Emergency Requests
  const someMember = await prisma.member.findFirst({ where: { locationId: { in: streetNodes.map(s => s.id) } } });
  
  await prisma.emergencyRequest.create({
    data: {
      title: 'Urgent A+ Blood',
      description: 'Medical emergency at local hospital',
      type: 'EMERGENCY',
      locationId: pushpa.id,
      memberId: someMember?.id || null,
      createdById: vedaAdmin.id,
      status: 'PENDING',
    }
  });

  // 7. Create Sample Community Posts
  await prisma.post.create({
    data: {
      content: "Exciting progress on our Green Spaces project! We've secured the initial permits for the community garden.",
      authorName: "Sarah Mitchell",
      authorRole: "Urban Initiative Committee",
      locationId: pushpa.id,
      likes: 24
    }
  });

  await prisma.post.create({
    data: {
      content: "I've just uploaded the draft for the new community bylaws to the Requests portal. Please take a look.",
      authorName: "Dr. James Chen",
      authorRole: "Policy Development Group",
      locationId: pushpa.id,
      likes: 12
    }
  });

  // 8. Create Sample Notifications
  await prisma.notification.create({
    data: {
      title: "Town Hall Meeting Tomorrow",
      message: "Don't forget the monthly meeting at 6:00 PM. We'll be discussing the new park initiative.",
      type: "EVENT",
      time: "2h ago",
      locationId: pushpa.id
    }
  });

  await prisma.notification.create({
    data: {
      title: "New Member Request",
      message: "Sarah Jenkins requested to join the District 4 Planning Committee.",
      type: "REQUEST",
      time: "4h ago",
      locationId: pushpa.id
    }
  });

  await prisma.notification.create({
    data: {
      title: "Security Alert",
      message: "New login detected from a Safari browser on macOS.",
      type: "ALERT",
      time: "12h ago",
      locationId: pushpa.id
    }
  });

  console.log('✅ CRM Seeding completed with Captain Flow and Dashboard 2.0!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
