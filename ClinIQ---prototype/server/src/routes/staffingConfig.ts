import { Router } from 'express';
import { prisma } from '../db';

const router = Router();
const SINGLETON_ID = 'singleton';

router.get('/', async (_req, res) => {
  const config = await prisma.staffingConfig.findUnique({
    where: { id: SINGLETON_ID },
    include: { recurringTasks: true, deviations: true },
  });
  if (!config) return res.status(404).json({ error: 'Ingen bemanningskonfiguration hittad - kör seed-scriptet.' });
  res.json(config);
});

// PUT /api/staffing-config - ersätter HELA konfigurationen (grundkrav, ägarmöte,
// återkommande uppgifter och avvikelser) i en transaktion. Appen sparar så eftersom
// konfigurationen ändras på många ställen i gränssnittet. Skapar raden om den saknas.
router.put('/', async (req, res) => {
  const { recurringTasks = [], deviations = [], id: _ignored, ...base } = req.body;
  try {
    await prisma.$transaction([
      prisma.staffingConfig.upsert({
        where: { id: SINGLETON_ID },
        update: base,
        create: { ...base, id: SINGLETON_ID },
      }),
      prisma.recurringTask.deleteMany({ where: { staffingConfigId: SINGLETON_ID } }),
      prisma.recurringTask.createMany({
        data: recurringTasks.map((t: any) => ({ ...t, staffingConfigId: SINGLETON_ID })),
      }),
      prisma.staffingDeviation.deleteMany({ where: { staffingConfigId: SINGLETON_ID } }),
      prisma.staffingDeviation.createMany({
        data: deviations.map((d: any) => ({
          ...d,
          startDate: new Date(d.startDate),
          endDate: new Date(d.endDate),
          staffingConfigId: SINGLETON_ID,
        })),
      }),
    ]);
    const config = await prisma.staffingConfig.findUnique({
      where: { id: SINGLETON_ID },
      include: { recurringTasks: true, deviations: true },
    });
    res.json(config);
  } catch (err) {
    res.status(400).json({ error: 'Kunde inte spara konfigurationen', details: String(err) });
  }
});

router.post('/recurring-tasks', async (req, res) => {
  try {
    const task = await prisma.recurringTask.create({ data: { ...req.body, staffingConfigId: SINGLETON_ID } });
    res.status(201).json(task);
  } catch (err) {
    res.status(400).json({ error: 'Kunde inte skapa återkommande uppgift', details: String(err) });
  }
});

router.put('/recurring-tasks/:id', async (req, res) => {
  try {
    const task = await prisma.recurringTask.update({ where: { id: req.params.id }, data: req.body });
    res.json(task);
  } catch (err) {
    res.status(400).json({ error: 'Kunde inte uppdatera uppgift', details: String(err) });
  }
});

router.delete('/recurring-tasks/:id', async (req, res) => {
  try {
    await prisma.recurringTask.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: 'Kunde inte ta bort uppgift', details: String(err) });
  }
});

router.post('/deviations', async (req, res) => {
  try {
    const deviation = await prisma.staffingDeviation.create({ data: { ...req.body, startDate: new Date(req.body.startDate), endDate: new Date(req.body.endDate), staffingConfigId: SINGLETON_ID } });
    res.status(201).json(deviation);
  } catch (err) {
    res.status(400).json({ error: 'Kunde inte skapa avvikelse', details: String(err) });
  }
});

router.put('/deviations/:id', async (req, res) => {
  try {
    const { startDate, endDate, ...rest } = req.body;
    const deviation = await prisma.staffingDeviation.update({
      where: { id: req.params.id },
      data: { ...rest, ...(startDate && { startDate: new Date(startDate) }), ...(endDate && { endDate: new Date(endDate) }) },
    });
    res.json(deviation);
  } catch (err) {
    res.status(400).json({ error: 'Kunde inte uppdatera avvikelse', details: String(err) });
  }
});

router.delete('/deviations/:id', async (req, res) => {
  try {
    await prisma.staffingDeviation.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: 'Kunde inte ta bort avvikelse', details: String(err) });
  }
});

export default router;
