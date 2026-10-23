
export enum DoctorRole {
  SPECIALIST = 'Specialist',
  ST = 'ST-läkare',
  AT = 'AT-läkare'
}

export enum UserRole {
  ADMIN = 'ADMIN',
  DOCTOR = 'DOCTOR'
}

export interface User {
  id: string;
  name: string;
  role: UserRole;
  doctorId?: string; // Linked doctor profile if role is DOCTOR
}

export enum ShiftType {
  MOTTAGNING = 'Mottagning',
  JOUR = 'Jour',
  ADMIN = 'Admin',
  BVC = 'BVC',
  SABO = 'SÄBO', // New type
  OM = 'OM', // Ortopedmedicinsk mottagning
  STUDIES = 'Studier/Utb',
  LEDIG = 'Ledig',
  SAKNAS = 'BEMANNING SAKNAS', // Used when logic fails to fill slot
  MEETING = 'Möte' // New for Owner Meeting
}

export type Period = 'FM' | 'EM';

export interface WorkDayConfig {
  dayIndex: number; // 0 = Sunday, 1 = Monday...
  start: string; // "08:00"
  end: string;   // "17:00"
  isOff: boolean;
}

export interface Doctor {
  id: string;
  name: string;
  role: DoctorRole;
  competence: ShiftType[]; // Which shifts they can perform
  
  // Base Schedule (Controlled by Admin)
  baseSchedule: WorkDayConfig[]; 
  fte: number; // Full Time Equivalent percentage (e.g. 100, 80)

  // AI Scoring Metrics
  accumulatedFatigue: number; // Score based on past heavy shifts
  daysSinceLastJour: number;
  contractPercentage: number; // Legacy, keeping for compatibility but mapped to FTE
  workingHoursDescription: string; // e.g. "08:00 - 17:00"
  defaultEndTime: string; // e.g. "16:30", "17:00", "15:00" - Used for visual timeline
  preferences: string[]; // Mock preferences
}

export interface LeaveRequest {
  id: string;
  doctorId: string;
  date: string; // ISO Date YYYY-MM-DD
  status: 'PENDING' | 'APPROVED' | 'DENIED';
  reason: string;
  isFullDay?: boolean; // New: If false, use start/end time
  startTime?: string;  // New: "08:00"
  endTime?: string;    // New: "12:00"
  aiRecommendation?: 'APPROVED' | 'DENIED'; // What AI suggests admin should do
  aiReasoning?: string; // Why AI approved/denied
  suggestedAlternatives?: string[]; // Dates suggested by AI if denied
}

export interface ScheduleAssignment {
  date: string;
  period: Period; // FM or EM
  shift: ShiftType;
  assignedDoctorId: string;
  aiExplanation: string; // "Explainability" string
  scoreSnapshot: number; // The score the doctor had when picked
  isManual?: boolean; // If true, an admin has overridden/set this manually
  taskName?: string; // Specific name for locked tasks (e.g. "Vallon", "Attendo")
}

export interface DailyRequirement {
  date: string;
  minStaff: number;
  requiredShifts: {
    [key in ShiftType]?: number; // e.g., JOUR: 1, MOTTAGNING: 5
  };
}

export interface ScheduleWarning {
  date: string;
  message: string;
  type: 'CRITICAL' | 'INFO';
}

export interface GenerationResult {
  schedule: ScheduleAssignment[];
  warnings: ScheduleWarning[];
}

export type ShiftColorConfig = {
  [key in ShiftType]: {
    bg: string;
    text: string;
    border: string;
  }
};

// --- NEW TYPES FOR STAFFING REQUIREMENTS VIEW ---

export interface RecurringTask {
  id: string;
  name: string;
  days: string[]; // e.g. ["Tisdag", "Torsdag"]
  assignedDoctorId: string | 'UNASSIGNED';
  backup1DoctorId: string | 'UNASSIGNED' | 'CANCEL';
  backup2DoctorId: string | 'UNASSIGNED' | 'CANCEL';
  notes?: string;
}

// STRICT MODEL FOR CRITICAL MEETINGS
export interface RecurringMeetingConfig {
    isActive: boolean;
    name: string; // "Ägarmöte"
    requiredRole: DoctorRole; // SPECIALIST
    requiredCount: number; // 6
    months: number[]; // [0, 2, 4, 8, 10] (JS months 0-11)
    dayOfWeek: number; // 1 = Monday
    weekCriteria: 'FIRST_WEEK_OF_MONTH'; // Logic specific
    timeStart: string; // "09:30"
    timeEnd: string; // "12:30"
    notes: string;
}

export interface StaffingBaseCounts {
  maxDoctors: number;
  minTotalDaily: number;
  minSpecDaily: number;
  minTotalLate: number; // Until 17:00
  minSpecLate: number;  // Until 17:00
}

export interface StaffingDeviation {
  id: string;
  name: string; // e.g. "Julvecka"
  startDate: string;
  endDate: string;
  counts: StaffingBaseCounts;
}

export interface StaffingConfig {
  base: StaffingBaseCounts;
  ownerMeeting: RecurringMeetingConfig; // New dedicated field
  recurringTasks: RecurringTask[];
  deviations: StaffingDeviation[];
}
