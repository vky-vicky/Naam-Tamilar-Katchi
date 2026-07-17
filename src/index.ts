import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import express from 'express';
import http from 'http';
import cors from 'cors';
import { typeDefs } from './schema/typeDefs.js';
import { resolvers } from './schema/resolvers.js';
import * as dotenv from 'dotenv';
import { Server } from 'socket.io';
import prisma from './db.js';
import { CronService } from './services/cron.service.js';

dotenv.config();

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);

  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    console.log('🔌 Client connected to Socket.io:', socket.id);
    socket.on('joinCommunityChat', (communityId: number | string) => {
      if (!communityId) return;
      socket.join(`community:${communityId}`);
    });

    socket.on('leaveCommunityChat', (communityId: number | string) => {
      if (!communityId) return;
      socket.leave(`community:${communityId}`);
    });

    socket.on('communityTyping', (payload: { communityId?: number | string; userId?: number | string; userName?: string }) => {
      if (!payload?.communityId) return;
      socket.to(`community:${payload.communityId}`).emit('communityTyping', payload);
    });

    socket.on('communityStopTyping', (payload: { communityId?: number | string; userId?: number | string; userName?: string }) => {
      if (!payload?.communityId) return;
      socket.to(`community:${payload.communityId}`).emit('communityStopTyping', payload);
    });

    socket.on('disconnect', () => {
      console.log('🔌 Client disconnected from Socket.io:', socket.id);
    });
  });

  (global as any).io = io;

  const server = new ApolloServer({
    typeDefs,
    resolvers,
    introspection: true,
    plugins: [
      ApolloServerPluginDrainHttpServer({ httpServer }),
      ApolloServerPluginLandingPageLocalDefault({ embed: true }),
    ],
  });

  await server.start();

  // Razorpay Webhook REST Endpoint
  app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), async (req: express.Request, res: express.Response) => {
    const signature = req.headers['x-razorpay-signature'] as string;
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'webhook_secret_mock';

    if (!signature) {
      return res.status(400).json({ error: 'Signature header missing' });
    }

    try {
      const crypto = await import('crypto');
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(req.body)
        .digest('hex');

      if (expectedSignature !== signature) {
        return res.status(400).json({ error: 'Invalid webhook signature' });
      }

      const payload = JSON.parse(req.body.toString());

      // Replay protection (5 minutes window)
      const webhookTimestamp = payload.created_at; // unix timestamp in seconds
      if (webhookTimestamp) {
        const currentTimestamp = Math.floor(Date.now() / 1000);
        if (Math.abs(currentTimestamp - webhookTimestamp) > 5 * 60) {
          console.warn(`[Webhook] Rejected due to timestamp replay protection. Payload TS: ${webhookTimestamp}, Current TS: ${currentTimestamp}`);
          return res.status(400).json({ error: 'Webhook timestamp is outside of the allowed 5-minute window' });
        }
      }

      const event = payload.event;
      const paymentEntity = payload.payload?.payment?.entity;

      if (!paymentEntity) {
        return res.status(400).json({ error: 'Invalid payload structure' });
      }

      const orderId = paymentEntity.order_id;
      const paymentId = paymentEntity.id;
      const amount = paymentEntity.amount / 100; // in Rupees

      // Request logging
      console.log(`[Webhook] Received ${event} for Order: ${orderId}, Payment ID: ${paymentId}`);

      if (event === 'payment.captured' || event === 'payment.failed') {
        const paymentRecord = await (prisma as any).contributionPayment.findFirst({
          where: { orderId }
        });

        if (!paymentRecord) {
          return res.status(404).json({ error: 'Matching payment record not found' });
        }

        // Idempotency check
        if (paymentRecord.status === 'PAID') {
          return res.status(200).json({ message: 'Payment already processed' });
        }

        if (event === 'payment.captured') {
          // Double payment check
          const doublePay = await (prisma as any).contributionPayment.findFirst({
            where: {
              memberId: paymentRecord.memberId,
              month: paymentRecord.month,
              year: paymentRecord.year,
              status: 'PAID',
              id: { not: paymentRecord.id }
            }
          });

          if (doublePay) {
            return res.status(400).json({ error: 'Same month payment already completed' });
          }

          const now = new Date();
          const receiptNo = `NTK-${now.getFullYear()}-${paymentRecord.id.toString().padStart(6, '0')}`;

          const updated = await (prisma as any).contributionPayment.update({
            where: { id: paymentRecord.id },
            data: {
              status: 'PAID',
              transactionId: paymentId,
              paidAt: now,
              receiptNumber: receiptNo,
              paymentMethod: 'ONLINE'
            }
          });

          // Write webhook confirmation to AuditLog
          await (prisma as any).auditLog.create({
            data: {
              action: 'PAYMENT_WEBHOOK_SUCCESS',
              details: `Webhook payment.captured. Member: ${paymentRecord.memberId}, Amount: ${amount}, Receipt: ${receiptNo}`
            }
          }).catch(console.error);

          // Update Streak and Badge
          const { ContributionService } = await import('./services/contribution.service.js');
          await ContributionService.updateContributionProfile(paymentRecord.memberId).catch((err: any) =>
            console.error('[Webhook] Streak recalculation error:', err)
          );
        } else if (event === 'payment.failed') {
          await (prisma as any).contributionPayment.update({
            where: { id: paymentRecord.id },
            data: {
              status: 'FAILED',
              failureReason: paymentEntity.error_description || 'Razorpay payment failed'
            }
          });

          await (prisma as any).auditLog.create({
            data: {
              action: 'PAYMENT_WEBHOOK_FAILED',
              details: `Webhook payment.failed. Member: ${paymentRecord.memberId}, Order: ${orderId}, Reason: ${paymentEntity.error_description || 'unknown'}`
            }
          }).catch(console.error);
        }
      }

      return res.status(200).json({ status: 'ok' });
    } catch (error: any) {
      console.error('[Webhook Error]', error);
      return res.status(500).json({ error: 'Webhook processing error', details: error.message });
    }
  });

  app.get('/api/export/payments', async (req: express.Request, res: express.Response) => {
    try {
      const { district, month, year } = req.query;
      let locationIds: number[] = [];

      if (district && typeof district === 'string') {
        const loc = await (prisma as any).location.findFirst({
          where: { name: { equals: district, mode: 'insensitive' }, type: 'DISTRICT' },
          select: { id: true }
        });
        if (loc) {
          const { getChildLocationIdsForFCM } = await import('./services/fcm.service.js');
          const children = await getChildLocationIdsForFCM(loc.id);
          locationIds = [loc.id, ...children];
        }
      }

      const where: any = {};
      if (locationIds.length > 0) {
        where.member = { locationId: { in: locationIds } };
      }
      if (month) where.month = parseInt(month as string, 10);
      if (year) where.year = parseInt(year as string, 10);

      const payments = await (prisma as any).contributionPayment.findMany({
        where,
        include: {
          member: {
            select: { name: true, phoneNumber: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 5000
      });

      const csvRows = ['Receipt Number,Member Name,Phone Number,Month,Year,Amount,Status,Payment Date'];
      for (const p of payments) {
        csvRows.push(`${p.receiptNumber || 'N/A'},${p.member?.name || 'N/A'},${p.member?.phoneNumber || 'N/A'},${p.month},${p.year},${p.amount},${p.status},${p.paidAt ? p.paidAt.toISOString() : 'N/A'}`);
      }

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="payments_export.csv"');
      return res.status(200).send(csvRows.join('\n'));
    } catch (err: any) {
      console.error('[Export Error]', err);
      return res.status(500).json({ error: 'Export failed' });
    }
  });

  app.use(
    '/graphql',
    cors<cors.CorsRequest>(),
    express.json({ limit: '50mb' }),
    expressMiddleware(server, {
      context: async ({ req }) => {
        const language = req.headers['accept-language'] || 'en';
        const authHeader = req.headers.authorization;
        
        let contextUser: any = null;

        if (authHeader && authHeader.startsWith('Bearer ')) {
          const rawToken = authHeader.substring(7).trim();
          let token = rawToken;

          try {
            const decoded = Buffer.from(rawToken, 'base64').toString('utf8');
            if (decoded.includes(':')) {
              token = decoded;
            }
          } catch (e) {
            // Keep raw token for fallback
          }
          
          try {
            if (token.includes(':')) {
              const [roleToken, idStr, type] = token.split(':');
              const id = parseInt(idStr || '', 10);
              
              if (!isNaN(id)) {
                let dbUser = null;
                if (type === 'admin') {
                  dbUser = await (prisma as any).user.findUnique({ where: { id } });
                } else if (type === 'member') {
                  dbUser = await (prisma as any).member.findUnique({ where: { id } });
                }
                
                if (dbUser) {
                  contextUser = {
                    id: dbUser.id,
                    role: dbUser.role === 'Member' ? 'MEMBER' : dbUser.role,
                    locationId: dbUser.locationId || null,
                    type: type // 'admin' or 'member'
                  };
                } else {
                  // Token exists but DB record not found (e.g., after DB reset)
                  // Set session_expired so resolvers can return proper error
                  contextUser = { id: null, role: null, type: null, session_expired: true };
                }
              }
            } else if (token) {
              // Fallback for simple tokens like "sub_admin_token"
              const rolePart = token.replace('_token', '').toUpperCase();
              
              if (rolePart === 'MEMBER') {
                const dbMember = await (prisma as any).member.findFirst({
                  where: { role: 'Member' }
                });
                if (dbMember) {
                  contextUser = {
                    id: dbMember.id,
                    role: 'MEMBER',
                    locationId: dbMember.locationId || null,
                    type: 'member'
                  };
                }
              } else {
                // SUPER_ADMIN, ADMIN, SUB_ADMIN
                const dbUser = await (prisma as any).user.findFirst({
                  where: { role: rolePart }
                });
                if (dbUser) {
                  contextUser = {
                    id: dbUser.id,
                    role: dbUser.role,
                    locationId: dbUser.locationId || null,
                    type: 'admin'
                  };
                }
              }
            }
          } catch (err) {
            console.error('Error resolving dynamic auth context:', err);
          }
        }

        return { 
          user: contextUser,
          language
        };
      },
    })
  );

  const PORT = process.env.PORT || 4000;
  await new Promise<void>((resolve) => httpServer.listen({ port: PORT }, resolve));
  console.log(`🚀 Server ready at http://localhost:${PORT}/graphql`);
  CronService.startBillingScheduler();
}

startServer().catch((error) => {
  console.error('Error starting server:', error);
});
