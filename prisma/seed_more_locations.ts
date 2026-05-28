import prisma from '../src/db.js';

type LocationSeed = {
  district: string;
  constituencies: Array<{
    constituency_name: string;
    areas: Array<{
      area_name: string;
      streets: string[];
    }>;
  }>;
};

type SeedCredentials = {
  place: string;
  role: string;
  name: string;
  phone: string;
  password: string;
};

const locationData: LocationSeed[] = [
  {
    district: 'Nagapattinam',
    constituencies: [
      {
        constituency_name: 'Nagapattinam',
        areas: [
          {
            area_name: 'Velippalayam',
            streets: [
              'Mariyamman Kovil Street',
              'South Street',
              'Middle Street',
              'VOC Nagar',
              'Anna Nagar',
              'Kamarajar Salai',
              'MGR Street',
              'Beach Road',
              'Old Bus Stand Road',
              'Nethaji Street'
            ]
          },
          {
            area_name: 'Nagore',
            streets: [
              'Dargah Street',
              'Perumal Kovil Street',
              'West Lane',
              'Rahman Nagar',
              'Kottaivasal',
              'Main Bazaar',
              'Kamaraj Street',
              'New Colony',
              'Theradi Street',
              'Railadi Street'
            ]
          }
        ]
      }
    ]
  },
  {
    district: 'Thanjavur',
    constituencies: [
      {
        constituency_name: 'Thanjavur',
        areas: [
          {
            area_name: 'Medical College',
            streets: [
              'Gandhi Nagar',
              'Mela Veethi',
              'North Main Street',
              'South Rampart',
              'Raja Street',
              'VOC Street',
              'Lakshmi Nagar',
              'New Bus Stand Road',
              'Anna Salai',
              'Teachers Colony'
            ]
          },
          {
            area_name: 'Vallam',
            streets: [
              'East Street',
              'West Car Street',
              'Mariamman Kovil Street',
              'Pillaiyar Kovil Street',
              'Main Road',
              'River Side Road',
              'Nehru Nagar',
              'Kurinji Nagar',
              'Kaveri Nagar',
              'Market Line'
            ]
          }
        ]
      }
    ]
  },
  {
    district: 'Tiruvarur',
    constituencies: [
      {
        constituency_name: 'Tiruvarur',
        areas: [
          {
            area_name: 'Thyagaraja Nagar',
            streets: [
              'South Street',
              'North Street',
              'Temple Street',
              'Kamarajar Nagar',
              'MGR Nagar',
              'Anna Nagar',
              'Market Street',
              'Lake View Road',
              'Middle Agraharam',
              'East Car Street'
            ]
          },
          {
            area_name: 'Koradachery',
            streets: [
              'Railway Station Road',
              'Periyar Street',
              'Gandhi Street',
              'Mela Street',
              'Kizhakku Theru',
              'VOC Nagar',
              'Indira Nagar',
              'New Colony',
              'Main Bazaar',
              'Bus Stand Road'
            ]
          }
        ]
      }
    ]
  }
];

async function findOrCreateLocation(name: string, type: 'STATE' | 'DISTRICT' | 'TALUK' | 'AREA' | 'STREET', parentId?: number) {
  const existing = await prisma.location.findFirst({
    where: {
      name,
      type,
      parentId: parentId ?? null
    }
  });

  if (existing) return { location: existing, created: false };

  const location = await prisma.location.create({
    data: {
      name,
      type,
      ...(parentId ? { parentId } : {}),
      ...(type === 'TALUK' || type === 'AREA' ? { password: 'admin123' } : {})
    }
  });

  return { location, created: true };
}

async function ensureProfession(name: string) {
  return prisma.profession.upsert({
    where: { name },
    update: {},
    create: { name }
  });
}

async function seedAccountsForConstituency(params: {
  districtIndex: number;
  constituencyName: string;
  constituencyId: number;
  areaId: number;
  streetId: number;
  credentials: SeedCredentials[];
}) {
  const phoneBase = 9100000000 + params.districtIndex * 100;
  const password = 'admin123';

  const admin = await prisma.user.upsert({
    where: { phone: String(phoneBase + 1) },
    update: {
      name: `${params.constituencyName} Admin`,
      password,
      role: 'ADMIN',
      locationId: params.constituencyId,
      approvalStatus: 'APPROVED'
    },
    create: {
      name: `${params.constituencyName} Admin`,
      phone: String(phoneBase + 1),
      password,
      role: 'ADMIN',
      locationId: params.constituencyId,
      approvalStatus: 'APPROVED'
    }
  });

  const subAdmin = await prisma.user.upsert({
    where: { phone: String(phoneBase + 2) },
    update: {
      name: `${params.constituencyName} Sub Admin`,
      password,
      role: 'SUB_ADMIN',
      locationId: params.areaId,
      parentId: admin.id,
      approvalStatus: 'APPROVED'
    },
    create: {
      name: `${params.constituencyName} Sub Admin`,
      phone: String(phoneBase + 2),
      password,
      role: 'SUB_ADMIN',
      locationId: params.areaId,
      parentId: admin.id,
      approvalStatus: 'APPROVED'
    }
  });

  params.credentials.push(
    {
      place: params.constituencyName,
      role: 'ADMIN',
      name: admin.name,
      phone: admin.phone,
      password
    },
    {
      place: params.constituencyName,
      role: 'SUB_ADMIN',
      name: subAdmin.name,
      phone: subAdmin.phone,
      password
    }
  );

  const professions = await Promise.all([
    ensureProfession('Farmer'),
    ensureProfession('Student'),
    ensureProfession('Lawyer')
  ]);

  const memberSeeds = [
    { name: 'Arul', bloodGroup: 'O+', profession: professions[0] },
    { name: 'Kavin', bloodGroup: 'A+', profession: professions[1] },
    { name: 'Meena', bloodGroup: 'B+', profession: professions[2] }
  ];

  for (const [index, seed] of memberSeeds.entries()) {
    const phone = String(phoneBase + 10 + index);
    const member = await prisma.member.upsert({
      where: { phone },
      update: {
        name: `${params.constituencyName} ${seed.name}`,
        password: 'member123',
        locationId: params.streetId,
        professionId: seed.profession.id,
        approvalStatus: 'APPROVED',
        createdById: subAdmin.id,
        isActive: true
      },
      create: {
        name: `${params.constituencyName} ${seed.name}`,
        phone,
        password: 'member123',
        bloodGroup: seed.bloodGroup,
        role: 'Member',
        locationId: params.streetId,
        professionId: seed.profession.id,
        approvalStatus: 'APPROVED',
        createdById: subAdmin.id,
        isActive: true
      }
    });

    params.credentials.push({
      place: params.constituencyName,
      role: 'MEMBER',
      name: member.name,
      phone: member.phone,
      password: 'member123'
    });
  }
}

async function main() {
  console.log('Importing additional district location data...');

  const { location: state } = await findOrCreateLocation('Tamil Nadu', 'STATE');
  const credentials: SeedCredentials[] = [];

  let districtCount = 0;
  let constituencyCount = 0;
  let areaCount = 0;
  let streetCount = 0;

  for (const [districtIndex, districtSeed] of locationData.entries()) {
    const districtResult = await findOrCreateLocation(districtSeed.district, 'DISTRICT', state.id);
    if (districtResult.created) districtCount++;

    for (const constituencySeed of districtSeed.constituencies) {
      const constituencyResult = await findOrCreateLocation(
        constituencySeed.constituency_name,
        'TALUK',
        districtResult.location.id
      );
      if (constituencyResult.created) constituencyCount++;

      let firstAreaId: number | null = null;
      let firstStreetId: number | null = null;

      for (const areaSeed of constituencySeed.areas) {
        const areaResult = await findOrCreateLocation(areaSeed.area_name, 'AREA', constituencyResult.location.id);
        if (areaResult.created) areaCount++;
        firstAreaId ??= areaResult.location.id;

        for (const streetName of areaSeed.streets) {
          const streetResult = await findOrCreateLocation(streetName, 'STREET', areaResult.location.id);
          if (streetResult.created) streetCount++;
          firstStreetId ??= streetResult.location.id;
        }
      }

      if (firstAreaId && firstStreetId) {
        await seedAccountsForConstituency({
          districtIndex: districtIndex + 1,
          constituencyName: constituencySeed.constituency_name,
          constituencyId: constituencyResult.location.id,
          areaId: firstAreaId,
          streetId: firstStreetId,
          credentials
        });
      }
    }
  }

  console.log(
    `Additional location import complete. New districts: ${districtCount}, constituencies: ${constituencyCount}, areas: ${areaCount}, streets: ${streetCount}`
  );
  console.table(credentials);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
