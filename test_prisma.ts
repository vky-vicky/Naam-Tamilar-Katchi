import prisma from './src/db.js';

async function test() {
  try {
    const data = await prisma.contributionPayment.findMany({ take: 1 });
    console.log('Success');
  } catch(e: any) {
    console.error('Prisma Error:', e.message);
  } finally {
    process.exit(0);
  }
}
test();
