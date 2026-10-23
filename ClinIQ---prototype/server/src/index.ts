import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import doctorsRouter from './routes/doctors';
import leaveRequestsRouter from './routes/leaveRequests';
import staffingConfigRouter from './routes/staffingConfig';
import requirementsRouter from './routes/requirements';
import scheduleRouter from './routes/schedule';

const app = express();
app.use(cors());
// Ett helt genererat schema är flera hundra kB, så standardgränsen (100 kB) räcker inte.
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/doctors', doctorsRouter);
app.use('/api/leave-requests', leaveRequestsRouter);
app.use('/api/staffing-config', staffingConfigRouter);
app.use('/api/requirements', requirementsRouter);
app.use('/api/schedule', scheduleRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(port, () => {
  console.log(`ClinIQ API lyssnar på http://localhost:${port}`);
});
