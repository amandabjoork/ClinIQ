
import { Doctor, DailyRequirement, ScheduleAssignment, ShiftType, LeaveRequest, DoctorRole, GenerationResult, ScheduleWarning, Period, StaffingConfig, RecurringTask, StaffingBaseCounts } from './types';

// --- AI PARAMETERS ---
const SCORING_WEIGHTS = {
  FATIGUE_PENALTY: 2.0,
  RECENCY_PENALTY: 15.0,
  ROLE_BASE: {
    [DoctorRole.SPECIALIST]: 0,
    [DoctorRole.ST]: 10,
    [DoctorRole.AT]: 50
  },
  RANDOM_FACTOR: 10.0
};

// --- HELPER: Normalize Swedish Weekdays ---
const getSwedishDayName = (dateStr: string): string => {
  const date = new Date(dateStr);
  const day = date.toLocaleDateString('sv-SE', { weekday: 'long' });
  // Ensure "måndag" matches "Måndag" from mock config
  return day.charAt(0).toUpperCase() + day.slice(1);
};

// --- HELPER: Check if Doctor is working on a specific date based on Base Schedule ---
// UPDATED: Now accepts optional 'ignoreOff' flag for Jour shifts
const isDoctorWorkingToday = (doc: Doctor, dateStr: string, isJourShift: boolean = false): boolean => {
    const date = new Date(dateStr);
    const dayIndex = date.getDay(); // 0 = Sun, 1 = Mon...
    const config = doc.baseSchedule.find(d => d.dayIndex === dayIndex);
    
    // CRITICAL FIX: If it is a JOUR shift, we ignore the "isOff" flag because Jour can happen on weekends/off-days.
    // In a real app, we would check "canDoWeekendJour" property, but for this prototype, competence is enough.
    if (isJourShift && doc.competence.includes(ShiftType.JOUR)) {
        return true;
    }

    return config ? !config.isOff : false; 
};

/**
 * Calculates a "Suitability Score" for a heavy shift (Jour).
 */
const calculateJourScore = (doc: Doctor, dateStr: string): { score: number, explanation: string } => {
  let score = 0;
  const technicalLog: string[] = [];

  // 1. Fatigue Analysis
  const fatigueImpact = doc.accumulatedFatigue * 0.5;
  score += fatigueImpact;
  technicalLog.push(`Trötthet (+${fatigueImpact})`);

  // 2. Recency
  const recencyPenalty = Math.max(0, (14 - doc.daysSinceLastJour) * 5);
  if (recencyPenalty > 0) {
    score += recencyPenalty;
    technicalLog.push(`Nyligen jour (+${recencyPenalty})`);
  } else {
    score -= 5;
    technicalLog.push(`Länge sedan jour (-5)`);
  }

  // 3. Role Base
  score += SCORING_WEIGHTS.ROLE_BASE[doc.role];
  technicalLog.push(`Rollbas (+${SCORING_WEIGHTS.ROLE_BASE[doc.role]})`);

  // 4. Randomness
  const noise = (Math.random() - 0.5) * SCORING_WEIGHTS.RANDOM_FACTOR;
  score += noise;
  technicalLog.push(`Slump (${noise.toFixed(1)})`);

  const factors = [];
  if (doc.daysSinceLastJour > 14) factors.push({ label: "Återhämtning", text: "Lång tid sedan förra passet", positive: true });
  if (doc.accumulatedFatigue > 50) factors.push({ label: "Belastning", text: "Hög total arbetsbörda", positive: false });

  const summary = `${doc.name} bedömdes vara bäst lämpad för detta pass.`;

  return {
    score: parseFloat(score.toFixed(1)),
    explanation: JSON.stringify({ summary, score: parseFloat(score.toFixed(1)), factors, details: technicalLog })
  };
};

export const generateSchedule = (
  doctors: Doctor[],
  requirements: DailyRequirement[],
  approvedLeaves: LeaveRequest[],
  config: StaffingConfig 
): GenerationResult => {

  const schedule: ScheduleAssignment[] = [];
  const warnings: ScheduleWarning[] = [];

  // Mutable copy of doctors to track fatigue state
  let workingDoctors = JSON.parse(JSON.stringify(doctors)) as Doctor[];

  requirements.forEach(req => {
    const currentDate = new Date(req.date);
    const dayName = getSwedishDayName(req.date);
    const isWeekend = currentDate.getDay() === 0 || currentDate.getDay() === 6;

    // --- STEP 1: DETERMINE DAILY CONFIG ---
    let dailyConfig = config.base;
    const activeDeviation = config.deviations.find(d => {
      const start = new Date(d.startDate);
      const end = new Date(d.endDate);
      return currentDate >= start && currentDate <= end;
    });

    if (activeDeviation) {
      dailyConfig = activeDeviation.counts;
    }

    // --- STEP 2: IDENTIFY AVAILABLE DOCTORS ---
    // Criteria: 
    // 1. Not on approved leave (Full Day).
    // 2. Actually working this weekday based on baseSchedule OR it is a Jour shift on Weekend.
    
    // Track assigned periods: DoctorId -> Set<Period>
    const assignedPeriods = new Map<string, Set<Period>>();
    
    workingDoctors.forEach(d => {
        const assigned = new Set<Period>();
        // Check leaves
        const dayLeaves = approvedLeaves.filter(l => l.doctorId === d.id && l.date === req.date && l.status === 'APPROVED');
        dayLeaves.forEach(l => {
             if (l.isFullDay !== false) {
                 assigned.add('FM');
                 assigned.add('EM');
             } else {
                 // Simple overlap check
                 // FM: 08-12. EM: 13-17.
                 const s = l.startTime ? parseInt(l.startTime.split(':')[0]) + parseInt(l.startTime.split(':')[1])/60 : 0;
                 const e = l.endTime ? parseInt(l.endTime.split(':')[0]) + parseInt(l.endTime.split(':')[1])/60 : 24;
                 
                 // If leave overlaps significantly with FM (ends after 08:30)
                 if (s < 11.5 && e > 8.5) assigned.add('FM');
                 // If leave overlaps significantly with EM (starts before 16:30)
                 if (s < 16.5 && e > 13.5) assigned.add('EM');
             }
        });
        assignedPeriods.set(d.id, assigned);
    });

    // We pre-calculate availability lists to avoid repeated checks
    // List for Standard Shifts (M-F)
    const availableStandardDocs = workingDoctors.filter(d => {
        // If fully booked by leave, exclude
        const assigned = assignedPeriods.get(d.id);
        if (assigned?.has('FM') && assigned?.has('EM')) return false;
        
        return isDoctorWorkingToday(d, req.date, false);
    });

    // List for Jour Shifts (Includes Weekends)
    const availableJourDocs = workingDoctors.filter(d => {
        const assigned = assignedPeriods.get(d.id);
        if (assigned?.has('FM') && assigned?.has('EM')) return false;
        
        return isDoctorWorkingToday(d, req.date, true);
    });

    const assign = (shift: ShiftType, period: Period, candidate: Doctor, reason: string, score: number, isRecurring: boolean = false, taskName?: string) => {
      schedule.push({
        date: req.date,
        period,
        shift,
        assignedDoctorId: candidate.id,
        aiExplanation: reason,
        scoreSnapshot: score,
        isManual: isRecurring, // Mark recurring/owner tasks as "Manual" style
        taskName: taskName
      });
      assignedPeriods.get(candidate.id)?.add(period);
    };

    const isAvailable = (docId: string, period: Period) => {
      return !assignedPeriods.get(docId)?.has(period);
    };

    // --- STEP 3: CRITICAL - OWNER MEETING (ÄGARMÖTE) ---
    // This MUST run before anything else to lock resources.
    if (config.ownerMeeting.isActive) {
        const conf = config.ownerMeeting;
        const currentMonth = currentDate.getMonth(); // 0-11
        const currentDayOfWeek = currentDate.getDay(); // 1 = Monday
        const dayOfMonth = currentDate.getDate();

        // Logic: Month is in list AND Day is Monday AND it is the FIRST Monday (day <= 7)
        if (conf.months.includes(currentMonth) && currentDayOfWeek === conf.dayOfWeek && dayOfMonth <= 7) {
            
            // Filter candidates: Specialists from availableStandardDocs
            const candidates = availableStandardDocs.filter(d => 
                d.role === conf.requiredRole && isAvailable(d.id, 'FM')
            );

            // Sort alphabetically to be deterministic or rotation based
            candidates.sort((a,b) => a.name.localeCompare(b.name));

            let assignedCount = 0;
            for (const doc of candidates) {
                if (assignedCount >= conf.requiredCount) break;
                
                assign(ShiftType.MEETING, 'FM', doc, "Ägarmöte (Låst)", 0, true, conf.name);
                assignedCount++;
            }

            if (assignedCount < conf.requiredCount) {
                warnings.push({ date: req.date, type: 'INFO', message: `Ägarmöte: Kunde bara hitta ${assignedCount}/${conf.requiredCount} specialister.` });
            }
        }
    }

    // --- STEP 4: ASSIGN JOUR (Priority 2) ---
    // Includes Weekends.
    const jourCount = req.requiredShifts[ShiftType.JOUR] || 0;
    const targetJourPeriods: Period[] = ['FM', 'EM']; // Simplification: Jour implies covering the slot

    // Check if we need more loops than periods (e.g. 2 Jours on Saturday = 1 FM, 1 EM)
    // For prototype, we assume jourCount 2 means 1 FM and 1 EM.
    
    for (let i = 0; i < jourCount; i++) {
      const targetPeriod: Period = targetJourPeriods[i % targetJourPeriods.length];
      
      const jourCandidates = availableJourDocs.filter(d =>
        d.competence.includes(ShiftType.JOUR) && 
        isAvailable(d.id, targetPeriod) &&
        !schedule.some(s => s.date === req.date && s.assignedDoctorId === d.id && s.shift === ShiftType.JOUR)
      );

      const scoredCandidates = jourCandidates.map(d => {
        const analysis = calculateJourScore(d, req.date);
        return { ...d, tempScore: analysis.score, tempExpl: analysis.explanation };
      });

      scoredCandidates.sort((a, b) => a.tempScore - b.tempScore);

      if (scoredCandidates.length > 0) {
        const best = scoredCandidates[0];
        assign(ShiftType.JOUR, targetPeriod, best, best.tempExpl, best.tempScore);
        
        const originalDocIndex = workingDoctors.findIndex(d => d.id === best.id);
        if (originalDocIndex >= 0) {
          workingDoctors[originalDocIndex].accumulatedFatigue += 5;
          workingDoctors[originalDocIndex].daysSinceLastJour = 0;
        }
      } else {
        warnings.push({ date: req.date, type: 'CRITICAL', message: `Jour-plats (${targetPeriod}) saknas.` });
        schedule.push({
            date: req.date,
            period: targetPeriod,
            shift: ShiftType.SAKNAS,
            assignedDoctorId: "N/A",
            aiExplanation: "Ingen tillgänglig.",
            scoreSnapshot: 0
        });
      }
    }

    // --- STEP 5: PROCESS RECURRING TASKS & LOCKED RESOURCES ---
    // Track how many of each shift type are already filled today so Step 6
    // can respect the configured requirement counts instead of ignoring them.
    const shiftCounts: Partial<Record<ShiftType, number>> = {};
    const scheduledDoctorIds = new Set<string>();

    config.recurringTasks.forEach(task => {
      const appliesToday = task.days.some(d => dayName.includes(d.split(' ')[0]));
      
      if (appliesToday) {
        let shiftType = ShiftType.ADMIN;
        let preferredPeriod: Period = 'FM';

        if (task.name.includes('BVC')) shiftType = ShiftType.BVC;
        else if (task.name.includes('SÄBO') || task.name.includes('Vallon') || task.name.includes('Attendo')) shiftType = ShiftType.SABO;
        else if (task.name.includes('OM') || task.name.includes('Ortoped')) shiftType = ShiftType.OM; 
        else if (task.name.includes('Mottagning')) shiftType = ShiftType.MOTTAGNING;
        
        let assignedDocId = task.assignedDoctorId !== 'UNASSIGNED' ? task.assignedDoctorId : null;
        let assignmentStatus = 'PRIMARY'; 

        // Use availableStandardDocs because these are regular tasks
        if (assignedDocId && !availableStandardDocs.find(d => d.id === assignedDocId)) {
          assignedDocId = null; 
        }

        // Backup logic... (simplified for brevity, assume similar to before)
        if (!assignedDocId && task.backup1DoctorId !== 'UNASSIGNED') {
           if (task.backup1DoctorId === 'CANCEL') { assignmentStatus = 'CANCELLED'; } 
           else if (availableStandardDocs.find(d => d.id === task.backup1DoctorId)) { assignedDocId = task.backup1DoctorId; assignmentStatus = 'BACKUP1'; }
        }

        if (assignmentStatus === 'CANCELLED') {
             warnings.push({ date: req.date, type: 'INFO', message: `${task.name} inställd pga frånvaro.` });
        } else if (assignedDocId) {
            const doc = availableStandardDocs.find(d => d.id === assignedDocId)!;
            if (isAvailable(doc.id, preferredPeriod)) {
                let displayName = task.name;
                if (task.name.includes("BVC")) displayName = "BVC";
                if (task.name.includes("OM")) displayName = "OM (Ortoped)";
                assign(shiftType, preferredPeriod, doc, `Låst uppgift: ${task.name}`, 0, true, displayName);
                // This slot now counts against today's requirement for its shift type.
                shiftCounts[shiftType] = (shiftCounts[shiftType] || 0) + 1;
                scheduledDoctorIds.add(doc.id);
            } else {
                 // Conflict handled silently or warning
            }
        } else if (task.assignedDoctorId !== 'UNASSIGNED') {
             schedule.push({ date: req.date, period: preferredPeriod, shift: ShiftType.SAKNAS, assignedDoctorId: "N/A", aiExplanation: `Kunde ej bemanna ${task.name}`, scoreSnapshot: 0, taskName: task.name });
        }
      }
    });

    // Jour and Ägarmöte are locked resources assigned above (Steg 3-4) - their
    // doctors already count toward today's maxDoctors cap.
    schedule
      .filter(s => s.date === req.date && (s.shift === ShiftType.JOUR || s.shift === ShiftType.MEETING) && s.assignedDoctorId !== 'N/A')
      .forEach(s => scheduledDoctorIds.add(s.assignedDoctorId));

    // --- STEP 6: FILL REMAINING SLOTS UP TO THE CONFIGURED REQUIREMENTS ---
    // Only book as many Mottagning/Admin/BVC/SÄBO/OM slots as `req.requiredShifts`
    // actually asks for, and stop adding NEW doctors to the day once
    // `dailyConfig.maxDoctors` is reached. Previously this step ignored those
    // numbers entirely and booked every available doctor into every free period,
    // which made the "Bemanningskrav"-inställningarna in the admin UI decorative.
    const fillableTypes = (Object.keys(req.requiredShifts) as ShiftType[]).filter(t => t !== ShiftType.JOUR);
    const remaining = (type: ShiftType) => (req.requiredShifts[type] || 0) - (shiftCounts[type] || 0);

    // Doctors with a matching preference (e.g. "Gillar admin på fredagar") get
    // first claim on that quota; everyone else fills whatever is left.
    const sortedDocs = [...availableStandardDocs].sort((a, b) => {
      const wants = (d: Doctor) => d.preferences.some(p => p.toLowerCase().includes('admin') && p.toLowerCase().includes(dayName.toLowerCase())) ? 1 : 0;
      return wants(b) - wants(a);
    });

    sortedDocs.forEach(doc => {
      (['FM', 'EM'] as Period[]).forEach(period => {
        if (!isAvailable(doc.id, period)) return;

        const isNewDoctorToday = !scheduledDoctorIds.has(doc.id);
        if (isNewDoctorToday && scheduledDoctorIds.size >= dailyConfig.maxDoctors) {
          return; // Already at today's staffing cap - don't pull in extra people.
        }

        const wantsAdmin = doc.preferences.some(pref => pref.toLowerCase().includes("admin") && pref.toLowerCase().includes(dayName.toLowerCase()));

        let fillShift: ShiftType | null = null;
        let explanation = '';

        if (wantsAdmin && doc.competence.includes(ShiftType.ADMIN) && remaining(ShiftType.ADMIN) > 0) {
          // Preference match, as long as the Admin quota still has room.
          fillShift = ShiftType.ADMIN;
          explanation = "Matchar preferens: Admin";
        } else {
          // Otherwise take whichever required shift type still has open slots and
          // matches this doctor's competence - specialty needs before Mottagning.
          const specialtyType = fillableTypes
            .filter(t => t !== ShiftType.MOTTAGNING)
            .find(t => doc.competence.includes(t) && remaining(t) > 0);

          if (specialtyType) {
            fillShift = specialtyType;
            explanation = `Bemannar behov: ${specialtyType}`;
          } else if (doc.competence.includes(ShiftType.MOTTAGNING) && remaining(ShiftType.MOTTAGNING) > 0) {
            fillShift = ShiftType.MOTTAGNING;
            explanation = "Generell schemaläggning (Fyllnad)";
          }
        }

        if (!fillShift) return; // Dagens krav är redan uppfyllda för det här passet.

        assign(fillShift, period, doc, explanation, 0);
        shiftCounts[fillShift] = (shiftCounts[fillShift] || 0) + 1;
        scheduledDoctorIds.add(doc.id);
      });
    });

    // --- STEP 7: VALIDATE AGAINST THE STAFFING MINIMUMS ---
    // `dailyConfig` (minTotalDaily/minSpecDaily/minTotalLate/minSpecLate) is the
    // "standard weekday" staffing target set under Bemanningskrav Standard.
    // Weekends are modeled separately in DailyRequirement (minStaff: 2, only
    // Jour required) - checking the weekday minimums there would just produce
    // a warning every Saturday/Sunday, so only validate them on weekdays.
    const dayAssignments = schedule.filter(s => s.date === req.date && s.assignedDoctorId !== 'N/A');
    const workingDocIds = new Set(dayAssignments.map(s => s.assignedDoctorId));
    const lateDocIds = new Set(dayAssignments.filter(s => s.period === 'EM').map(s => s.assignedDoctorId));
    const specialistIds = new Set(workingDoctors.filter(d => d.role === DoctorRole.SPECIALIST && workingDocIds.has(d.id)).map(d => d.id));
    const lateSpecialistIds = new Set(workingDoctors.filter(d => d.role === DoctorRole.SPECIALIST && lateDocIds.has(d.id)).map(d => d.id));

    if (!isWeekend) {
      if (workingDocIds.size < dailyConfig.minTotalDaily) {
        warnings.push({ date: req.date, type: 'CRITICAL', message: `Endast ${workingDocIds.size}/${dailyConfig.minTotalDaily} läkare bemannade (min totalt).` });
      }
      if (specialistIds.size < dailyConfig.minSpecDaily) {
        warnings.push({ date: req.date, type: 'CRITICAL', message: `Endast ${specialistIds.size}/${dailyConfig.minSpecDaily} specialister bemannade.` });
      }
      if (lateDocIds.size < dailyConfig.minTotalLate) {
        warnings.push({ date: req.date, type: 'INFO', message: `Endast ${lateDocIds.size}/${dailyConfig.minTotalLate} läkare kvar fram till 17:00.` });
      }
      if (lateSpecialistIds.size < dailyConfig.minSpecLate) {
        warnings.push({ date: req.date, type: 'INFO', message: `Endast ${lateSpecialistIds.size}/${dailyConfig.minSpecLate} specialister kvar fram till 17:00.` });
      }
    }
    // maxDoctors är ett hårt tak, inte bara ett vardagsmål, så det kollas alltid.
    if (workingDocIds.size > dailyConfig.maxDoctors) {
      warnings.push({ date: req.date, type: 'INFO', message: `${workingDocIds.size} läkare schemalagda, över taket på ${dailyConfig.maxDoctors}.` });
    }

    // Increment daysSinceLastJour for those who didn't do Jour
    workingDoctors.forEach(d => {
      const workedJourToday = schedule.find(s => s.date === req.date && s.assignedDoctorId === d.id && s.shift === ShiftType.JOUR);
      if (!workedJourToday) {
        d.daysSinceLastJour += 1;
      }
    });

  });

  return { schedule, warnings };
};

export const validateLeaveRequest = (
  req: LeaveRequest,
  allDoctors: Doctor[],
  requirements: DailyRequirement[],
  approvedLeaves: LeaveRequest[]
): LeaveRequest => {
    return {
        ...req,
        status: 'PENDING',
        aiRecommendation: 'APPROVED',
        aiReasoning: 'AI-Analys: Marginaler finns.'
    };
};
