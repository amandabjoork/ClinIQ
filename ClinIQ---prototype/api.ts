import {
  Doctor, DoctorRole, ShiftType, LeaveRequest, ScheduleAssignment, DailyRequirement,
  StaffingConfig, RecurringTask, StaffingDeviation, Period,
} from './types';

// Adressen till ClinIQ-servern (server/). Ändra med VITE_API_URL i .env.local.
const API_BASE: string = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:4000/api';

export class ApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Översättning av enum-värden.
// Appen använder svenska visningstexter som enum-värden ('Mottagning', 'SÄBO',
// 'ST-läkare' ...), databasen använder engelska nycklar (MOTTAGNING, SABO, ST ...).
// ---------------------------------------------------------------------------
const SHIFT_TO_DB: Record<ShiftType, string> = {
  [ShiftType.MOTTAGNING]: 'MOTTAGNING',
  [ShiftType.JOUR]: 'JOUR',
  [ShiftType.ADMIN]: 'ADMIN',
  [ShiftType.BVC]: 'BVC',
  [ShiftType.SABO]: 'SABO',
  [ShiftType.OM]: 'OM',
  [ShiftType.STUDIES]: 'STUDIES',
  [ShiftType.LEDIG]: 'LEDIG',
  [ShiftType.SAKNAS]: 'SAKNAS',
  [ShiftType.MEETING]: 'MEETING',
};
const ROLE_TO_DB: Record<DoctorRole, string> = {
  [DoctorRole.SPECIALIST]: 'SPECIALIST',
  [DoctorRole.ST]: 'ST',
  [DoctorRole.AT]: 'AT',
};
const invert = <K extends string>(m: Record<K, string>) =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k])) as Record<string, K>;
const DB_TO_SHIFT = invert(SHIFT_TO_DB);
const DB_TO_ROLE = invert(ROLE_TO_DB);

const shiftIn = (v: string): ShiftType => {
  const s = DB_TO_SHIFT[v];
  if (!s) throw new ApiError(`Okänd passtyp från databasen: ${v}`);
  return s;
};
const roleIn = (v: string): DoctorRole => {
  const r = DB_TO_ROLE[v];
  if (!r) throw new ApiError(`Okänd roll från databasen: ${v}`);
  return r;
};

// Datum: appen använder "YYYY-MM-DD", databasen skickar "YYYY-MM-DDT00:00:00.000Z".
const dayIn = (iso: string) => iso.slice(0, 10);
const dayOut = (day: string) => `${day.slice(0, 10)}T00:00:00.000Z`;

// ---------------------------------------------------------------------------
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
  } catch {
    throw new ApiError(`Kunde inte nå servern på ${API_BASE}. Är den startad (cd server && npm run dev)?`);
  }
  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch { /* ignore */ }
    throw new ApiError(`Servern svarade ${res.status} på ${path}${detail ? `: ${detail.slice(0, 300)}` : ''}`, res.status);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
const json = (body: unknown) => JSON.stringify(body);

// --- Läkare ----------------------------------------------------------------
export const doctorFromServer = (r: any): Doctor => ({
  id: r.id,
  name: r.name,
  role: roleIn(r.role),
  competence: (r.competence as string[]).map(shiftIn),
  baseSchedule: r.baseSchedule,
  fte: r.fte,
  accumulatedFatigue: r.accumulatedFatigue,
  daysSinceLastJour: r.daysSinceLastJour,
  contractPercentage: r.contractPercentage,
  workingHoursDescription: r.workingHoursDescription,
  defaultEndTime: r.defaultEndTime,
  preferences: r.preferences ?? [],
});
export const doctorToServer = (d: Doctor) => ({
  name: d.name,
  role: ROLE_TO_DB[d.role],
  competence: d.competence.map(c => SHIFT_TO_DB[c]),
  baseSchedule: d.baseSchedule,
  fte: d.fte,
  accumulatedFatigue: d.accumulatedFatigue,
  daysSinceLastJour: d.daysSinceLastJour,
  contractPercentage: d.contractPercentage,
  workingHoursDescription: d.workingHoursDescription,
  defaultEndTime: d.defaultEndTime,
  preferences: d.preferences,
});

// --- Ledighet --------------------------------------------------------------
export const leaveFromServer = (r: any): LeaveRequest => ({
  id: r.id,
  doctorId: r.doctorId,
  date: dayIn(r.date),
  status: r.status,
  reason: r.reason,
  isFullDay: r.isFullDay,
  startTime: r.startTime ?? undefined,
  endTime: r.endTime ?? undefined,
  aiRecommendation: r.aiRecommendation ?? undefined,
  aiReasoning: r.aiReasoning ?? undefined,
  suggestedAlternatives: r.suggestedAlternatives?.length ? r.suggestedAlternatives : undefined,
});
export const leaveToServer = (l: LeaveRequest) => ({
  id: l.id,
  doctorId: l.doctorId,
  date: dayOut(l.date),
  status: l.status,
  reason: l.reason,
  isFullDay: l.isFullDay ?? true,
  startTime: l.startTime ?? null,
  endTime: l.endTime ?? null,
  aiRecommendation: l.aiRecommendation ?? null,
  aiReasoning: l.aiReasoning ?? null,
  suggestedAlternatives: l.suggestedAlternatives ?? [],
});

// --- Dagskrav --------------------------------------------------------------
export const requirementFromServer = (r: any): DailyRequirement => ({
  date: dayIn(r.date),
  minStaff: r.minStaff,
  requiredShifts: Object.fromEntries(
    Object.entries(r.requiredShifts as Record<string, number>).map(([k, v]) => [shiftIn(k), v])
  ),
});
export const requirementToServer = (r: DailyRequirement) => ({
  minStaff: r.minStaff,
  requiredShifts: Object.fromEntries(
    Object.entries(r.requiredShifts).map(([k, v]) => [SHIFT_TO_DB[k as ShiftType], v])
  ),
});

// --- Bemanningskonfiguration -----------------------------------------------
const toValidId = (ref: string, valid: Set<string>) => (ref && ref !== 'UNASSIGNED' && ref !== 'CANCEL' && valid.has(ref) ? ref : null);

const taskFromServer = (t: any): RecurringTask => ({
  id: t.id,
  name: t.name,
  days: t.days,
  notes: t.notes ?? undefined,
  assignedDoctorId: t.assignedDoctorId ?? 'UNASSIGNED',
  backup1DoctorId: t.backup1Cancel ? 'CANCEL' : t.backup1DoctorId ?? 'UNASSIGNED',
  backup2DoctorId: t.backup2Cancel ? 'CANCEL' : t.backup2DoctorId ?? 'UNASSIGNED',
});
const deviationFromServer = (d: any): StaffingDeviation => ({
  id: d.id,
  name: d.name,
  startDate: dayIn(d.startDate),
  endDate: dayIn(d.endDate),
  counts: {
    maxDoctors: d.maxDoctors,
    minTotalDaily: d.minTotalDaily,
    minSpecDaily: d.minSpecDaily,
    minTotalLate: d.minTotalLate,
    minSpecLate: d.minSpecLate,
  },
});
export const configFromServer = (c: any): StaffingConfig => ({
  base: {
    maxDoctors: c.maxDoctors,
    minTotalDaily: c.minTotalDaily,
    minSpecDaily: c.minSpecDaily,
    minTotalLate: c.minTotalLate,
    minSpecLate: c.minSpecLate,
  },
  ownerMeeting: {
    isActive: c.ownerMeetingIsActive,
    name: c.ownerMeetingName,
    requiredRole: roleIn(c.ownerMeetingRequiredRole),
    requiredCount: c.ownerMeetingRequiredCount,
    months: c.ownerMeetingMonths,
    dayOfWeek: c.ownerMeetingDayOfWeek,
    weekCriteria: 'FIRST_WEEK_OF_MONTH',
    timeStart: c.ownerMeetingTimeStart,
    timeEnd: c.ownerMeetingTimeEnd,
    notes: c.ownerMeetingNotes,
  },
  recurringTasks: (c.recurringTasks ?? []).map(taskFromServer),
  deviations: (c.deviations ?? []).map(deviationFromServer),
});
/** `validDoctorIds`: uppgifter som pekar på en borttagen läkare skickas som "ingen" (annars nekar databasen). */
export const configToServer = (c: StaffingConfig, validDoctorIds: Set<string>) => ({
  ...c.base,
  ownerMeetingIsActive: c.ownerMeeting.isActive,
  ownerMeetingName: c.ownerMeeting.name,
  ownerMeetingRequiredRole: ROLE_TO_DB[c.ownerMeeting.requiredRole],
  ownerMeetingRequiredCount: c.ownerMeeting.requiredCount,
  ownerMeetingMonths: c.ownerMeeting.months,
  ownerMeetingDayOfWeek: c.ownerMeeting.dayOfWeek,
  ownerMeetingTimeStart: c.ownerMeeting.timeStart,
  ownerMeetingTimeEnd: c.ownerMeeting.timeEnd,
  ownerMeetingNotes: c.ownerMeeting.notes,
  recurringTasks: c.recurringTasks.map(t => ({
    id: t.id,
    name: t.name,
    days: t.days,
    notes: t.notes ?? null,
    assignedDoctorId: toValidId(t.assignedDoctorId, validDoctorIds),
    backup1DoctorId: toValidId(t.backup1DoctorId, validDoctorIds),
    backup1Cancel: t.backup1DoctorId === 'CANCEL',
    backup2DoctorId: toValidId(t.backup2DoctorId, validDoctorIds),
    backup2Cancel: t.backup2DoctorId === 'CANCEL',
  })),
  deviations: c.deviations.map(d => ({
    id: d.id,
    name: d.name,
    startDate: dayOut(d.startDate),
    endDate: dayOut(d.endDate),
    ...d.counts,
  })),
});

// --- Schema ----------------------------------------------------------------
export const assignmentFromServer = (r: any): ScheduleAssignment => ({
  date: dayIn(r.date),
  period: r.period as Period,
  shift: shiftIn(r.shift),
  assignedDoctorId: r.assignedDoctorId ?? 'N/A',
  aiExplanation: r.aiExplanation,
  scoreSnapshot: r.scoreSnapshot,
  isManual: r.isManual || undefined,
  taskName: r.taskName ?? undefined,
});
export const assignmentToServer = (a: ScheduleAssignment) => ({
  date: dayOut(a.date),
  period: a.period,
  shift: SHIFT_TO_DB[a.shift],
  assignedDoctorId: a.assignedDoctorId === 'N/A' ? null : a.assignedDoctorId,
  aiExplanation: a.aiExplanation,
  scoreSnapshot: a.scoreSnapshot,
  isManual: !!a.isManual,
  taskName: a.taskName ?? null,
});

/** Jämförbar "signatur" för en dags schemarader, för att bara spara det som ändrats. */
export const daySignature = (rows: ScheduleAssignment[]) =>
  JSON.stringify(
    rows
      .map(r => [r.period, r.shift, r.assignedDoctorId, r.taskName ?? '', r.isManual ? 1 : 0, r.scoreSnapshot, r.aiExplanation])
      .map(x => JSON.stringify(x))
      .sort()
  );
const groupByDate = (schedule: ScheduleAssignment[]) => {
  const m = new Map<string, ScheduleAssignment[]>();
  for (const a of schedule) (m.get(a.date) ?? m.set(a.date, []).get(a.date)!).push(a);
  return m;
};
export const scheduleSignatures = (schedule: ScheduleAssignment[]) =>
  new Map([...groupByDate(schedule)].map(([d, rows]) => [d, daySignature(rows)]));

export const requirementSignature = (r: DailyRequirement) =>
  JSON.stringify([r.minStaff, Object.entries(r.requiredShifts).sort()]);

// ---------------------------------------------------------------------------
// Anrop
// ---------------------------------------------------------------------------
export const api = {
  async fetchDoctors(): Promise<Doctor[]> {
    return (await request<any[]>('/doctors')).map(doctorFromServer);
  },
  // Klienten bestämmer id (så inget behöver bytas ut efter sparande).
  async createDoctor(d: Doctor): Promise<void> {
    await request('/doctors', { method: 'POST', body: json({ id: d.id, ...doctorToServer(d) }) });
  },
  async updateDoctor(d: Doctor): Promise<void> {
    await request(`/doctors/${encodeURIComponent(d.id)}`, { method: 'PUT', body: json(doctorToServer(d)) });
  },
  async deleteDoctor(id: string): Promise<void> {
    await request(`/doctors/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async fetchLeaves(): Promise<LeaveRequest[]> {
    return (await request<any[]>('/leave-requests')).map(leaveFromServer);
  },
  async createLeave(l: LeaveRequest): Promise<void> {
    await request('/leave-requests', { method: 'POST', body: json(leaveToServer(l)) });
  },
  async setLeaveStatus(id: string, status: LeaveRequest['status']): Promise<void> {
    await request(`/leave-requests/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: json({ status }) });
  },

  async fetchRequirements(): Promise<DailyRequirement[]> {
    return (await request<any[]>('/requirements')).map(requirementFromServer);
  },
  async saveRequirements(reqs: DailyRequirement[]): Promise<void> {
    if (!reqs.length) return;
    await request('/requirements/bulk', {
      method: 'POST',
      body: json(reqs.map(r => ({ date: dayOut(r.date), ...requirementToServer(r) }))),
    });
  },

  /** null = ingen konfiguration finns än (databasen är nyss skapad). */
  async fetchStaffingConfig(): Promise<StaffingConfig | null> {
    try {
      return configFromServer(await request<any>('/staffing-config'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },
  async saveStaffingConfig(payload: ReturnType<typeof configToServer>): Promise<void> {
    await request('/staffing-config', { method: 'PUT', body: json(payload) });
  },

  async fetchSchedule(): Promise<ScheduleAssignment[]> {
    return (await request<any[]>('/schedule')).map(assignmentFromServer);
  },
  async replaceScheduleRange(from: string, to: string, rows: ScheduleAssignment[]): Promise<void> {
    await request('/schedule/bulk', {
      method: 'POST',
      body: json({ from: dayOut(from), to: dayOut(to), assignments: rows.map(assignmentToServer) }),
    });
  },
};

/**
 * Sparar bara de dagar i schemat som ändrats sedan `last` och returnerar nya signaturer.
 * Många ändrade dagar (t.ex. ett nytt genererat schema) sparas i ett enda anrop.
 * Kastar vid fel - då är `last` oförändrad och nästa försök sparar om samma ändringar.
 */
export async function syncSchedule(
  schedule: ScheduleAssignment[],
  last: Map<string, string>
): Promise<Map<string, string>> {
  const current = scheduleSignatures(schedule);
  const changed = [...new Set([...last.keys(), ...current.keys()])]
    .filter(d => (last.get(d) ?? '') !== (current.get(d) ?? ''))
    .sort();
  if (changed.length === 0) return last;

  const byDate = groupByDate(schedule);
  if (changed.length > 5) {
    const from = changed[0], to = changed[changed.length - 1];
    const rows = schedule.filter(a => a.date >= from && a.date <= to);
    await api.replaceScheduleRange(from, to, rows);
  } else {
    for (const d of changed) await api.replaceScheduleRange(d, d, byDate.get(d) ?? []);
  }
  return current;
}
