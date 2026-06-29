import prisma from '../src/db.js';

const locationTree = [
  {
    name: 'நாகப்பட்டினம்',
    nameEn: 'Nagapattinam',
    type: 'DISTRICT',
    children: [
      {
        name: 'நாகூர்',
        nameEn: 'Nagore',
        type: 'TALUK',
        children: [
          { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'AREA' },
          { name: 'பள்ளிவாசல் தெரு', nameEn: 'Pallivasal Street', type: 'AREA' },
          { name: 'கடற்கரை சாலை', nameEn: 'Beach Road', type: 'AREA' }
        ]
      },
      {
        name: 'அக்கரைப்பேட்டை',
        nameEn: 'Akkaraipettai',
        type: 'TALUK',
        children: [
          { name: 'வடக்கு தெரு', nameEn: 'North Street', type: 'AREA' },
          { name: 'தெற்கு தெரு', nameEn: 'South Street', type: 'AREA' },
          { name: 'நடு தெரு', nameEn: 'Middle Street', type: 'AREA' }
        ]
      },
      {
        name: 'சிக்கல்',
        nameEn: 'Sikkal',
        type: 'TALUK',
        children: [
          { name: 'கோவில் தெரு', nameEn: 'Kovil Street', type: 'AREA' },
          { name: 'கிழக்கு தெரு', nameEn: 'East Street', type: 'AREA' },
          { name: 'மேற்கு தெரு', nameEn: 'West Street', type: 'AREA' }
        ]
      }
    ]
  },
  {
    name: 'கீழ்வேளூர்',
    nameEn: 'Kilvelur',
    type: 'DISTRICT',
    children: [
      {
        name: 'கீழ்வேளூர்',
        nameEn: 'Kilvelur',
        type: 'TALUK',
        children: [
          { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'AREA' },
          { name: 'வடக்கு தெரு', nameEn: 'North Street', type: 'AREA' },
          { name: 'தெற்கு தெரு', nameEn: 'South Street', type: 'AREA' }
        ]
      },
      {
        name: 'கீழையூர்',
        nameEn: 'Keezhaiyur',
        type: 'TALUK',
        children: [
          { name: 'கிழக்கு தெரு', nameEn: 'East Street', type: 'AREA' },
          { name: 'மேற்கு தெரு', nameEn: 'West Street', type: 'AREA' },
          { name: 'காலனி தெரு', nameEn: 'Colony Street', type: 'AREA' }
        ]
      },
      {
        name: 'வலிவலம்',
        nameEn: 'Valivalam',
        type: 'TALUK',
        children: [
          { name: 'கோவில் தெரு', nameEn: 'Kovil Street', type: 'AREA' },
          { name: 'சந்தை தெரு', nameEn: 'Market Street', type: 'AREA' },
          { name: 'பள்ளி தெரு', nameEn: 'School Street', type: 'AREA' }
        ]
      }
    ]
  },
  {
    name: 'வேதாரண்யம்',
    nameEn: 'Vedaranyam',
    type: 'DISTRICT',
    children: [
      {
        name: 'புஷ்பவனம்',
        nameEn: 'Pushpavanam',
        type: 'TALUK',
        children: [
          { name: 'முத்துக்கவுண்டர் காடு', nameEn: 'Muthukounder Kadu', type: 'AREA' },
          { name: 'மீனவர் தெரு', nameEn: 'Fishermen Street', type: 'AREA' },
          { name: 'அழகர்கவுண்டர் காடு', nameEn: 'Azhagarkounder Kadu', type: 'AREA' }
        ]
      },
      {
        name: 'பெரியகுத்தகை',
        nameEn: 'Periyakuthagai',
        type: 'TALUK',
        children: [
          { name: 'அலங்காரங்காடு', nameEn: 'Alangarangkadu', type: 'AREA' },
          { name: 'வேட்டையன் காடு', nameEn: 'Vettaiyankadu', type: 'AREA' },
          { name: 'நாட்டாண் காடு', nameEn: 'Nattaankadu', type: 'AREA' }
        ]
      },
      {
        name: 'கோவில்பத்து',
        nameEn: 'Kovilpathu',
        type: 'TALUK',
        children: [
          { name: 'துளுக்கத் தெரு', nameEn: 'Thulukka Street', type: 'AREA' },
          { name: 'மேலக்காடு தெற்கு காடு', nameEn: 'Melakkadu South Kadu', type: 'AREA' },
          { name: 'கவுண்டர்காடு', nameEn: 'Gounderkadu', type: 'AREA' }
        ]
      }
    ]
  },
  {
    name: 'தஞ்சாவூர்',
    nameEn: 'Thanjavur',
    type: 'DISTRICT',
    children: [
      {
        name: 'தஞ்சாவூர்',
        nameEn: 'Thanjavur',
        type: 'TALUK',
        children: [
          {
            name: 'தஞ்சாவூர்',
            nameEn: 'Thanjavur',
            type: 'AREA',
            children: [
              { name: 'கிழக்கு மெயின் தெரு', nameEn: 'East Main Street', type: 'STREET' },
              { name: 'தெற்கு மெயின் தெரு', nameEn: 'South Main Street', type: 'STREET' },
              { name: 'மேற்கு மெயின் தெரு', nameEn: 'West Main Street', type: 'STREET' }
            ]
          },
          {
            name: 'வல்லம்',
            nameEn: 'Vallam',
            type: 'AREA',
            children: [
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' },
              { name: 'கோவில் தெரு', nameEn: 'Kovil Street', type: 'STREET' },
              { name: 'காலனி தெரு', nameEn: 'Colony Street', type: 'STREET' }
            ]
          },
          {
            name: 'பிள்ளையார்பட்டி',
            nameEn: 'Pillayarpatti',
            type: 'AREA',
            children: [
              { name: 'வடக்கு தெரு', nameEn: 'North Street', type: 'STREET' },
              { name: 'தெற்கு தெரு', nameEn: 'South Street', type: 'STREET' },
              { name: 'கிழக்கு தெரு', nameEn: 'East Street', type: 'STREET' }
            ]
          }
        ]
      },
      {
        name: 'ஒரத்தநாடு',
        nameEn: 'Orathanadu',
        type: 'TALUK',
        children: [
          {
            name: 'ஒரத்தநாடு',
            nameEn: 'Orathanadu',
            type: 'AREA',
            children: [
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' },
              { name: 'பஜார் தெரு', nameEn: 'Bazaar Street', type: 'STREET' },
              { name: 'தெற்கு தெரு', nameEn: 'South Street', type: 'STREET' }
            ]
          },
          {
            name: 'காக்கரை',
            nameEn: 'Kakkarai',
            type: 'AREA',
            children: [
              { name: 'கிழக்கு தெரு', nameEn: 'East Street', type: 'STREET' },
              { name: 'மேற்கு தெரு', nameEn: 'West Street', type: 'STREET' },
              { name: 'கோவில் தெரு', nameEn: 'Kovil Street', type: 'STREET' }
            ]
          },
          {
            name: 'வடக்கூர்',
            nameEn: 'Vadakkur',
            type: 'AREA',
            children: [
              { name: 'வடக்கு தெரு', nameEn: 'North Street', type: 'STREET' },
              { name: 'காலனி தெரு', nameEn: 'Colony Street', type: 'STREET' },
              { name: 'பள்ளி தெரு', nameEn: 'School Street', type: 'STREET' }
            ]
          }
        ]
      },
      {
        name: 'பட்டுக்கோட்டை',
        nameEn: 'Pattukkottai',
        type: 'TALUK',
        children: [
          {
            name: 'பட்டுக்கோட்டை',
            nameEn: 'Pattukkottai',
            type: 'AREA',
            children: [
              { name: 'பெரிய தெரு', nameEn: 'Big Street', type: 'STREET' },
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' },
              { name: 'ரயில்வே சாலை', nameEn: 'Railway Road', type: 'STREET' }
            ]
          },
          {
            name: 'அத்திவெட்டி',
            nameEn: 'Athivetti',
            type: 'AREA',
            children: [
              { name: 'கோவில் தெரு', nameEn: 'Kovil Street', type: 'STREET' },
              { name: 'கிழக்கு தெரு', nameEn: 'East Street', type: 'STREET' },
              { name: 'மேற்கு தெரு', nameEn: 'West Street', type: 'STREET' }
            ]
          },
          {
            name: 'மதுக்கூர்',
            nameEn: 'Madukkur',
            type: 'AREA',
            children: [
              { name: 'தெற்கு தெரு', nameEn: 'South Street', type: 'STREET' },
              { name: 'வடக்கு தெரு', nameEn: 'North Street', type: 'STREET' },
              { name: 'காலனி தெரு', nameEn: 'Colony Street', type: 'STREET' }
            ]
          }
        ]
      },
      {
        name: 'பேராவூரணி',
        nameEn: 'Peravurani',
        type: 'TALUK',
        children: [
          {
            name: 'பேராவூரணி',
            nameEn: 'Peravurani',
            type: 'AREA',
            children: [
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' },
              { name: 'சந்தை தெரு', nameEn: 'Market Street', type: 'STREET' },
              { name: 'தெற்கு தெரு', nameEn: 'South Street', type: 'STREET' }
            ]
          },
          {
            name: 'சேதுபாவாசத்திரம்',
            nameEn: 'Sethubhavachatram',
            type: 'AREA',
            children: [
              { name: 'கடற்கரை சாலை', nameEn: 'Beach Road', type: 'STREET' },
              { name: 'பள்ளிவாசல் தெரு', nameEn: 'Pallivasal Street', type: 'STREET' },
              { name: 'கிழக்கு தெரு', nameEn: 'East Street', type: 'STREET' }
            ]
          },
          {
            name: 'மல்லிப்பட்டினம்',
            nameEn: 'Mallipattinam',
            type: 'AREA',
            children: [
              { name: 'மீனவர் தெரு', nameEn: 'Fishermen Street', type: 'STREET' },
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' },
              { name: 'மேற்கு தெரு', nameEn: 'West Street', type: 'STREET' }
            ]
          }
        ]
      }
    ]
  },
  {
    name: 'திருச்சிராப்பள்ளி',
    nameEn: 'Tiruchirappalli',
    type: 'DISTRICT',
    children: [
      {
        name: 'திருச்சி கிழக்கு',
        nameEn: 'Tiruchirappalli East',
        type: 'TALUK',
        children: [
          {
            name: 'உறையூர்',
            nameEn: 'Uraiyur',
            type: 'AREA',
            children: [
              { name: 'பெரிய பஜார் தெரு', nameEn: 'Big Bazaar Street', type: 'STREET' },
              { name: 'கிழக்கு தெரு', nameEn: 'East Street', type: 'STREET' },
              { name: 'மேற்கு தெரு', nameEn: 'West Street', type: 'STREET' }
            ]
          },
          {
            name: 'பாலக்கரை',
            nameEn: 'Palakarai',
            type: 'AREA',
            children: [
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' },
              { name: 'தெற்கு தெரு', nameEn: 'South Street', type: 'STREET' },
              { name: 'காலனி தெரு', nameEn: 'Colony Street', type: 'STREET' }
            ]
          },
          {
            name: 'கேன்டோன்மெண்ட்',
            nameEn: 'Cantonment',
            type: 'AREA',
            children: [
              { name: 'ரயில்வே சாலை', nameEn: 'Railway Road', type: 'STREET' },
              { name: 'சந்தை தெரு', nameEn: 'Market Street', type: 'STREET' },
              { name: 'தேவாலய தெரு', nameEn: 'Church Street', type: 'STREET' }
            ]
          }
        ]
      },
      {
        name: 'திருச்சி மேற்கு',
        nameEn: 'Tiruchirappalli West',
        type: 'TALUK',
        children: [
          {
            name: 'தில்லை நகர்',
            nameEn: 'Thillai Nagar',
            type: 'AREA',
            children: [
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' },
              { name: 'முதல் குறுக்கு தெரு', nameEn: '1st Cross Street', type: 'STREET' },
              { name: 'இரண்டாம் குறுக்கு தெரு', nameEn: '2nd Cross Street', type: 'STREET' }
            ]
          },
          {
            name: 'கே.கே. நகர்',
            nameEn: 'K.K. Nagar',
            type: 'AREA',
            children: [
              { name: 'மத்திய அவென்யூ', nameEn: 'Central Avenue', type: 'STREET' },
              { name: 'வடக்கு தெரு', nameEn: 'North Street', type: 'STREET' },
              { name: 'தெற்கு தெரு', nameEn: 'South Street', type: 'STREET' }
            ]
          },
          {
            name: 'எடமலைப்பட்டி புதூர்',
            nameEn: 'Edamalaipatti Pudur',
            type: 'AREA',
            children: [
              { name: 'காலனி தெரு', nameEn: 'Colony Street', type: 'STREET' },
              { name: 'பள்ளி தெரு', nameEn: 'School Street', type: 'STREET' },
              { name: 'கோவில் தெரு', nameEn: 'Kovil Street', type: 'STREET' }
            ]
          }
        ]
      },
      {
        name: 'ஸ்ரீரங்கம்',
        nameEn: 'Srirangam',
        type: 'TALUK',
        children: [
          {
            name: 'ஸ்ரீரங்கம்',
            nameEn: 'Srirangam',
            type: 'AREA',
            children: [
              { name: 'சித்திரை தெரு', nameEn: 'Chithirai Street', type: 'STREET' },
              { name: 'கிழக்கு அடையவளஞ்சான் தெரு', nameEn: 'East Adaiyavalanjan Street', type: 'STREET' },
              { name: 'மேற்கு அடையவளஞ்சான் தெரு', nameEn: 'West Adaiyavalanjan Street', type: 'STREET' }
            ]
          },
          {
            name: 'திருவானைக்காவல்',
            nameEn: 'Thiruanaikoil',
            type: 'AREA',
            children: [
              { name: 'கோவில் தெரு', nameEn: 'Kovil Street', type: 'STREET' },
              { name: 'வடக்கு தெரு', nameEn: 'North Street', type: 'STREET' },
              { name: 'தெற்கு தெரு', nameEn: 'South Street', type: 'STREET' }
            ]
          },
          {
            name: 'மாம்பழ சாலை',
            nameEn: 'Mambazha Salai',
            type: 'AREA',
            children: [
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' },
              { name: 'கிழக்கு தெரு', nameEn: 'East Street', type: 'STREET' },
              { name: 'மேற்கு தெரு', nameEn: 'West Street', type: 'STREET' }
            ]
          }
        ]
      },
      {
        name: 'திருவெறும்பூர்',
        nameEn: 'Thiruverumbur',
        type: 'TALUK',
        children: [
          {
            name: 'திருவெறும்பூர்',
            nameEn: 'Thiruverumbur',
            type: 'AREA',
            children: [
              { name: 'பாரதியார் தெரு', nameEn: 'Bharathiyar Street', type: 'STREET' },
              { name: 'காந்தி தெரு', nameEn: 'Gandhi Street', type: 'STREET' },
              { name: 'மெயின் ரோடு', nameEn: 'Main Road', type: 'STREET' }
            ]
          },
          {
            name: 'பிஹெச்இஎல் நகரம்',
            nameEn: 'BHEL Township',
            type: 'AREA',
            children: [
              { name: 'முதல் தெரு', nameEn: '1st Street', type: 'STREET' },
              { name: 'இரண்டாம் தெரு', nameEn: '2nd Street', type: 'STREET' },
              { name: 'மூன்றாம் தெரு', nameEn: '3rd Street', type: 'STREET' }
            ]
          },
          {
            name: 'கைலாசபுரம்',
            nameEn: 'Kailasapuram',
            type: 'AREA',
            children: [
              { name: 'வடக்கு தெரு', nameEn: 'North Street', type: 'STREET' },
              { name: 'தெற்கு தெரு', nameEn: 'South Street', type: 'STREET' },
              { name: 'சந்தை தெரு', nameEn: 'Market Street', type: 'STREET' }
            ]
          }
        ]
      }
    ]
  }
];

async function seedLocations(parentId: number, nodes: any[]) {
  for (const node of nodes) {
    const created = await prisma.location.create({
      data: {
        name: node.name,
        nameEn: node.nameEn || null,
        type: node.type,
        parentId
      }
    });
    console.log(`Created Location: ${node.nameEn || node.name} (${node.type})`);
    if (node.children && node.children.length > 0) {
      await seedLocations(created.id, node.children);
    }
  }
}

async function main() {
  console.log('🧹 Cleaning existing database records...');
  // Delete dynamic records first to avoid foreign key errors
  await prisma.contributionPayment.deleteMany({});
  await prisma.memberPlanEnrollment.deleteMany({});
  await prisma.contributionProfile.deleteMany({});
  await prisma.contributionPlan.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.messageLog.deleteMany({});
  await prisma.campaignTarget.deleteMany({});
  await prisma.campaign.deleteMany({});
  await prisma.eventResponse.deleteMany({});
  await prisma.event.deleteMany({});
  await prisma.emergencyResponse.deleteMany({});
  await prisma.emergencyRequest.deleteMany({});
  await prisma.commentLike.deleteMany({});
  await prisma.comment.deleteMany({});
  await prisma.postLike.deleteMany({});
  await prisma.postReport.deleteMany({});
  await prisma.post.deleteMany({});
  await prisma.pollVote.deleteMany({});
  await prisma.pollOption.deleteMany({});
  await prisma.pollLike.deleteMany({});
  await prisma.pollCommentLike.deleteMany({});
  await prisma.pollComment.deleteMany({});
  await prisma.pollReport.deleteMany({});
  await prisma.poll.deleteMany({});
  await prisma.deletedNotification.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.broadcast.deleteMany({});
  await prisma.userLocation.deleteMany({});
  await prisma.locationAccessRequest.deleteMany({});
  await prisma.requestLocation.deleteMany({});
  await prisma.communityJoinRequest.deleteMany({});
  await prisma.communityAdminLog.deleteMany({});
  await prisma.communityComplaint.deleteMany({});
  await prisma.communityBan.deleteMany({});
  await prisma.communityAnnouncement.deleteMany({});
  await prisma.communityMemberActivity.deleteMany({});
  await prisma.communityMemberReport.deleteMany({});
  await prisma.communityLinkOrDoc.deleteMany({});
  await prisma.communityMessageStar.deleteMany({});
  await prisma.communityMessageReaction.deleteMany({});
  await prisma.communityMessageRead.deleteMany({});
  await prisma.communityMessage.deleteMany({});
  await prisma.communityPostLike.deleteMany({});
  await prisma.communityPostReport.deleteMany({});
  await prisma.communityComment.deleteMany({});
  await prisma.communityPost.deleteMany({});
  await prisma.communityMember.deleteMany({});
  await prisma.community.deleteMany({});
  await prisma.userWarning.deleteMany({});
  
  // Wipe users and members
  await prisma.member.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.location.deleteMany({});
  await prisma.profession.deleteMany({});

  console.log('🌱 Seeding State (Tamil Nadu)...');
  const state = await prisma.location.create({
    data: {
      name: 'தமிழ்நாடு',
      nameEn: 'Tamil Nadu',
      type: 'STATE'
    }
  });

  console.log('🌱 Seeding specific locations tree...');
  await seedLocations(state.id, locationTree);

  console.log('🌱 Seeding default professions...');
  const professionNames = ['Doctor', 'Lawyer', 'Farmer', 'Engineer', 'Student'];
  for (const name of professionNames) {
    await prisma.profession.create({ data: { name } });
  }

  console.log('🌱 Seeding default communities...');
  const defaultCommunities = [
    { name: 'Lawyers', description: 'Lawyers Community' },
    { name: 'Police', description: 'Police Assistance Community' },
    { name: 'Farmers', description: 'Farmers Coordination Community' },
    { name: 'Students', description: 'Students Community' },
    { name: 'Doctors', description: 'Doctors & Medical Community' }
  ];
  for (const comm of defaultCommunities) {
    await prisma.community.create({
      data: {
        name: comm.name,
        description: comm.description,
        image: `https://avatar.iran.liara.run/username?username=${comm.name}`
      }
    });
  }

  console.log('🌱 Seeding Single SUPER_ADMIN (Thalaivar Seeman)...');
  await prisma.user.create({
    data: {
      name: 'Thalaivar Seeman',
      phone: '9000000001',
      password: 'admin123',
      role: 'SUPER_ADMIN',
      locationId: state.id,
      approvalStatus: 'APPROVED'
    }
  });

  console.log('✅ Seeding completed! Only 1 Super Admin and custom locations seeded.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
