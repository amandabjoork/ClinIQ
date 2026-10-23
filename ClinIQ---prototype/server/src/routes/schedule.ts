import { Router } from 'express';
import { prisma } from '../db';

const router = Router();

router.get('/', async (req, res) => {
  const { from, to } = req.query as Record<string, string | undefined>;
  const schedule = await prisma.scheduleAssignment.findMany({
    where: from || to ? { date: { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined } } : undefined,
    include: { doctor: true },
    orderBy: [{ date: 'asc' }, { period: 'asc' }],
  });
  res.json(schedule);
});

// POST /api/schedule/bulk - ersätt schemat för ett datumintervall
// Body: { from: string, to: string, assignments: ScheduleAssignment[] }
router.post('/bulk', async (req, res) => {
  const { from, to, assignments } = req.body as {
    from: string;
    to: string;
    assignments: Array<{
      date: string; period: 'FM' | 'EM'; shift: string; assignedDoctorId: string | null;
      aiExplanation: string; scoreSnapshot: number; isManual?: boolean; taskName?: string | null;
    }>;
  };

  try {
    await prisma.$transaction([
      prisma.scheduleAssignment.deleteMany({ where: { date: { gte: new Date(from), lte: new Date(to) } } }),
      prisma.scheduleAssignment.createMany({
        data: assignments.map(a => ({
          date: new Date(a.date),
          period: a.period as any,
          shift: a.shift as any,
          assignedDoctorId: a.assignedDoctorId === 'N/A' ? null : a.assignedDoctorId,
          aiExplanation: a.aiExplanation,
          scoreSnapshot: a.scoreSnapshot,
          isManual: a.isManual ?? false,
          taskName: a.taskName ?? null,
        })),
      }),
    ]);
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: 'Kunde inte spara schemat', details: String(err) });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const assignment = await prisma.scheduleAssignment.update({
      where: { id: req.params.id },
      data: { ...req.body, isManual: true },
    });
    res.json(assignment);
  } catch (err) {
    res.status(400).json({ error: 'Kunde inte uppdatera passet', details: String(err) });
  }
});

export default router;
