import { Router } from 'express';
import { prisma } from '../db';

const router = Router();

router.get('/', async (req, res) => {
  const { doctorId, status, from, to } = req.query as Record<string, string | undefined>;

  const leaveRequests = await prisma.leaveRequest.findMany({
    where: {
      doctorId: doctorId || undefined,
      status: (status as any) || undefined,
      date: from || to ? { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined } : undefined,
    },
    include: { doctor: true },
    orderBy: { date: 'asc' },
  });
  res.json(leaveRequests);
});

router.post('/', async (req, res) => {
  try {
    const leaveRequest = await prisma.leaveRequest.create({ data: { ...req.body, date: new Date(req.body.date) } });
    res.status(201).json(leaveRequest);
  } catch (err) {
    res.status(400).json({ error: 'Kunde inte skapa ledighetsansökan', details: String(err) });
  }
});

router.patch('/:id/status', async (req, res) => {
  const { status } = req.body as { status: 'PENDING' | 'APPROVED' | 'DENIED' };
  if (!['PENDING', 'APPROVED', 'DENIED'].includes(status)) {
    return res.status(400).json({ error: 'Ogiltig status' });
  }
  try {
    const leaveRequest = await prisma.leaveRequest.update({ where: { id: req.params.id }, data: { status } });
    res.json(leaveRequest);
  } catch (err) {
    res.status(400).json({ error: 'Kunde inte uppdatera status', details: String(err) });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await prisma.leaveRequest.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: 'Kunde inte ta bort ansökan', details: String(err) });
  }
});

export default router;
