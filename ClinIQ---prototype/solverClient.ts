import { Doctor, DailyRequirement, LeaveRequest, StaffingConfig, GenerationResult } from './types';

// Adressen till optimeringstjänsten (solver/). Ändra med VITE_SOLVER_URL i .env.local.
const SOLVER_URL: string = (import.meta as any).env?.VITE_SOLVER_URL ?? 'http://localhost:8000';

export interface SolverResult extends GenerationResult {
  stats?: {
    status: string;
    windows: number;
    objective: number;
    solveSeconds: number;
    variables: number;
  };
}

export interface SolverOptions {
  /** Deterministisk tidsbudget för hela perioden (standard 2). Högre = något bättre schema, längre väntan. */
  timeLimitSeconds?: number;
  /** Lägg ut Mottagning även utöver kravet så att ingen läkare står oanvänd (standard true). */
  fillIdleWithMottagning?: boolean;
  /** Antal dagar per optimeringsfönster (standard 14). */
  windowDays?: number;
}

/**
 * Skickar bara det optimeraren behöver. Ledighetens fritext ("reason") skickas
 * medvetet INTE med - den kan innehålla känsliga uppgifter (t.ex. sjukdom).
 */
export async function generateScheduleWithSolver(
  doctors: Doctor[],
  requirements: DailyRequirement[],
  leaves: LeaveRequest[],
  config: StaffingConfig,
  options: SolverOptions = {},
  timeoutMs = 120_000
): Promise<SolverResult> {
  const body = {
    doctors: doctors.map(d => ({
      id: d.id,
      name: d.name,
      role: d.role,
      competence: d.competence,
      baseSchedule: d.baseSchedule,
      accumulatedFatigue: d.accumulatedFatigue,
      daysSinceLastJour: d.daysSinceLastJour,
      defaultEndTime: d.defaultEndTime,
      preferences: d.preferences,
    })),
    requirements,
    leaves: leaves
      .filter(l => l.status === 'APPROVED')
      .map(l => ({
        doctorId: l.doctorId,
        date: l.date,
        status: l.status,
        isFullDay: l.isFullDay,
        startTime: l.startTime,
        endTime: l.endTime,
      })),
    config,
    options,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${SOLVER_URL}/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Solvern svarade ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as SolverResult;
  } finally {
    clearTimeout(timer);
  }
}
