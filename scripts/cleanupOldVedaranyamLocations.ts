import prisma from '../src/db.js';

async function getChildLocationIds(locationId: number): Promise<number[]> {
  const children = await prisma.location.findMany({
    where: { parentId: locationId },
    select: { id: true },
  });

  const ids: number[] = [];
  for (const child of children) {
    ids.push(child.id, ...(await getChildLocationIds(child.id)));
  }
  return ids;
}

async function main() {
  const state = await prisma.location.findFirst({
    where: { name: 'Tamil Nadu', type: 'STATE' },
  });
  if (!state) throw new Error('Tamil Nadu state location not found');

  let tamilDistrict = await prisma.location.findFirst({
    where: { name: 'நாகப்பட்டினம்', type: 'DISTRICT', parentId: state.id },
  });
  if (!tamilDistrict) {
    tamilDistrict = await prisma.location.create({
      data: { name: 'நாகப்பட்டினம்', type: 'DISTRICT', parentId: state.id },
    });
  }

  let tamilTaluk = await prisma.location.findFirst({
    where: { name: 'வேதாரண்யம்', type: 'TALUK', parentId: tamilDistrict.id },
  });
  if (!tamilTaluk) {
    tamilTaluk = await prisma.location.create({
      data: {
        name: 'வேதாரண்யம்',
        type: 'TALUK',
        parentId: tamilDistrict.id,
        password: 'vedaranyam123',
      },
    });
  }

  const oldDistrict = await prisma.location.findFirst({
    where: { name: 'Nagapattinam', type: 'DISTRICT', parentId: state.id },
  });
  const oldTaluk = oldDistrict
    ? await prisma.location.findFirst({
        where: { name: 'Vedaranyam', type: 'TALUK', parentId: oldDistrict.id },
      })
    : null;
  const oldPushpavanam = oldTaluk
    ? await prisma.location.findFirst({
        where: { name: 'Pushpavanam', type: 'AREA', parentId: oldTaluk.id },
      })
    : null;

  if (oldTaluk) {
    await prisma.location.updateMany({
      where: {
        parentId: oldTaluk.id,
        type: 'AREA',
        ...(oldPushpavanam ? { id: { not: oldPushpavanam.id } } : {}),
      },
      data: { parentId: tamilTaluk.id },
    });
  }

  const oldLocationIds = [
    oldDistrict?.id,
    oldTaluk?.id,
    oldPushpavanam?.id,
    ...(oldPushpavanam ? await getChildLocationIds(oldPushpavanam.id) : []),
  ].filter((id): id is number => typeof id === 'number');

  const users = await prisma.user.findMany({
    where: { locationId: { in: oldLocationIds } },
    select: { id: true },
  });
  const members = await prisma.member.findMany({
    where: { locationId: { in: oldLocationIds } },
    select: { id: true },
  });

  const userIds = users.map((user) => user.id);
  const memberIds = members.map((member) => member.id);

  const eventIds = (
    await prisma.event.findMany({
      where: {
        OR: [
          { locationId: { in: oldLocationIds } },
          ...(userIds.length ? [{ createdById: { in: userIds } }] : []),
        ],
      },
      select: { id: true },
    })
  ).map((event) => event.id);

  const campaignIds = userIds.length
    ? (
        await prisma.campaign.findMany({
          where: { createdById: { in: userIds } },
          select: { id: true },
        })
      ).map((campaign) => campaign.id)
    : [];

  const communityPostIds = userIds.length
    ? (
        await prisma.communityPost.findMany({
          where: { createdById: { in: userIds } },
          select: { id: true },
        })
      ).map((post) => post.id)
    : [];

  const postIds = (
    await prisma.post.findMany({
      where: { locationId: { in: oldLocationIds } },
      select: { id: true },
    })
  ).map((post) => post.id);

  if (memberIds.length) {
    await prisma.communityMember.deleteMany({ where: { memberId: { in: memberIds } } });
    await prisma.eventResponse.deleteMany({ where: { memberId: { in: memberIds } } });
    await prisma.messageLog.deleteMany({ where: { memberId: { in: memberIds } } });
    await prisma.emergencyRequest.deleteMany({ where: { memberId: { in: memberIds } } });
    await prisma.communityMessageRead.deleteMany({
      where: { readerType: 'MEMBER', readerId: { in: memberIds } },
    });
    await prisma.communityMessageReaction.deleteMany({
      where: { reactorType: 'MEMBER', reactorId: { in: memberIds } },
    });
    await prisma.communityMessage.deleteMany({
      where: { senderType: 'MEMBER', senderId: { in: memberIds } },
    });
  }

  if (userIds.length) {
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.emergencyRequest.deleteMany({ where: { createdById: { in: userIds } } });
    await prisma.broadcast.deleteMany({ where: { createdById: { in: userIds } } });
    await prisma.communityMessageRead.deleteMany({ where: { readerId: { in: userIds } } });
    await prisma.communityMessageReaction.deleteMany({ where: { reactorId: { in: userIds } } });
    await prisma.communityMessage.deleteMany({ where: { senderId: { in: userIds } } });
    await prisma.member.updateMany({
      where: { createdById: { in: userIds } },
      data: { createdById: null },
    });
    await prisma.member.updateMany({
      where: { approvedById: { in: userIds } },
      data: { approvedById: null },
    });
    await prisma.user.updateMany({
      where: { parentId: { in: userIds } },
      data: { parentId: null },
    });
  }

  if (eventIds.length) {
    await prisma.eventResponse.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  }

  if (campaignIds.length) {
    await prisma.messageLog.deleteMany({ where: { campaignId: { in: campaignIds } } });
    await prisma.campaignTarget.deleteMany({ where: { campaignId: { in: campaignIds } } });
    await prisma.campaign.deleteMany({ where: { id: { in: campaignIds } } });
  }

  if (communityPostIds.length) {
    await prisma.communityComment.deleteMany({ where: { postId: { in: communityPostIds } } });
    await prisma.communityPost.deleteMany({ where: { id: { in: communityPostIds } } });
  }

  if (postIds.length) {
    await prisma.comment.deleteMany({ where: { postId: { in: postIds } } });
    await prisma.post.deleteMany({ where: { id: { in: postIds } } });
  }

  await prisma.notification.deleteMany({ where: { locationId: { in: oldLocationIds } } });
  await prisma.emergencyRequest.deleteMany({ where: { locationId: { in: oldLocationIds } } });
  await prisma.broadcast.deleteMany({ where: { locationId: { in: oldLocationIds } } });
  await prisma.community.updateMany({
    where: { locationId: { in: oldLocationIds } },
    data: { locationId: null },
  });

  if (memberIds.length) {
    await prisma.member.deleteMany({ where: { id: { in: memberIds } } });
  }
  if (userIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  const locationsToDelete = [...oldLocationIds].sort((a, b) => b - a);
  for (const locationId of locationsToDelete) {
    await prisma.location.deleteMany({ where: { id: locationId } });
  }

  const tamilTownCount = await prisma.location.count({
    where: { parentId: tamilTaluk.id, type: 'AREA' },
  });
  const tamilTownIds = (
    await prisma.location.findMany({
      where: { parentId: tamilTaluk.id, type: 'AREA' },
      select: { id: true },
    })
  ).map((town) => town.id);
  const tamilStreetCount = await prisma.location.count({
    where: { parentId: { in: tamilTownIds }, type: 'STREET' },
  });

  console.log(
    JSON.stringify(
      {
        movedTo: {
          district: tamilDistrict.name,
          districtId: tamilDistrict.id,
          taluk: tamilTaluk.name,
          talukId: tamilTaluk.id,
        },
        deletedOldLocationIds: oldLocationIds,
        deletedUsers: userIds.length,
        deletedMembers: memberIds.length,
        finalTamilTownCount: tamilTownCount,
        finalTamilStreetCount: tamilStreetCount,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
