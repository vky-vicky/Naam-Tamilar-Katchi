import prisma from '../src/db.js';
import { resolvers } from '../src/schema/resolvers.js';

async function testFlow() {
  console.log('--- STARTING NOTIFICATION DELETE FLOW TEST ---');

  // 1. Fetch a User and a Member to test with
  const testUser = await (prisma as any).user.findFirst({
    where: { isActive: true, locationId: { not: null } }
  });
  const testMember = await (prisma as any).member.findFirst({
    where: { isActive: true }
  });

  if (!testUser || !testMember) {
    console.error('Could not find a test user or member in the database. Run seed script first.');
    return;
  }

  console.log(`Using test Admin User: ${testUser.name} (ID: ${testUser.id}, Location: ${testUser.locationId})`);
  console.log(`Using test Member: ${testMember.name} (ID: ${testMember.id}, Location: ${testMember.locationId})`);

  // Use the admin user's location for the notification
  const locationId = testUser.locationId;

  // 2. Create a test notification
  const notification = await (prisma as any).notification.create({
    data: {
      title: 'Test Notification for User-Specific Delete',
      message: 'This is a test notification',
      type: 'ALERT',
      locationId: locationId,
      status: 'ACTIVE'
    }
  });
  console.log(`Created test notification with ID: ${notification.id} at location: ${locationId}`);

  // Create mock contexts
  // Admin User Context (type: admin)
  const contextUserAdmin = {
    user: {
      id: testUser.id,
      role: testUser.role,
      locationId: testUser.locationId,
      type: 'admin'
    },
    language: 'en'
  };

  // Regular Member Context (type: member)
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
    // 3. Test that BOTH user and member see the notification in notifications query
    console.log('\n--- Fetching notifications for Admin User ---');
    let adminNotifs = await resolvers.Query.notifications(null, { locationId }, contextUserAdmin);
    let foundInAdmin = adminNotifs.some((n: any) => n.id === notification.id);
    console.log(`Found in Admin's notifications list? ${foundInAdmin} (Expected: true)`);
    if (!foundInAdmin) throw new Error('Test notification not found in Admin notifications list');

    console.log('\n--- Fetching notifications for Member ---');
    // For Member, they see notifications from their ancestor locations. Let's make sure it's in their ancestor/descendant list.
    // We pass locationId of the user. If they can't access it, let's test with their own location notifications.
    let memberNotifs = await resolvers.Query.notifications(null, { locationId: testMember.locationId }, contextMember);
    // Let's modify the notification locationId to be the member's locationId so we are sure they see it
    await (prisma as any).notification.update({
      where: { id: notification.id },
      data: { locationId: testMember.locationId }
    });
    console.log(`Updated notification location to match member's location: ${testMember.locationId}`);

    // Re-fetch
    adminNotifs = await resolvers.Query.notifications(null, { locationId: testMember.locationId }, contextUserAdmin);
    memberNotifs = await resolvers.Query.notifications(null, { locationId: testMember.locationId }, contextMember);
    
    foundInAdmin = adminNotifs.some((n: any) => n.id === notification.id);
    let foundInMember = memberNotifs.some((n: any) => n.id === notification.id);
    console.log(`Found in Admin's notifications list? ${foundInAdmin} (Expected: true)`);
    console.log(`Found in Member's notifications list? ${foundInMember} (Expected: true)`);
    if (!foundInAdmin || !foundInMember) throw new Error('Notification must be visible to both before delete');

    // Test getNotificationDetails
    let detailsAdmin = await resolvers.Query.getNotificationDetails(null, { id: notification.id }, contextUserAdmin);
    let detailsMember = await resolvers.Query.getNotificationDetails(null, { id: notification.id }, contextMember);
    console.log(`Get details for Admin succeeded? ${detailsAdmin !== null} (Expected: true)`);
    console.log(`Get details for Member succeeded? ${detailsMember !== null} (Expected: true)`);
    if (!detailsAdmin || !detailsMember) throw new Error('Notification details must be accessible');

    // 4. Admin deletes the notification
    console.log('\n--- Admin User Deleting Notification ---');
    const deleteResultAdmin = await resolvers.Mutation.deleteNotification(null, { id: notification.id }, contextUserAdmin);
    console.log(`Admin delete call returned: ${deleteResultAdmin} (Expected: true)`);

    // 5. Verify it is removed for Admin but still visible to Member
    adminNotifs = await resolvers.Query.notifications(null, { locationId: testMember.locationId }, contextUserAdmin);
    memberNotifs = await resolvers.Query.notifications(null, { locationId: testMember.locationId }, contextMember);

    foundInAdmin = adminNotifs.some((n: any) => n.id === notification.id);
    foundInMember = memberNotifs.some((n: any) => n.id === notification.id);
    console.log(`Found in Admin's notifications list after Admin delete? ${foundInAdmin} (Expected: false)`);
    console.log(`Found in Member's notifications list after Admin delete? ${foundInMember} (Expected: true)`);
    if (foundInAdmin) throw new Error('Notification should have been deleted for Admin');
    if (!foundInMember) throw new Error('Notification should still exist for Member');

    // Verify details for Admin is null, but for Member is still available
    detailsAdmin = await resolvers.Query.getNotificationDetails(null, { id: notification.id }, contextUserAdmin);
    detailsMember = await resolvers.Query.getNotificationDetails(null, { id: notification.id }, contextMember);
    console.log(`Get details for Admin after delete: ${detailsAdmin} (Expected: null)`);
    console.log(`Get details for Member after Admin delete: ${detailsMember !== null} (Expected: true)`);
    if (detailsAdmin !== null) throw new Error('Admin details should be null');
    if (!detailsMember) throw new Error('Member details should still be available');

    // 6. Member deletes the notification
    console.log('\n--- Member Deleting Notification ---');
    const deleteResultMember = await resolvers.Mutation.deleteNotification(null, { id: notification.id }, contextMember);
    console.log(`Member delete call returned: ${deleteResultMember} (Expected: true)`);

    // 7. Verify it is removed for Member as well
    memberNotifs = await resolvers.Query.notifications(null, { locationId: testMember.locationId }, contextMember);
    foundInMember = memberNotifs.some((n: any) => n.id === notification.id);
    console.log(`Found in Member's notifications list after Member delete? ${foundInMember} (Expected: false)`);
    if (foundInMember) throw new Error('Notification should have been deleted for Member');

    // Verify details for Member is null
    detailsMember = await resolvers.Query.getNotificationDetails(null, { id: notification.id }, contextMember);
    console.log(`Get details for Member after delete: ${detailsMember} (Expected: null)`);
    if (detailsMember !== null) throw new Error('Member details should be null');

    // 8. Verify the notification record itself STILL exists in the global notification table!
    const globalNotif = await (prisma as any).notification.findUnique({
      where: { id: notification.id }
    });
    console.log(`Does global notification record still exist? ${globalNotif !== null} (Expected: true)`);
    if (!globalNotif) throw new Error('Global notification should not have been deleted');

    console.log('\n--- ALL VERIFICATIONS PASSED SUCCESSFULLY! ---');
  } finally {
    // Clean up test data
    console.log('\n--- Cleaning up test data ---');
    await (prisma as any).deletedNotification.deleteMany({
      where: { notificationId: notification.id }
    });
    await (prisma as any).notification.delete({
      where: { id: notification.id }
    });
    console.log('Cleanup completed.');
  }
}

testFlow()
  .catch(err => {
    console.error('Test failed with error:', err);
  })
  .finally(() => prisma.$disconnect());
