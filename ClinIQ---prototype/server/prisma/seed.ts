import 'dotenv/config'; // läs DATABASE_URL från .env (tsx gör inte det automatiskt)
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const STANDARD_SCHEDULE = [
  { dayIndex: 1, start: '08:00', end: '17:00', isOff: false }, // Måndag
  { dayIndex: 2, start: '08:00', end: '17:00', isOff: false }, // Tisdag
  { dayIndex: 3, start: '08:00', end: '17:00', isOff: false }, // Onsdag
  { dayIndex: 4, start: '08:00', end: '17:00', isOff: false }, // Torsdag
  { dayIndex: 5, start: '08:00', end: '17:00', isOff: false }, // Fredag
  { dayIndex: 6, start: '00:00', end: '00:00', isOff: true },  // Lördag
  { dayIndex: 0, start: '00:00', end: '00:00', isOff: true },  // Söndag
];

const FIRST_NAMES = ['Anna', 'Erik', 'Maria', 'Johan', 'Karin', 'Lars', 'Sara', 'Per', 'Emma', 'Mikael', 'Lena', 'Anders', 'Sofia'];
const LAST_NAMES = ['Andersson', 'Johansson', 'Karlsson', 'Nilsson', 'Persson', 'Berg', 'Lindqvist', 'Wallin', 'Åberg', 'Holm', 'Sandberg', 'Fors', 'Ek'];

function name(i: number) {
  return `${FIRST_NAMES[i % FIRST_NAMES.length]} ${LAST_NAMES[(i * 3) % LAST_NAMES.length]}`;
}

async function main() {
  console.log('Rensar gammal data...');
  await prisma.scheduleAssignment.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.recurringTask.deleteMany();
  await prisma.staffingDeviation.deleteMany();
  await prisma.staffingConfig.deleteMany();
  await prisma.dailyRequirement.deleteMany();
  await prisma.user.deleteMany();
  await prisma.doctor.deleteMany();

  console.log('Skapar läkare...');

  const sven = await prisma.doctor.create({
    data: {
      name: 'Sven Svensson', role: 'SPECIALIST',
      competence: ['MOTTAGNING', 'JOUR', 'SABO', 'MEETING'],
      baseSchedule: STANDARD_SCHEDULE, fte: 100, contractPercentage: 100,
      daysSinceLastJour: 5, workingHoursDescription: '08:00 - 17:00', defaultEndTime: '17:00',
      preferences: [],
    },
  });

  const fredrik = await prisma.doctor.create({
    data: {
      name: 'Fredrik Eriksson', role: 'SPECIALIST',
      competence: ['MOTTAGNING', 'BVC', 'MEETING'],
      baseSchedule: STANDARD_SCHEDULE, fte: 100, contractPercentage: 100,
      daysSinceLastJour: 10, workingHoursDescription: '08:00 - 17:00', defaultEndTime: '17:00',
      preferences: [],
    },
  });

  const specialists = [];
  for (let i = 0; i < 7; i++) {
    const endTime = ['16:00', '16:30', '17:00', '17:00', '17:00'][i % 5];
    const schedule = JSON.parse(JSON.stringify(STANDARD_SCHEDULE));
    if (i === 1) schedule[4].end = '12:00'; // en läkare som slutar tidigt på fredagar
    const doc = await prisma.doctor.create({
      data: {
        name: name(i), role: 'SPECIALIST',
        competence: ['MOTTAGNING', 'JOUR', 'ADMIN', 'BVC', 'SABO', 'MEETING'],
        baseSchedule: schedule, fte: 100, contractPercentage: 100,
        accumulatedFatigue: (i * 7) % 50, daysSinceLastJour: (i * 3) % 14,
        workingHoursDescription: `08:00 - ${endTime}`, defaultEndTime: endTime,
        preferences: i % 2 === 0 ? ['Gillar admin på fredagar'] : [],
      },
    });
    specialists.push(doc);
  }

  const sts = [];
  for (let i = 0; i < 4; i++) {
    const doc = await prisma.doctor.create({
      data: {
        name: name(i + 7), role: 'ST',
        competence: ['MOTTAGNING', 'JOUR', 'STUDIES', 'BVC'],
        baseSchedule: JSON.parse(JSON.stringify(STANDARD_SCHEDULE)),
        fte: 100, contractPercentage: 100,
        accumulatedFatigue: (i * 5) % 40, daysSinceLastJour: (i * 2) % 10,
        workingHoursDescription: '08:00 - 17:00', defaultEndTime: '17:00',
        preferences: ['Önskar studietid tisdagar'],
      },
    });
    sts.push(doc);
  }

  const ats = [];
  for (let i = 0; i < 2; i++) {
    const doc = await prisma.doctor.create({
      data: {
        name: name(i + 11), role: 'AT',
        competence: ['MOTTAGNING', 'STUDIES', 'ADMIN'],
        baseSchedule: JSON.parse(JSON.stringify(STANDARD_SCHEDULE)),
        fte: 100, contractPercentage: 100,
        accumulatedFatigue: i * 4, daysSinceLastJour: 99, // AT gör inte jour
        workingHoursDescription: '08:00 - 16:30', defaultEndTime: '16:30',
        preferences: [],
      },
    });
    ats.push(doc);
  }

  console.log('Skapar användarkonton...');
  await prisma.user.create({ data: { name: 'Anna Svensson', role: 'ADMIN' } });
  await prisma.user.create({ data: { name: specialists[2].name, role: 'DOCTOR', doctorId: specialists[2].id } });

  console.log('Skapar bemanningskonfiguration...');
  const config = await prisma.staffingConfig.create({
    data: {
      id: 'singleton',
      maxDoctors: 12, minTotalDaily: 6, minSpecDaily: 3, minTotalLate: 2, minSpecLate: 1,
      ownerMeetingIsActive: true, ownerMeetingName: 'Ägarmöte',
      ownerMeetingRequiredRole: 'SPECIALIST', ownerMeetingRequiredCount: 6,
      ownerMeetingMonths: [0, 2, 4, 8, 10], ownerMeetingDayOfWeek: 1,
      ownerMeetingTimeStart: '09:30', ownerMeetingTimeEnd: '12:30',
      ownerMeetingNotes: 'Kräver 6 specialister. Låst tid, första måndagen i månaden.',
    },
  });

  await prisma.recurringTask.createMany({
    data: [
      { name: 'BVC Mottagning (Tis)', days: ['Tisdag'], assignedDoctorId: fredrik.id, backup1DoctorId: specialists[1].id, staffingConfigId: config.id },
      { name: 'BVC Mottagning (Tor)', days: ['Torsdag'], assignedDoctorId: specialists[2].id, backup1DoctorId: specialists[1].id, staffingConfigId: config.id },
      { name: 'Vallon (SÄBO) Tis', days: ['Tisdag'], staffingConfigId: config.id },
      { name: 'Vallon (SÄBO) Tor', days: ['Torsdag'], assignedDoctorId: specialists[3].id, staffingConfigId: config.id },
      { name: 'Attendo (SÄBO)', days: ['Onsdag'], assignedDoctorId: sven.id, backup1DoctorId: specialists[0].id, backup2Cancel: true, staffingConfigId: config.id },
      { name: 'Murén Rond (SÄBO)', days: ['Onsdag'], assignedDoctorId: specialists[1].id, notes: 'Rondtid, får ej flyttas.', staffingConfigId: config.id },
      { name: 'OM (Ortopedmottagning)', days: ['Torsdag'], assignedDoctorId: specialists[0].id, notes: 'Endast Torsdag FM', staffingConfigId: config.id },
    ],
  });

  await prisma.staffingDeviation.create({
    data: {
      name: 'Julveckan', startDate: new Date('2026-12-21'), endDate: new Date('2026-12-27'),
      maxDoctors: 6, minTotalDaily: 3, minSpecDaily: 1, minTotalLate: 1, minSpecLate: 0,
      staffingConfigId: config.id,
    },
  });

  // Dagskraven (minStaff/Jour osv) skapas av appen själv vid första start och sparas då i databasen.

  console.log(`Klart! Skapade ${2 + specialists.length + sts.length + ats.length} läkare.`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
