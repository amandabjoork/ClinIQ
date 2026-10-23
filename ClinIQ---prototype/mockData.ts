
import { Doctor, DoctorRole, ShiftType, DailyRequirement, StaffingConfig, WorkDayConfig } from './types';

// Helper to generate generic Swedish names
const firstNames = ["Anna", "Erik", "Maria", "Lars", "Karin", "Johan", "Sara", "Per", "Kristina", "Anders", "Lena", "Mikael", "Emma", "Sven", "Fredrik"];
const lastNames = ["Andersson", "Johansson", "Karlsson", "Nilsson", "Eriksson", "Larsson", "Olsson", "Persson", "Svensson", "Gustafsson"];

const generateName = (idx: number) => {
  return `${firstNames[idx % firstNames.length]} ${lastNames[idx % lastNames.length]}`;
};

// Standard Schedule (Mon-Fri 08-17)
const standardSchedule: WorkDayConfig[] = [
    { dayIndex: 1, start: "08:00", end: "17:00", isOff: false }, // Mon
    { dayIndex: 2, start: "08:00", end: "17:00", isOff: false }, // Tue
    { dayIndex: 3, start: "08:00", end: "17:00", isOff: false }, // Wed
    { dayIndex: 4, start: "08:00", end: "17:00", isOff: false }, // Thu
    { dayIndex: 5, start: "08:00", end: "17:00", isOff: false }, // Fri
    { dayIndex: 6, start: "00:00", end: "00:00", isOff: true },  // Sat
    { dayIndex: 0, start: "00:00", end: "00:00", isOff: true },  // Sun
];

// Helper to randomize end times slightly to show UI capabilities
const getRandomEndTime = () => {
    const times = ["16:00", "16:30", "17:00", "17:00", "17:00"]; // Weighted towards 17:00
    return times[Math.floor(Math.random() * times.length)];
};

export const MOCK_DOCTORS: Doctor[] = [
  // Specific Named Doctors for the Requirement Demo
  {
      id: 'doc_sven',
      name: 'Sven Svensson',
      role: DoctorRole.SPECIALIST,
      competence: [ShiftType.MOTTAGNING, ShiftType.JOUR, ShiftType.SABO],
      accumulatedFatigue: 20,
      daysSinceLastJour: 5,
      contractPercentage: 100,
      fte: 100,
      baseSchedule: JSON.parse(JSON.stringify(standardSchedule)),
      workingHoursDescription: "08:00 - 17:00",
      defaultEndTime: "17:00",
      preferences: []
  },
  {
      id: 'doc_franzi',
      name: 'Fredrik Eriksson',
      role: DoctorRole.SPECIALIST,
      competence: [ShiftType.MOTTAGNING, ShiftType.BVC],
      accumulatedFatigue: 15,
      daysSinceLastJour: 10,
      contractPercentage: 100,
      fte: 100,
      baseSchedule: JSON.parse(JSON.stringify(standardSchedule)),
      workingHoursDescription: "08:00 - 17:00",
      defaultEndTime: "17:00",
      preferences: []
  },
  // 7 Specialists
  ...Array.from({ length: 7 }).map((_, i) => {
    const endTime = getRandomEndTime();
    const sched = JSON.parse(JSON.stringify(standardSchedule));
    // Simulate some part-time or diff hours
    if (i === 1) { // One doctor leaves early Fridays
        sched[4].end = "12:00"; 
    }

    return {
        id: `spec_${i + 1}`,
        name: generateName(i),
        role: DoctorRole.SPECIALIST,
        competence: [ShiftType.MOTTAGNING, ShiftType.JOUR, ShiftType.ADMIN, ShiftType.BVC, ShiftType.SABO, ShiftType.MEETING],
        accumulatedFatigue: Math.floor(Math.random() * 50) + 10,
        daysSinceLastJour: Math.floor(Math.random() * 14) + 1,
        contractPercentage: 100,
        fte: 100,
        baseSchedule: sched,
        workingHoursDescription: `08:00 - ${endTime}`,
        defaultEndTime: endTime,
        preferences: ["Gillar admin på fredagar"]
    };
  }),
  // 4 ST
  ...Array.from({ length: 4 }).map((_, i) => ({
    id: `st_${i + 1}`,
    name: generateName(i + 7),
    role: DoctorRole.ST,
    competence: [ShiftType.MOTTAGNING, ShiftType.JOUR, ShiftType.STUDIES, ShiftType.BVC],
    accumulatedFatigue: Math.floor(Math.random() * 40) + 20,
    daysSinceLastJour: Math.floor(Math.random() * 10) + 1,
    contractPercentage: 100,
    fte: 100,
    baseSchedule: JSON.parse(JSON.stringify(standardSchedule)),
    workingHoursDescription: "08:00 - 17:00",
    defaultEndTime: "17:00",
    preferences: ["Önskar studietid tisdagar"]
  })),
  // 2 AT
  ...Array.from({ length: 2 }).map((_, i) => ({
    id: `at_${i + 1}`,
    name: generateName(i + 11),
    role: DoctorRole.AT,
    competence: [ShiftType.MOTTAGNING, ShiftType.STUDIES, ShiftType.ADMIN], 
    accumulatedFatigue: Math.floor(Math.random() * 20),
    daysSinceLastJour: 99, 
    contractPercentage: 100,
    fte: 100,
    baseSchedule: JSON.parse(JSON.stringify(standardSchedule)),
    workingHoursDescription: "08:00 - 16:30",
    defaultEndTime: "16:30",
    preferences: []
  }))
];

// Generate ~2 months of requirements to show Owner Meeting cadence
export const generateRequirements = (startDate: Date): DailyRequirement[] => {
  const reqs: DailyRequirement[] = [];
  for (let i = 0; i < 60; i++) { // Increased to 60 days
    const current = new Date(startDate);
    current.setDate(startDate.getDate() + i);
    const dateStr = current.toISOString().split('T')[0];
    const isWeekend = current.getDay() === 0 || current.getDay() === 6;

    if (isWeekend) {
        // Weekend: Minimal staffing but requires split shifts (FM + EM)
        reqs.push({
            date: dateStr,
            minStaff: 2, 
            requiredShifts: {
                [ShiftType.JOUR]: 2 // 2 Jour shifts (FM and EM)
            }
        });
    } else {
        // Weekday: Full staffing
        reqs.push({
            date: dateStr,
            minStaff: 8,
            requiredShifts: {
                [ShiftType.JOUR]: 2, // Increased to 2 to cover FM and EM
                [ShiftType.BVC]: 1,
                [ShiftType.SABO]: 1,
                [ShiftType.ADMIN]: 3,
                [ShiftType.MOTTAGNING]: 6, 
            }
        });
    }
  }
  return reqs;
};

// --- STAFFING CONFIGURATION MOCK ---
export const MOCK_STAFFING_CONFIG: StaffingConfig = {
  base: {
    maxDoctors: 12,
    minTotalDaily: 6,
    minSpecDaily: 3,
    minTotalLate: 2,
    minSpecLate: 1
  },
  // --- OWNER MEETING CONFIGURATION ---
  ownerMeeting: {
      isActive: true,
      name: "Ägarmöte",
      requiredRole: DoctorRole.SPECIALIST,
      requiredCount: 6,
      // Jan(0), Mar(2), May(4), Sep(8), Nov(10). No summer meetings.
      months: [0, 2, 4, 8, 10], 
      dayOfWeek: 1, // Monday
      weekCriteria: 'FIRST_WEEK_OF_MONTH',
      timeStart: "09:30",
      timeEnd: "12:30",
      notes: "Kräver 6 specialister. Låst tid."
  },
  recurringTasks: [
    {
      id: 'bvc_tues',
      name: 'BVC Mottagning (Tis)',
      days: ['Tisdag'],
      assignedDoctorId: 'doc_franzi',
      backup1DoctorId: 'spec_2',
      backup2DoctorId: 'UNASSIGNED'
    },
    {
        id: 'bvc_thurs',
        name: 'BVC Mottagning (Tor)',
        days: ['Torsdag'],
        assignedDoctorId: 'spec_3', // Different doctor
        backup1DoctorId: 'spec_2',
        backup2DoctorId: 'UNASSIGNED'
    },
    {
      id: 'sabo_vallon_tues',
      name: 'Vallon (SÄBO) Tis',
      days: ['Tisdag'],
      assignedDoctorId: 'UNASSIGNED',
      backup1DoctorId: 'UNASSIGNED',
      backup2DoctorId: 'UNASSIGNED'
    },
    {
      id: 'sabo_vallon_thurs',
      name: 'Vallon (SÄBO) Tor',
      days: ['Torsdag'],
      assignedDoctorId: 'spec_4',
      backup1DoctorId: 'UNASSIGNED',
      backup2DoctorId: 'UNASSIGNED'
    },
    {
      id: 'sabo_attendo',
      name: 'Attendo (SÄBO)',
      days: ['Onsdag'],
      assignedDoctorId: 'doc_sven',
      backup1DoctorId: 'spec_1',
      backup2DoctorId: 'CANCEL' // "Vid frånvaro: Inställs"
    },
    {
      id: 'muren_sabo',
      name: 'Murén Rond (SÄBO)',
      days: ['Onsdag'],
      assignedDoctorId: 'spec_2',
      backup1DoctorId: 'UNASSIGNED',
      backup2DoctorId: 'UNASSIGNED',
      notes: "Rondtid, får ej flyttas."
    },
    {
        id: 'ortoped_mott',
        name: 'OM (Ortopedmottagning)',
        days: ['Torsdag'],
        assignedDoctorId: 'spec_1',
        backup1DoctorId: 'UNASSIGNED',
        backup2DoctorId: 'UNASSIGNED',
        notes: "Endast Torsdag FM"
    }
  ],
  deviations: [
    {
      id: 'xmas_week',
      name: 'Julveckan (v52)',
      startDate: '2024-12-23',
      endDate: '2024-12-29',
      counts: {
        maxDoctors: 6,
        minTotalDaily: 3,
        minSpecDaily: 1,
        minTotalLate: 1,
        minSpecLate: 0
      }
    }
  ]
};
