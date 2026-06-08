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

  app.use(
    '/graphql',
    cors<cors.CorsRequest>(),
    express.json(),
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
