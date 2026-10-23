import { Router } from 'express';
import { prisma } from '../db';

const router = Router();

router.get('/', async (_req, res) => {
  const doctors = await prisma.doctor.findMany({ orderBy: { name: 'asc' } });
  res.json(doctors);
});

router.get('/:id', async (req, res) => {
  const doctor = await prisma.doctor.findUnique({ where: { id: req.params.id } });
  if (!doctor) return res.status(404).json({ error: 'Läkaren hittades inte' });
  res.json(doctor);
});

router.post('/', async (req, res) => {
  try {
    const doctor = await prisma.doctor.create({ data: req.body });
    res.status(201).json(doctor);
  } catch (err) {
    res.status(400).json({ error: 'Kunde inte skapa läkare', details: String(err) });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const doctor = await prisma.doctor.update({ where: { id: req.params.id }, data: req.body });
    res.json(doctor);
  } catch (err) {
    res.status(400).json({ error: 'Kunde inte uppdatera läkare', details: String(err) });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await prisma.doctor.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: 'Kunde inte ta bort läkare', details: String(err) });
  }
});

export default router;
