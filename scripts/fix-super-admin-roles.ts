import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function fixSuperAdminRoles() {
  console.log('Connecting to database...');
  
  // SUPER_ADMIN users-ஐ find செய்
  const superAdmins = await (prisma as any).user.findMany({
    where: { role: 'SUPER_ADMIN' }
  });
  
  console.log('Found SUPER_ADMIN users:', superAdmins.length);
  
  for (const sa of superAdmins) {
    console.log('Processing:', sa.name, sa.phone);
    
    // Member table-ல் same phone number record-ஐ SUPER_ADMIN ஆக update செய்
    const member = await (prisma as any).member.findUnique({ where: { phone: sa.phone } });
    if (member) {
      if (member.role !== 'SUPER_ADMIN') {
        await (prisma as any).member.update({
          where: { phone: sa.phone },
          data: { role: 'SUPER_ADMIN' }
        });
        console.log('✅ Updated member role from', member.role, 'to SUPER_ADMIN for:', sa.name);
      } else {
        console.log('ℹ️  Member already has SUPER_ADMIN role for:', sa.name);
      }
    } else {
      console.log('ℹ️  No member record found for:', sa.name);
    }
  }
  
  await prisma.$disconnect();
  await pool.end();
  console.log('✅ Done!');
}

fixSuperAdminRoles().catch(console.error);
