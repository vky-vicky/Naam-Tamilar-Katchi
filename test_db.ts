import prisma from './src/db';
async function main() {
  try {
    await prisma.$connect();
    console.log('Connection successful');
    const userLocationCount = await prisma.userLocation.count();
    console.log('UserLocation count:', userLocationCount);
    const requestCount = await prisma.locationAccessRequest.count();
    console.log('LocationAccessRequest count:', requestCount);
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
