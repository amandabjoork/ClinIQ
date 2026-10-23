import { Router } from 'express';
import { prisma } from '../db';

const router = Router();

// GET /api/requirements?from=2026-09-01&to=2026-09-30
router.get('/', async (req, res) => {
  const { from, to } = req.query as Record<string, string | undefined>;
  const requirements = await prisma.dailyRequirement.findMany({
    where: from || to ? { date: { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined } } : undefined,
    orderBy: { date: 'asc' },
  });
  res.json(requirements);
});

// PUT /api/requirements/:date - admin ändrar ett enskilt dygns krav (YYYY-MM-DD)
router.put('/:date', async (req, res) => {
  const date = new Date(req.params.date);
  if (isNaN(date.getTime())) return res.status(400).json({ error: 'Ogiltigt datum, förväntar YYYY-MM-DD' });

  const { minStaff, requiredShifts } = req.body as { minStaff: number; requiredShifts: Record<string, number> };
  try {
    const requirement = await prisma.dailyRequirement.upsert({
      where: { date },
      update: { minStaff, requiredShifts },
      create: { date, minStaff, requiredShifts },
    });
    res.json(requirement);
  } catch (err) {
    res.status(400).json({ error: 'Kunde inte uppdatera kravet', details: String(err) });
  }
});

// POST /api/requirements/bulk - fyll på krav för ett datumintervall i ett svep
router.post('/bulk', async (req, res) => {
  const items = req.body as Array<{ date: string; minStaff: number; requiredShifts: Record<string, number> }>;
  try {
    await prisma.$transaction(
      items.map(item =>
        prisma.dailyRequirement.upsert({
          where: { date: new Date(item.date) },
          update: { minStaff: item.minStaff, requiredShifts: item.requiredShifts },
          create: { date: new Date(item.date), minStaff: item.minStaff, requiredShifts: item.requiredShifts },
        })
      )
    );
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: 'Kunde inte spara kraven', details: String(err) });
  }
});

export default router;
