import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import express from 'express';
import http from 'http';
import cors from 'cors';
import { typeDefs } from './schema/typeDefs.js';
import { resolvers } from './schema/resolvers.js';
import * as dotenv from 'dotenv';
import { Server } from 'socket.io';

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
    socket.on('disconnect', () => {
      console.log('🔌 Client disconnected from Socket.io:', socket.id);
    });
  });

  (global as any).io = io;

  const server = new ApolloServer({
    typeDefs,
    resolvers,
    plugins: [ApolloServerPluginDrainHttpServer({ httpServer })],
  });

  await server.start();

  app.use(
    '/graphql',
    cors<cors.CorsRequest>(),
    express.json(),
    expressMiddleware(server, {
      context: async ({ req }) => {
        // Simple auth simulation - in real app, decode JWT here
        const language = req.headers['accept-language'] || 'en';
        return { 
          user: { 
            id: 1, 
            role: 'SUPER_ADMIN', // Simulated role for testing
            locationId: null 
          },
          language
        };
      },
    })
  );

  const PORT = process.env.PORT || 4000;
  await new Promise<void>((resolve) => httpServer.listen({ port: PORT }, resolve));
  console.log(`🚀 Server ready at http://localhost:${PORT}/graphql`);
}

startServer().catch((error) => {
  console.error('Error starting server:', error);
});
