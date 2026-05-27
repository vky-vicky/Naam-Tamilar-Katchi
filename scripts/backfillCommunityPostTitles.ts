// Script to backfill CommunityPost titles that are null
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function backfillTitles() {
  const posts = await prisma.communityPost.findMany({
    where: { title: null },
    select: { id: true }
  });
  console.log(`Found ${posts.length} posts with null title.`);
  const placeholder = 'Untitled';
  for (const post of posts) {
    await prisma.communityPost.update({
      where: { id: post.id },
      data: { title: placeholder }
    });
    console.log(`Updated post ${post.id} with placeholder title.`);
  }
  console.log('Backfill complete.');
}

backfillTitles()
  .catch(e => {
    console.error('Error during backfill:', e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
