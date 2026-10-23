import { PrismaClient } from '@prisma/client';

// En delad Prisma-klient för hela serverprocessen.
// (Att skapa en ny PrismaClient per request skulle göra slut på databasanslutningar.)
export const prisma = new PrismaClient();
