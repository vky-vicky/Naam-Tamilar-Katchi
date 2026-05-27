// Backfill CommunityPost titles that are null
// Run this script with `node scripts/backfillCommunityPostTitles.cjs`
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const placeholder = 'Untitled';
  const result = await prisma.communityPost.updateMany({
    where: { title: null },
    data: { title: placeholder }
  });
  console.log(`Updated ${result.count} CommunityPost records with placeholder title.`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
