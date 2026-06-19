import prisma from '../src/db.js';
import { resolvers } from '../src/schema/resolvers.js';

async function runTest() {
  console.log('--- STARTING USER CONTENT VISIBILITY FLOW TEST ---');

  // Find a test Member and User
  const testMember = await (prisma as any).member.findFirst({
    where: { isActive: true }
  });
  const testUser = await (prisma as any).user.findFirst({
    where: { isActive: true, locationId: { not: null } }
  });

  if (!testMember || !testUser) {
    console.error('Could not find test member or user. Seed database first.');
    return;
  }

  // Set the member's createdAt to precisely 2 hours ago
  const memberRegTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await (prisma as any).member.update({
    where: { id: testMember.id },
    data: { createdAt: memberRegTime }
  });
  console.log(`Configured test member registration time: ${memberRegTime.toISOString()}`);

  const locationId = testMember.locationId;

  // Create test data:
  // 1. Old notification (created 3 hours ago - before registration)
  const oldNotification = await (prisma as any).notification.create({
    data: {
      title: 'Old Notification',
      message: 'Created before user registration',
      type: 'ALERT',
      locationId: locationId,
      createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000)
    }
  });

  // 2. New notification (created 1 hour ago - after registration)
  const newNotification = await (prisma as any).notification.create({
    data: {
      title: 'New Notification',
      message: 'Created after user registration',
      type: 'ALERT',
      locationId: locationId,
      createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000)
    }
  });

  // 3. Events: Completed, Expired, Active
  const activeEvent = await (prisma as any).event.create({
    data: {
      title: 'Active Event',
      description: 'Active event details',
      date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 days future
      status: 'ACTIVE',
      locationId: locationId,
      createdById: testUser.id
    }
  });

  const completedEvent = await (prisma as any).event.create({
    data: {
      title: 'Completed Event',
      description: 'Completed event details',
      date: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
      status: 'COMPLETED',
      locationId: locationId,
      createdById: testUser.id
    }
  });

  const expiredEvent = await (prisma as any).event.create({
    data: {
      title: 'Expired Event',
      description: 'Expired event details',
      date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days past
      status: 'ACTIVE',
      locationId: locationId,
      createdById: testUser.id
    }
  });

  // 4. Emergency Requests: Live vs Completed
  const liveEmergency = await (prisma as any).emergencyRequest.create({
    data: {
      title: 'Live Emergency',
      hospitalName: 'Apollo Hospital',
      patientCondition: 'Critical',
      status: 'APPROVED_STATE',
      locationId: locationId
    }
  });

  const completedEmergency = await (prisma as any).emergencyRequest.create({
    data: {
      title: 'Completed Emergency',
      hospitalName: 'Kauvery Hospital',
      patientCondition: 'Recovered',
      status: 'COMPLETED',
      locationId: locationId
    }
  });

  // 5. Broadcasts: Active vs Inactive
  const activeBroadcast = await (prisma as any).broadcast.create({
    data: {
      title: 'Active Broadcast',
      message: 'Active broadcast message',
      scope: 'AREA',
      isActive: true,
      locationId: locationId,
      createdById: testUser.id
    }
  });

  const inactiveBroadcast = await (prisma as any).broadcast.create({
    data: {
      title: 'Inactive Broadcast',
      message: 'Inactive broadcast message',
      scope: 'AREA',
      isActive: false,
      locationId: locationId,
      createdById: testUser.id
    }
  });

  // Contexts
  const contextMember = {
    user: {
      id: testMember.id,
      role: 'MEMBER',
      locationId: testMember.locationId,
      type: 'member'
    },
    language: 'en'
  };

  try {
    // === NOTIFICATION VISIBILITY TESTS ===
    console.log('\n--- Running Notification Visibility Tests ---');
    const notifications = await resolvers.Query.notifications(null, { locationId }, contextMember);
    const hasOldNotif = notifications.some((n: any) => n.id === oldNotification.id);
    const hasNewNotif = notifications.some((n: any) => n.id === newNotification.id);
    console.log(`Old Notification (pre-reg) returned? ${hasOldNotif} (Expected: false)`);
    console.log(`New Notification (post-reg) returned? ${hasNewNotif} (Expected: true)`);
    if (hasOldNotif) throw new Error('Old notification was returned');
    if (!hasNewNotif) throw new Error('New notification was not returned');

    // Details checks
    const detailsOld = await resolvers.Query.getNotificationDetails(null, { id: oldNotification.id }, contextMember);
    const detailsNew = await resolvers.Query.getNotificationDetails(null, { id: newNotification.id }, contextMember);
    console.log(`Old details accessibility? ${detailsOld !== null} (Expected: false)`);
    console.log(`New details accessibility? ${detailsNew !== null} (Expected: true)`);
    if (detailsOld !== null) throw new Error('Old notification details accessible');
    if (!detailsNew) throw new Error('New notification details not accessible');

    // === EVENT VISIBILITY TESTS ===
    console.log('\n--- Running Event Visibility Tests ---');
    const events = await resolvers.Query.getEventList(null, { locationId }, contextMember);
    const hasActiveEvent = events.some((e: any) => e.id === activeEvent.id);
    const hasCompletedEvent = events.some((e: any) => e.id === completedEvent.id);
    const hasExpiredEvent = events.some((e: any) => e.id === expiredEvent.id);
    console.log(`Active Event returned? ${hasActiveEvent} (Expected: true)`);
    console.log(`Completed Event returned? ${hasCompletedEvent} (Expected: false)`);
    console.log(`Expired Event returned? ${hasExpiredEvent} (Expected: false)`);
    if (!hasActiveEvent) throw new Error('Active event was not returned');
    if (hasCompletedEvent) throw new Error('Completed event was returned');
    if (hasExpiredEvent) throw new Error('Expired event was returned');

    // Explicit completed/expired request check (should return empty list)
    const completedEventsList = await resolvers.Query.getEventList(null, { locationId, status: 'COMPLETED' }, contextMember);
    console.log(`Explicit Completed Events query returned size: ${completedEventsList.length} (Expected: 0)`);
    if (completedEventsList.length > 0) throw new Error('Completed status query returned events');

    // === EMERGENCY VISIBILITY TESTS ===
    console.log('\n--- Running Emergency Visibility Tests ---');
    const emergencies = await resolvers.Query.getEmergencyRequestList(null, { locationId }, contextMember);
    const hasLiveEmergency = emergencies.some((e: any) => e.id === liveEmergency.id);
    const hasCompletedEmergency = emergencies.some((e: any) => e.id === completedEmergency.id);
    console.log(`Live Emergency returned? ${hasLiveEmergency} (Expected: true)`);
    console.log(`Completed Emergency returned? ${hasCompletedEmergency} (Expected: false)`);
    if (!hasLiveEmergency) throw new Error('Live emergency was not returned');
    if (hasCompletedEmergency) throw new Error('Completed emergency was returned');

    // === BROADCAST VISIBILITY TESTS ===
    console.log('\n--- Running Broadcast Visibility Tests ---');
    const broadcasts = await resolvers.Query.getBroadcasts(null, { locationId }, contextMember);
    const hasActiveBroadcast = broadcasts.some((b: any) => b.id === activeBroadcast.id);
    const hasInactiveBroadcast = broadcasts.some((b: any) => b.id === inactiveBroadcast.id);
    console.log(`Active Broadcast returned? ${hasActiveBroadcast} (Expected: true)`);
    console.log(`Inactive Broadcast returned? ${hasInactiveBroadcast} (Expected: false)`);
    if (!hasActiveBroadcast) throw new Error('Active broadcast was not returned');
    if (hasInactiveBroadcast) throw new Error('Inactive broadcast was returned');

    console.log('\n✅ ALL VERIFICATION TESTS PASSED SUCCESSFULLY! ✅');
  } finally {
    console.log('\n--- Cleaning up test records ---');
    await (prisma as any).notification.deleteMany({
      where: { id: { in: [oldNotification.id, newNotification.id] } }
    });
    await (prisma as any).event.deleteMany({
      where: { id: { in: [activeEvent.id, completedEvent.id, expiredEvent.id] } }
    });
    await (prisma as any).emergencyRequest.deleteMany({
      where: { id: { in: [liveEmergency.id, completedEmergency.id] } }
    });
    await (prisma as any).broadcast.deleteMany({
      where: { id: { in: [activeBroadcast.id, inactiveBroadcast.id] } }
    });
    console.log('Cleanup finished.');
  }
}

runTest()
  .catch(e => console.error('Test run failed:', e))
  .finally(() => prisma.$disconnect());
