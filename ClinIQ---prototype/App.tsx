
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { MOCK_DOCTORS, generateRequirements, MOCK_STAFFING_CONFIG } from './mockData';
import { generateSchedule, validateLeaveRequest } from './schedulingLogic';
import { generateScheduleWithSolver } from './solverClient';
import { api, configToServer, requirementSignature, scheduleSignatures, syncSchedule } from './api';
import { useDebouncedEffect, createQueue } from './persistence';
import { GenerationResult, Doctor, LeaveRequest, ScheduleAssignment, ShiftType, DoctorRole, DailyRequirement, User, UserRole, ScheduleWarning, Period, ShiftColorConfig, StaffingConfig, RecurringTask, StaffingBaseCounts, StaffingDeviation, WorkDayConfig } from './types';
import { Button } from './components/Button';
import { Card } from './components/Card';
import { LeaveRequestForm } from './components/LeaveRequestForm';
import { 
  CalendarDaysIcon, 
  UserGroupIcon, 
  ChartBarIcon, 
  CheckCircleIcon, 
  XCircleIcon,
  InformationCircleIcon,
  AdjustmentsHorizontalIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  ArrowRightOnRectangleIcon,
  InboxStackIcon,
  PencilSquareIcon,
  TrashIcon,
  SparklesIcon,
  WrenchScrewdriverIcon,
  PlusIcon,
  UsersIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  HandThumbUpIcon,
  ScaleIcon,
  BeakerIcon,
  HeartIcon,
  TableCellsIcon,
  SwatchIcon,
  BriefcaseIcon,
  DocumentTextIcon,
  ClipboardDocumentCheckIcon,
  MinusIcon,
  Cog6ToothIcon,
  LockClosedIcon,
  BuildingLibraryIcon,
  KeyIcon
} from '@heroicons/react/24/outline';

// --- CONFIGURATION ---
const DEFAULT_COLORS: ShiftColorConfig = {
  [ShiftType.JOUR]: { bg: 'bg-green-700', text: 'text-white', border: 'border-green-800' }, 
  [ShiftType.BVC]: { bg: 'bg-orange-100', text: 'text-orange-900', border: 'border-orange-300' }, 
  [ShiftType.SABO]: { bg: 'bg-purple-100', text: 'text-purple-900', border: 'border-purple-300' }, 
  [ShiftType.OM]: { bg: 'bg-teal-100', text: 'text-teal-900', border: 'border-teal-300' },
  [ShiftType.ADMIN]: { bg: 'bg-yellow-100', text: 'text-yellow-900', border: 'border-yellow-300' },
  [ShiftType.MOTTAGNING]: { bg: 'bg-blue-100', text: 'text-blue-900', border: 'border-blue-300' },
  [ShiftType.STUDIES]: { bg: 'bg-lime-200', text: 'text-lime-900', border: 'border-lime-400' },
  [ShiftType.LEDIG]: { bg: 'bg-slate-100', text: 'text-slate-400', border: 'border-slate-300' },
  [ShiftType.SAKNAS]: { bg: 'bg-black', text: 'text-white', border: 'border-black' },
  [ShiftType.MEETING]: { bg: 'bg-indigo-600', text: 'text-white', border: 'border-indigo-800' },
};

// --- CONSTANTS ---
const TIME_START_HOUR = 7;
const TIME_END_HOUR = 18;
const PIXELS_PER_HOUR = 60; 

// --- HELPER FUNCTIONS ---

// Calculate ISO Week Number
const getWeekNumber = (d: Date) => {
    // Copy date so don't modify original
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    // Set to nearest Thursday: current date + 4 - current day number
    // Make Sunday's day number 7
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay()||7));
    // Get first day of year
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
    // Calculate full weeks to nearest Thursday
    const weekNo = Math.ceil(( ( (d.getTime() - yearStart.getTime()) / 86400000) + 1)/7);
    return weekNo;
};

// Map abstract periods to visual times for the timeline
const getVisualTimes = (period: Period, shift: ShiftType, isWeekend: boolean) => {
    // Default times
    let start = 8;
    let end = 12;

    if (period === 'FM') {
        start = 8;
        end = 12;
    } else {
        start = 13;
        end = 17;
    }

    // Special logic for Jour
    if (shift === ShiftType.JOUR) {
        if (period === 'EM') {
            start = 13; // Often Jour starts a bit earlier or goes later, but keeping 13-17 for simplicity in EM slot
            end = 17;
        }
    }
    
    // Meeting logic
    if (shift === ShiftType.MEETING) {
        start = 9.5; // 09:30
        end = 12.5; // 12:30
    }

    return { start, end };
};

const getRelativePosition = (startHour: number, endHour: number) => {
    const top = (startHour - TIME_START_HOUR) * PIXELS_PER_HOUR;
    const height = (endHour - startHour) * PIXELS_PER_HOUR;
    return { top, height };
};

const parseTimeStr = (timeStr: string) => {
    const [h, m] = timeStr.split(':').map(Number);
    return h + (m / 60);
};

const formatDecimalTime = (decimalTime: number) => {
    const hours = Math.floor(decimalTime);
    const minutes = Math.round((decimalTime - hours) * 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
};

// Calculate actual start/end time based on assigned shifts (Source of Truth for Day & Week view)
const calculateShiftRange = (assignments: ScheduleAssignment[], dateStr: string) => {
  if (!assignments.length) return "-";
  
  const date = new Date(dateStr);
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
  
  let minStart = 24;
  let maxEnd = 0;
  
  assignments.forEach(a => {
    const { start, end } = getVisualTimes(a.period, a.shift, isWeekend);
    if (start < minStart) minStart = start;
    if (end > maxEnd) maxEnd = end;
  });
  
  if (minStart === 24) return "-";
  
  return `${formatDecimalTime(minStart)} - ${formatDecimalTime(maxEnd)}`;
};

// --- SUB-COMPONENTS ---

const CollapsibleSection = ({ title, children, defaultOpen = false }: { title: string, children?: React.ReactNode, defaultOpen?: boolean }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    return (
        <Card className="!p-0 overflow-hidden">
            <button 
                onClick={() => setIsOpen(!isOpen)} 
                className="w-full flex items-center justify-between p-4 bg-slate-100 hover:bg-slate-200 transition-colors text-left"
            >
                <h3 className="text-xl font-extrabold text-slate-900">{title}</h3>
                {isOpen ? <ChevronUpIcon className="w-6 h-6 text-slate-600" /> : <ChevronDownIcon className="w-6 h-6 text-slate-600" />}
            </button>
            {isOpen && (
                <div className="p-6 border-t border-slate-200">
                    {children}
                </div>
            )}
        </Card>
    );
};

const ShiftBadge: React.FC<{ 
  type: ShiftType, 
  period: Period, 
  colors: ShiftColorConfig, 
  onClick?: () => void, 
  isInteractive?: boolean, 
  isManual?: boolean, 
  className?: string,
  taskName?: string // Specific name like "Vallon"
}> = ({ type, period, colors, onClick, isInteractive = true, isManual, className = '', taskName }) => {
  
  let style = colors[type] || DEFAULT_COLORS[ShiftType.MOTTAGNING];

  // Specific logic: Mottagning FM = Blue, EM = Red
  if (type === ShiftType.MOTTAGNING) {
      if (period === 'FM') {
          style = { bg: 'bg-blue-200', text: 'text-blue-900', border: 'border-blue-400' };
      } else {
          style = { bg: 'bg-red-200', text: 'text-red-900', border: 'border-red-400' };
      }
  }

  const displayText = taskName || (type === ShiftType.JOUR ? 'JOUR' : type);

  return (
    <div 
      onClick={isInteractive ? onClick : undefined}
      className={`relative text-xs font-bold px-2 py-1 rounded select-none flex items-center justify-center gap-1 shadow-sm ${style.bg} ${style.text} border ${style.border} ${isInteractive ? 'cursor-pointer hover:opacity-90 hover:scale-[1.01] transition-transform z-10 hover:z-20' : ''} ${className}`}
      title={isInteractive ? "Klicka för detaljer/ändra" : ""}
    >
      <span className="truncate text-center leading-tight">
        {displayText}
      </span>
      {isManual && <LockClosedIcon className="absolute top-0.5 right-0.5 w-2.5 h-2.5 opacity-60" title="Låst uppgift" />}
    </div>
  );
};

const NumberStepper = ({ 
  label, 
  value, 
  onChange, 
  min = 0, 
  max = 50, 
  subLabel 
}: { 
  label: string, 
  value: number, 
  onChange: (val: number) => void, 
  min?: number, 
  max?: number,
  subLabel?: string
}) => {
  return (
    <div className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg shadow-sm">
      <div className="flex flex-col">
        <span className="text-sm font-extrabold text-slate-700 uppercase">{label}</span>
        {subLabel && <span className="text-xs text-slate-500 font-bold">{subLabel}</span>}
      </div>
      <div className="flex items-center gap-3">
        <button onClick={() => onChange(Math.max(min, value - 1))} className="w-8 h-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 rounded text-slate-600 font-bold border border-slate-300 disabled:opacity-50" disabled={value <= min}>
          <MinusIcon className="w-4 h-4" />
        </button>
        <span className="text-xl font-extrabold text-slate-900 w-8 text-center">{value}</span>
        <button onClick={() => onChange(Math.min(max, value + 1))} className="w-8 h-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 rounded text-slate-600 font-bold border border-slate-300 disabled:opacity-50" disabled={value >= max}>
          <PlusIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

interface TaskAssignmentRowProps {
  task: RecurringTask;
  doctors: Doctor[];
  onUpdate: (updated: RecurringTask) => void;
}

const TaskAssignmentRow: React.FC<TaskAssignmentRowProps> = ({ 
  task, 
  doctors, 
  onUpdate 
}) => {
  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50 last:border-0">
      <td className="p-4 align-top">
        <div className="font-extrabold text-slate-800">{task.name}</div>
        <div className="flex flex-wrap gap-1 mt-1">{task.days.map(d => <span key={d} className="text-[10px] uppercase font-bold bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-100">{d}</span>)}</div>
        {task.notes && <div className="text-xs text-slate-500 italic mt-1">{task.notes}</div>}
      </td>
      <td className="p-4 align-top">
        <select 
          className="w-full p-2 border border-slate-300 rounded text-sm font-bold bg-white focus:ring-2 focus:ring-primary outline-none"
          value={task.assignedDoctorId}
          onChange={(e) => onUpdate({...task, assignedDoctorId: e.target.value})}
        >
          <option value="UNASSIGNED">-- Välj Resurs (Lås) --</option>
          {doctors.map(d => <option key={d.id} value={d.id}>{d.name} ({d.role})</option>)}
        </select>
      </td>
      <td className="p-4 align-top">
         <div className="flex flex-col gap-2">
           <div className="flex items-center gap-2">
             <span className="text-[10px] font-bold text-slate-400 w-4">1:a</span>
             <select 
              className="w-full p-2 border border-slate-300 rounded text-xs font-bold bg-slate-50"
              value={task.backup1DoctorId}
              onChange={(e) => onUpdate({...task, backup1DoctorId: e.target.value})}
             >
              <option value="UNASSIGNED">-- Välj Ersättare --</option>
              <option value="CANCEL" className="text-red-600">Vid frånvaro: INSTÄLLS</option>
              {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
           </div>
           <div className="flex items-center gap-2">
             <span className="text-[10px] font-bold text-slate-400 w-4">2:a</span>
             <select 
              className="w-full p-2 border border-slate-300 rounded text-xs font-bold bg-slate-50"
              value={task.backup2DoctorId}
              onChange={(e) => onUpdate({...task, backup2DoctorId: e.target.value})}
             >
              <option value="UNASSIGNED">-- Välj Ersättare --</option>
              <option value="CANCEL" className="text-red-600">Vid frånvaro: INSTÄLLS</option>
              {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
           </div>
         </div>
      </td>
    </tr>
  );
};

// --- AI EXPLANATION VIEWER COMPONENT ---
interface ExplanationData {
  summary: string;
  score: number;
  factors: { label: string; text: string; positive: boolean }[];
  details: string[];
}

const AIExplanationViewer = ({ explanationStr }: { explanationStr: string }) => {
  const [showDetails, setShowDetails] = useState(false);

  let data: ExplanationData | null = null;
  let isLegacy = false;

  try {
    if (explanationStr.trim().startsWith('{')) {
      data = JSON.parse(explanationStr);
    } else {
      isLegacy = true;
    }
  } catch (e) {
    isLegacy = true;
  }

  if (isLegacy || !data) {
    return (
      <div className="bg-slate-50 p-4 rounded-lg border-2 border-slate-300 font-bold text-slate-800 text-lg italic">
        "{explanationStr}"
      </div>
    );
  }
  
  return (
    <div className="bg-white border-2 border-slate-300 rounded-xl overflow-hidden shadow-sm">
      <div className="p-4 bg-slate-50 border-b-2 border-slate-200">
        <div className="flex items-start gap-3">
            <SparklesIcon className="w-6 h-6 text-primary mt-0.5 flex-shrink-0" />
            <div>
                <p className="text-slate-900 font-extrabold text-lg leading-tight mb-2">
                    {data.summary}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                    <div className="bg-slate-900 text-white px-3 py-1 rounded font-mono font-extrabold text-xl">
                        {data.score}
                    </div>
                    <p className="text-sm font-bold text-slate-600 italic">
                        (lägre poäng = större chans att bli vald)
                    </p>
                </div>
            </div>
        </div>
      </div>

      <div className="bg-white">
        <button 
          onClick={() => setShowDetails(!showDetails)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors border-t-2 border-transparent hover:border-slate-200"
        >
          <span>{showDetails ? 'Dölj analysdetaljer' : 'Visa analysdetaljer'}</span>
          {showDetails ? <ChevronUpIcon className="w-4 h-4" /> : <ChevronDownIcon className="w-4 h-4" />}
        </button>

        {showDetails && (
          <div className="p-4 bg-slate-50 space-y-3 border-t-2 border-slate-200 animate-in slide-in-from-top-2">
             {data.factors.length > 0 && (
                <div className="grid gap-2">
                    {data.factors.map((f, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm">
                             <div className={`w-2 h-2 rounded-full ${f.positive ? 'bg-green-600' : 'bg-amber-600'}`}></div>
                             <span className="font-extrabold text-slate-700 uppercase">{f.label}:</span>
                             <span className="text-slate-700 font-bold">{f.text}</span>
                        </div>
                    ))}
                </div>
             )}
             {data.details.length > 0 && (
                <div className="mt-3 pt-3 border-t-2 border-slate-300">
                    <p className="text-xs font-extrabold text-slate-500 uppercase mb-1">Beräkningslogg:</p>
                    <div className="flex flex-wrap gap-2">
                        {data.details.map((d, i) => (
                            <span key={i} className="text-xs font-bold bg-white border border-slate-300 px-1.5 py-0.5 rounded text-slate-600 font-mono">
                                {d}
                            </span>
                        ))}
                    </div>
                </div>
             )}
          </div>
        )}
      </div>
    </div>
  );
};

// --- MODALS ---
const DoctorModal = ({ doctor, onSave, onClose }: { doctor?: Doctor, onSave: (d: Doctor) => void, onClose: () => void }) => {
  const [name, setName] = useState(doctor?.name || '');
  const [role, setRole] = useState<DoctorRole>(doctor?.role || DoctorRole.SPECIALIST);
  const [competence, setCompetence] = useState<ShiftType[]>(doctor?.competence || [ShiftType.MOTTAGNING]);
  const [fte, setFte] = useState(doctor?.fte || 100);
  
  // Schedule state initialization
  const [baseSchedule, setBaseSchedule] = useState<WorkDayConfig[]>(
    doctor?.baseSchedule || [
        { dayIndex: 1, start: "08:00", end: "17:00", isOff: false },
        { dayIndex: 2, start: "08:00", end: "17:00", isOff: false },
        { dayIndex: 3, start: "08:00", end: "17:00", isOff: false },
        { dayIndex: 4, start: "08:00", end: "17:00", isOff: false },
        { dayIndex: 5, start: "08:00", end: "17:00", isOff: false },
        { dayIndex: 6, start: "00:00", end: "00:00", isOff: true },
        { dayIndex: 0, start: "00:00", end: "00:00", isOff: true },
    ]
  );
  
  const toggleCompetence = (type: ShiftType) => {
    setCompetence(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]);
  };

  const updateDayConfig = (dayIndex: number, field: keyof WorkDayConfig, value: any) => {
      setBaseSchedule(prev => prev.map(d => {
          if (d.dayIndex === dayIndex) {
              return { ...d, [field]: value };
          }
          return d;
      }));
  };

  const handleSubmit = () => {
    if (!name.trim()) return;
    const newDoc: Doctor = {
      id: doctor?.id || Math.random().toString(36).substr(2, 9),
      name,
      role,
      competence,
      fte,
      baseSchedule,
      accumulatedFatigue: doctor?.accumulatedFatigue || 0,
      daysSinceLastJour: doctor?.daysSinceLastJour || 14,
      contractPercentage: fte,
      workingHoursDescription: "Enligt schema", // Calculated
      defaultEndTime: "17:00", 
      preferences: doctor?.preferences || []
    };
    onSave(newDoc);
  };

  const availableShifts = Object.values(ShiftType).filter(t => t !== ShiftType.SAKNAS && t !== ShiftType.LEDIG);
  const weekDays = ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag"];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full p-6 shadow-2xl border-2 border-slate-300 max-h-[90vh] overflow-y-auto">
        <h3 className="text-2xl font-extrabold mb-4 text-slate-900">{doctor ? 'Redigera Läkare' : 'Lägg till Läkare'}</h3>
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-base font-bold text-slate-800 mb-1">Namn</label>
                <input type="text" className="w-full p-3 border-2 border-slate-300 rounded focus:ring-2 focus:ring-primary outline-none font-bold bg-white text-slate-900" value={name} onChange={e => setName(e.target.value)} placeholder="Förnamn Efternamn" />
              </div>
              <div>
                <label className="block text-base font-bold text-slate-800 mb-1">Roll</label>
                <select className="w-full p-3 border-2 border-slate-300 rounded font-bold bg-white text-slate-900" value={role} onChange={e => setRole(e.target.value as DoctorRole)}>
                {Object.values(DoctorRole).map(r => <option key={r} value={r}>{r}</option>)}
                </select>
             </div>
          </div>
          
          <div>
             <label className="block text-base font-bold text-slate-800 mb-1">Tjänstgöringsgrad (%)</label>
             <div className="flex items-center gap-4">
                 <input type="range" min="0" max="100" step="5" value={fte} onChange={e => setFte(parseInt(e.target.value))} className="flex-1 accent-primary h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer"/>
                 <span className="font-extrabold text-xl w-16 text-center">{fte}%</span>
             </div>
          </div>

          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
             <h4 className="font-extrabold text-slate-800 mb-2">Grundschema (Arbetstider)</h4>
             <div className="space-y-2">
                 {weekDays.map((day, idx) => {
                     const dayIndex = idx + 1; // 1=Mon
                     const config = baseSchedule.find(d => d.dayIndex === dayIndex) || { dayIndex, start: "08:00", end: "17:00", isOff: false };
                     return (
                         <div key={day} className="flex items-center gap-2">
                             <div className="w-24 font-bold text-slate-700">{day}</div>
                             <div className="flex items-center gap-2 flex-1">
                                 <input type="checkbox" checked={config.isOff} onChange={(e) => updateDayConfig(dayIndex, 'isOff', e.target.checked)} className="w-4 h-4 accent-red-500" />
                                 <span className="text-sm font-bold text-slate-500 w-12">{config.isOff ? "Ledig" : "Jobbar"}</span>
                                 {!config.isOff && (
                                     <>
                                        <input type="time" value={config.start} onChange={(e) => updateDayConfig(dayIndex, 'start', e.target.value)} className="p-1 border border-slate-300 rounded font-bold bg-white text-slate-900" />
                                        <span>-</span>
                                        <input type="time" value={config.end} onChange={(e) => updateDayConfig(dayIndex, 'end', e.target.value)} className="p-1 border border-slate-300 rounded font-bold bg-white text-slate-900" />
                                     </>
                                 )}
                             </div>
                         </div>
                     );
                 })}
             </div>
          </div>

          <div>
            <label className="block text-base font-bold text-slate-800 mb-2">Kompetens</label>
            <div className="grid grid-cols-2 gap-2">
              {availableShifts.map(type => (
                <label key={type} className="flex items-center gap-2 text-base font-bold text-slate-800 cursor-pointer hover:bg-slate-100 p-2 rounded border border-slate-200">
                  <input type="checkbox" checked={competence.includes(type)} onChange={() => toggleCompetence(type)} className="w-4 h-4 rounded text-primary focus:ring-primary" />
                  {type}
                </label>
              ))}
            </div>
          </div>
          <div className="pt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} className="font-bold">Avbryt</Button>
            <Button onClick={handleSubmit} className="font-bold">{doctor ? 'Spara ändringar' : 'Lägg till'}</Button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ColorConfigModal = ({ colors, onSave, onClose }: { colors: ShiftColorConfig, onSave: (c: ShiftColorConfig) => void, onClose: () => void }) => {
    const [localColors, setLocalColors] = useState<ShiftColorConfig>(colors);
    const bgMap: Record<string, string> = { 'bg-slate-100': 'Grå (Ljus)', 'bg-red-100': 'Röd (Ljus)', 'bg-green-700': 'Militärgrön', 'bg-blue-100': 'Blå (Ljus)', 'bg-yellow-100': 'Gul (Ljus)', 'bg-purple-100': 'Lila (Ljus)', 'bg-amber-200': 'Aprikos', 'bg-pink-100': 'Rosa', 'bg-lime-200': 'Lime', 'bg-black': 'Svart', 'bg-blue-200': 'Blå (Medel)', 'bg-red-200': 'Röd (Medel)', 'bg-indigo-600': 'Indigo', 'bg-teal-100': 'Teal', 'bg-orange-100': 'Orange' };
    const textMap: Record<string, string> = { 'text-slate-900': 'Svart', 'text-white': 'Vit', 'text-red-900': 'Mörkröd', 'text-blue-900': 'Mörkblå', 'text-amber-900': 'Brun', 'text-lime-900': 'Mörkgrön', 'text-yellow-900': 'Mörkgul', 'text-slate-400': 'Grå', 'text-purple-900': 'Mörklila', 'text-teal-900': 'Mörkteal', 'text-orange-900': 'Mörkorange' };
    const bgOptions = Object.keys(bgMap);
    Object.values(localColors).forEach((c: any) => { if (!bgOptions.includes(c.bg)) bgOptions.push(c.bg); });
    const textOptions = Object.keys(textMap);

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl max-w-2xl w-full p-6 shadow-2xl border-2 border-slate-300 max-h-[90vh] overflow-y-auto">
                <h3 className="text-2xl font-extrabold mb-4 text-slate-900">Konfigurera Färger</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {Object.entries(localColors).map(([shiftKey, configVal]) => {
                        const shift = shiftKey as ShiftType;
                        const config = configVal as { bg: string; text: string; border: string };
                        return (
                        <div key={shift} className="p-3 border border-slate-200 rounded">
                             <div className="flex items-center justify-between mb-2">
                                 <span className="font-bold">{shift}</span>
                                 <div className={`px-2 py-1 rounded text-xs ${config.bg} ${config.text} border ${config.border}`}>Förhandsgranskning</div>
                             </div>
                             <label className="block text-xs font-bold mb-1 text-slate-700">Bakgrund</label>
                             <select value={config.bg} onChange={(e) => setLocalColors(prev => ({ ...prev, [shift]: { ...config, bg: e.target.value } }))} className="w-full p-2 border-2 border-slate-300 rounded mb-2 text-sm bg-white text-slate-900 font-bold outline-none">{bgOptions.map(bg => <option key={bg} value={bg}>{bgMap[bg] || bg}</option>)}</select>
                             <label className="block text-xs font-bold mb-1 text-slate-700">Textfärg</label>
                             <select value={config.text} onChange={(e) => setLocalColors(prev => ({ ...prev, [shift]: { ...config, text: e.target.value } }))} className="w-full p-2 border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-bold outline-none">{textOptions.map(t => <option key={t} value={t}>{textMap[t] || t}</option>)}</select>
                        </div>
                    )})}
                </div>
                <div className="pt-6 flex justify-end gap-2">
                    <Button variant="secondary" onClick={onClose}>Avbryt</Button>
                    <Button onClick={() => onSave(localColors)}>Spara färger</Button>
                </div>
            </div>
        </div>
    );
};

const AdminShiftModal = ({ doctor, date, period, currentAssignment, onSave, onClose }: { doctor: Doctor, date: string, period: Period, currentAssignment?: ScheduleAssignment, onSave: (type: ShiftType | 'CLEAR', period: Period) => void, onClose: () => void }) => {
  const [activeTab, setActiveTab] = useState<'ANALYSIS' | 'EDIT'>('ANALYSIS');
  const [selectedType, setSelectedType] = useState<ShiftType | 'CLEAR'>(currentAssignment?.shift || ShiftType.MOTTAGNING);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-md w-full overflow-hidden shadow-2xl flex flex-col max-h-[90vh] border-2 border-slate-300">
        <div className="bg-slate-100 p-4 border-b-2 border-slate-300">
           <h3 className="text-xl font-extrabold text-slate-900">{date} ({period})</h3>
           <p className="text-slate-600 font-bold text-lg">{doctor.name}</p>
        </div>
        <div className="flex border-b-2 border-slate-300">
          <button onClick={() => setActiveTab('ANALYSIS')} className={`flex-1 p-3 text-base font-bold flex items-center justify-center gap-2 transition-colors ${activeTab === 'ANALYSIS' ? 'text-primary border-b-4 border-primary bg-sky-50' : 'text-slate-600 hover:bg-slate-100'}`}><SparklesIcon className="w-5 h-5" /> AI-Analys</button>
          <button onClick={() => setActiveTab('EDIT')} className={`flex-1 p-3 text-base font-bold flex items-center justify-center gap-2 transition-colors ${activeTab === 'EDIT' ? 'text-primary border-b-4 border-primary bg-sky-50' : 'text-slate-600 hover:bg-slate-100'}`}><WrenchScrewdriverIcon className="w-5 h-5" /> Manuell Justering</button>
        </div>
        <div className="p-6 overflow-y-auto bg-slate-50/50">
          {activeTab === 'ANALYSIS' && (
            <div className="space-y-4 animate-in fade-in duration-300">
               {currentAssignment ? (
                  <>
                    {currentAssignment.shift === ShiftType.JOUR ? ( <AIExplanationViewer explanationStr={currentAssignment.aiExplanation} /> ) : (
                      <div className="p-8 text-center bg-white rounded border-2 border-slate-200 shadow-sm"><InformationCircleIcon className="w-12 h-12 text-slate-400 mx-auto mb-2" /><p className="text-slate-600 text-base font-bold">Ingen fördjupad AI-analys tillgänglig för bastjänstgöring.</p></div>
                    )}
                    {currentAssignment.isManual && ( <div className="flex items-center gap-2 text-sm font-bold text-blue-700 bg-blue-50 p-3 rounded border border-blue-200 mt-4"><InformationCircleIcon className="w-5 h-5" /><span>Detta pass har ändrats manuellt av admin.</span></div> )}
                  </>
               ) : ( <div className="text-center py-8 text-slate-500"><SparklesIcon className="w-14 h-14 mx-auto mb-2 opacity-50" /><p className="font-bold text-lg">Inget pass tilldelat av AI.</p></div> )}
            </div>
          )}
          {activeTab === 'EDIT' && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <div>
                <label className="block text-base font-bold text-slate-800 mb-2">Välj passtyp:</label>
                <select className="w-full p-3 border-2 border-slate-300 rounded bg-white focus:ring-2 focus:ring-primary outline-none font-bold text-lg" value={selectedType} onChange={(e) => setSelectedType(e.target.value as ShiftType | 'CLEAR')}>
                  {Object.values(ShiftType).filter(t => t !== ShiftType.SAKNAS && t !== ShiftType.LEDIG).map(t => ( <option key={t} value={t}>{t}</option> ))}
                  <option value="CLEAR" className="text-red-600 font-extrabold">(Ta bort pass)</option>
                </select>
              </div>
              <div className="bg-amber-50 p-4 rounded text-amber-900 text-sm font-bold flex gap-2 border border-amber-200"><ExclamationTriangleIcon className="w-6 h-6 flex-shrink-0" /><p>Ändringar uppdaterar schemat direkt.</p></div>
            </div>
          )}
        </div>
        <div className="p-4 border-t-2 border-slate-200 bg-white flex justify-end gap-2">
           <Button variant="secondary" onClick={onClose} className="font-bold">Stäng</Button>
           {activeTab === 'EDIT' && ( <Button variant={selectedType === 'CLEAR' ? 'danger' : 'primary'} onClick={() => onSave(selectedType, period)} className="font-bold">{selectedType === 'CLEAR' ? 'Radera pass' : 'Spara ändring'}</Button> )}
        </div>
      </div>
    </div>
  );
};

const ExplainabilityModal = ({ assignment, doctor, onClose }: { assignment: ScheduleAssignment, doctor: Doctor, onClose: () => void }) => {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-2xl border-2 border-slate-300">
        <div className="flex items-center justify-between mb-6 border-b border-slate-100 pb-4">
            <div>
                <h3 className="text-2xl font-extrabold text-slate-900">Detaljerad Analys</h3>
                <p className="text-slate-500 font-bold text-sm mt-1">{doctor.name} • {assignment.date} ({assignment.period})</p>
            </div>
            {assignment.isManual && (
                <span className="bg-blue-100 text-blue-800 text-xs font-extrabold px-2 py-1 rounded border border-blue-200 uppercase tracking-wide">
                    Manuellt Val
                </span>
            )}
        </div>
        
        <div className="space-y-4">
             <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                <span className="text-xs font-extrabold text-slate-400 uppercase tracking-wider mb-2 block">Tilldelat Pass</span>
                <div className="flex items-center gap-3">
                    <span className="text-2xl font-extrabold text-slate-800">{assignment.shift}</span>
                </div>
             </div>

             <div>
                <span className="text-xs font-extrabold text-slate-400 uppercase tracking-wider mb-2 block">Beslutsunderlag (AI)</span>
                <AIExplanationViewer explanationStr={assignment.aiExplanation} />
             </div>
        </div>

        <div className="flex justify-end mt-8 pt-4 border-t border-slate-100">
          <Button variant="secondary" onClick={onClose} className="font-bold w-full sm:w-auto">Stäng fönster</Button>
        </div>
      </div>
    </div>
  );
};

// --- GLOBAL AUTH SCREEN ---
const GlobalAuthScreen = ({ onAuthenticated }: { onAuthenticated: () => void }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === 'ptj123') {
      onAuthenticated();
    } else {
      setError(true);
      setPassword('');
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-2xl border-2 border-slate-300 p-8 animate-in fade-in duration-500">
        <div className="flex flex-col items-center justify-center mb-6 gap-3">
          <div className="p-4 bg-slate-50 rounded-full border-2 border-slate-200">
            <LockClosedIcon className="w-10 h-10 text-slate-700" />
          </div>
          <h1 className="text-3xl font-extrabold text-slate-900">ClinIQ</h1>
          <p className="text-slate-500 font-bold text-sm">Systemet är låst</p>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
             <label className="block text-sm font-bold text-slate-700 mb-1">Ange lösenord</label>
             <div className="relative">
                <input 
                  type="password" 
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(false); }}
                  className={`w-full p-4 border-2 rounded-lg font-bold outline-none transition-all ${error ? 'border-red-500 bg-red-50 text-red-900' : 'bg-white text-slate-900 border-slate-300 focus:border-primary focus:ring-4 focus:ring-primary/10'}`}
                  placeholder="••••••"
                  autoFocus
                />
             </div>
             {error && <p className="text-red-600 font-extrabold text-sm mt-2 flex items-center gap-1 animate-in slide-in-from-top-1"><XCircleIcon className="w-4 h-4"/> Felaktigt lösenord</p>}
          </div>
          <button type="submit" className="w-full bg-slate-900 text-white font-extrabold text-lg py-4 rounded-lg hover:bg-slate-800 transition-colors shadow-lg">
            Lås upp systemet
          </button>
        </form>
      </div>
    </div>
  );
};

const LoginScreen = ({ onLogin, doctors }: { onLogin: (user: User) => void; doctors: Doctor[] }) => {
  // Läkarinloggningen är en prototyp: den loggar in som "Anna Andersson" om hon finns, annars första specialisten.
  const demoDoctor = doctors.find(d => d.name === 'Anna Andersson') ?? doctors.find(d => d.role === DoctorRole.SPECIALIST) ?? doctors[0];
  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-2xl border-2 border-slate-300 p-8 animate-in fade-in duration-300">
        <div className="flex items-center justify-center mb-8 gap-2">
          <h1 className="text-4xl font-extrabold text-slate-900">ClinIQ</h1>
        </div>
        <p className="text-center text-slate-600 font-bold text-lg mb-8">Välj roll för att logga in i prototypen</p>
        <div className="space-y-4">
          <button onClick={() => onLogin({ id: 'admin1', name: 'Anna Svensson', role: UserRole.ADMIN })} className="w-full p-5 border-2 border-slate-200 rounded-xl flex items-center gap-4 hover:border-primary hover:bg-sky-50 transition-all group shadow-sm hover:shadow-md">
            <div className="bg-slate-100 p-3 rounded-full group-hover:bg-white border border-slate-200"><ChartBarIcon className="w-7 h-7 text-slate-700 group-hover:text-primary" /></div>
            <div className="text-left"><p className="font-extrabold text-slate-900 text-lg">Admin</p><p className="text-sm font-bold text-slate-500">Hantera behov och generera schema</p></div>
          </button>
          <button disabled={!demoDoctor} onClick={() => demoDoctor && onLogin({ id: 'doc-' + demoDoctor.id, name: demoDoctor.name, role: UserRole.DOCTOR, doctorId: demoDoctor.id })} className="w-full p-5 border-2 border-slate-200 rounded-xl flex items-center gap-4 hover:border-success hover:bg-green-50 transition-all group shadow-sm hover:shadow-md">
            <div className="bg-slate-100 p-3 rounded-full group-hover:bg-white border border-slate-200"><UserGroupIcon className="w-7 h-7 text-slate-700 group-hover:text-success" /></div>
            <div className="text-left"><p className="font-extrabold text-slate-900 text-lg">Läkare</p><p className="text-sm font-bold text-slate-500">Ansök om ledighet och se tider</p></div>
          </button>
        </div>
      </div>
    </div>
  );
};

// Exempelledigheter som bara används i demoläge (utan databas).
const buildDemoLeaves = (startDate: Date): LeaveRequest[] => {
  const mockLeaves: LeaveRequest[] = [];
  const d = new Date(startDate);
  d.setDate(d.getDate() + 1);
  const dateStr1 = d.toISOString().split('T')[0];
  if (MOCK_DOCTORS.length > 2) {
    mockLeaves.push({ id: 'mock_1', doctorId: MOCK_DOCTORS[1].id, date: dateStr1, reason: 'Tandläkare', status: 'APPROVED' });
    const d2 = new Date(startDate);
    d2.setDate(d2.getDate() + 3);
    mockLeaves.push({ id: 'mock_2', doctorId: MOCK_DOCTORS[2].id, date: d2.toISOString().split('T')[0], reason: 'VAB', status: 'APPROVED' });
  }
  return mockLeaves;
};

// Dagskrav sparade i databasen kan vara skapade med fel veckodag (äldre seed-script).
// Hellre ett nytt standardkrav än ett helgkrav på en fredag: kontrollera att strukturen stämmer.
const isConsistentRequirement = (r: DailyRequirement) => {
  const weekday = new Date(`${r.date}T12:00:00Z`).getUTCDay();
  const keys = Object.keys(r.requiredShifts);
  return weekday === 0 || weekday === 6 ? keys.every(k => k === ShiftType.JOUR) : keys.includes(ShiftType.MOTTAGNING);
};

const DataStatusScreen = ({ title, detail, onRetry, onDemo }: { title: string; detail?: string; onRetry?: () => void; onDemo?: () => void }) => (
  <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
    <div className="max-w-lg w-full bg-white rounded-xl shadow-2xl border-2 border-slate-300 p-8">
      <h1 className="text-3xl font-extrabold text-slate-900 mb-4">ClinIQ</h1>
      <p className="font-bold text-slate-800 text-lg">{title}</p>
      {detail && <p className="mt-3 text-sm font-bold text-red-700 bg-red-50 border border-red-200 rounded p-3 break-words">{detail}</p>}
      {(onRetry || onDemo) && (
        <div className="mt-6 flex flex-col gap-3">
          {onRetry && <button onClick={onRetry} className="w-full p-3 rounded-lg bg-primary text-white font-extrabold hover:opacity-90">Försök igen</button>}
          {onDemo && <button onClick={onDemo} className="w-full p-3 rounded-lg border-2 border-slate-300 text-slate-700 font-extrabold hover:bg-slate-50">Fortsätt i demoläge (ingenting sparas)</button>}
        </div>
      )}
    </div>
  </div>
);

const App = () => {
  // State
  const [isAppAuthenticated, setIsAppAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [view, setView] = useState<'admin' | 'doctor-schedule' | 'doctor-dashboard' | 'schedule' | 'admin-leaves' | 'admin-doctors'>('admin');
  const [scheduleViewMode, setScheduleViewMode] = useState<'WEEK' | 'DAY'>('DAY'); 
  const [currentDayIndex, setCurrentDayIndex] = useState(0); 
  
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [startDate] = useState(() => {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
  });
  const [requirements, setRequirements] = useState<DailyRequirement[]>([]);
  const [staffingConfig, setStaffingConfig] = useState<StaffingConfig>(MOCK_STAFFING_CONFIG);
  const [schedule, setSchedule] = useState<ScheduleAssignment[]>([]);
  const [generationWarnings, setGenerationWarnings] = useState<ScheduleWarning[]>([]);
  
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);

  const [selectedLeaveDate, setSelectedLeaveDate] = useState('');

  const [isGenerating, setIsGenerating] = useState(false);
  const [currentWeekIndex, setCurrentWeekIndex] = useState(0);
  const [colors, setColors] = useState<ShiftColorConfig>(DEFAULT_COLORS);
  
  // Modal States
  const [selectedAssignment, setSelectedAssignment] = useState<{a: ScheduleAssignment, d: Doctor} | null>(null);
  const [editModalData, setEditModalData] = useState<{d: Doctor, date: string, period: Period, a?: ScheduleAssignment} | null>(null);
  const [doctorModalData, setDoctorModalData] = useState<{ isOpen: boolean, doctor?: Doctor }>({ isOpen: false });
  const [isColorModalOpen, setIsColorModalOpen] = useState(false);
  const [isApplyingForLeave, setIsApplyingForLeave] = useState(false);

  // --- Databas ---------------------------------------------------------------
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [demoMode, setDemoMode] = useState(false);          // true = ingen databas, inget sparas
  const [saveError, setSaveError] = useState('');
  const [enqueue] = useState(() => createQueue());          // alla skrivningar körs i ordning
  const lastSchedule = useRef<Map<string, string>>(new Map());      // vad som redan är sparat
  const lastRequirements = useRef<Map<string, string>>(new Map());
  const lastConfig = useRef('');
  const persistEnabled = loadState === 'ready' && !demoMode;

  const queueSave = (task: () => Promise<unknown>) => {
    if (!persistEnabled) return;
    enqueue(task, e => {
      console.error('Kunde inte spara', e);
      setSaveError(e instanceof Error ? e.message : String(e));
    });
  };

  const loadFromDatabase = async () => {
    setLoadState('loading');
    setLoadError('');
    try {
      const [dbDoctors, dbLeaves, dbReqs, dbConfig, dbSchedule] = await Promise.all([
        api.fetchDoctors(), api.fetchLeaves(), api.fetchRequirements(), api.fetchStaffingConfig(), api.fetchSchedule(),
      ]);

      // Dagskrav: det som sparats i databasen gäller, saknade dagar fylls med standardkrav (och sparas sedan automatiskt).
      const generated = generateRequirements(startDate);
      const horizon = new Set(generated.map(g => g.date));
      const fromDb = new Map(dbReqs.filter(isConsistentRequirement).map(r => [r.date, r] as const));
      const reqs = generated.map(g => fromDb.get(g.date) ?? g);
      lastRequirements.current = new Map([...fromDb].filter(([d]) => horizon.has(d)).map(([d, r]) => [d, requirementSignature(r)]));

      // Konfiguration: finns ingen än startar vi från standardvärdena (utan mockläkare) och sparar dem.
      const validIds = new Set(dbDoctors.map(d => d.id));
      const freshConfig: StaffingConfig = {
        ...MOCK_STAFFING_CONFIG,
        recurringTasks: MOCK_STAFFING_CONFIG.recurringTasks.map(t => ({ ...t, assignedDoctorId: 'UNASSIGNED', backup1DoctorId: 'UNASSIGNED', backup2DoctorId: 'UNASSIGNED' })),
      };
      const config = dbConfig ?? freshConfig;
      lastConfig.current = dbConfig ? JSON.stringify(configToServer(dbConfig, validIds)) : '';

      const horizonSchedule = dbSchedule.filter(a => horizon.has(a.date));
      lastSchedule.current = scheduleSignatures(horizonSchedule);

      setDoctors(dbDoctors);
      setLeaves(dbLeaves);
      setRequirements(reqs);
      setStaffingConfig(config);
      setSchedule(horizonSchedule);
      setSelectedLeaveDate(reqs[0]?.date ?? '');
      setLoadState('ready');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      setLoadState('error');
    }
  };

  const startDemoMode = () => {
    const reqs = generateRequirements(startDate);
    setDemoMode(true);
    setDoctors(MOCK_DOCTORS);
    setRequirements(reqs);
    setStaffingConfig(MOCK_STAFFING_CONFIG);
    setLeaves(buildDemoLeaves(startDate));
    setSchedule([]);
    setSelectedLeaveDate(reqs[0]?.date ?? '');
    setLoadState('ready');
  };

  // Hämta all data direkt efter appens lösenordsinloggning.
  useEffect(() => {
    if (isAppAuthenticated && !demoMode) loadFromDatabase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAppAuthenticated]);

  // Spara ändringar automatiskt en kort stund efter att de gjorts.
  useDebouncedEffect(() => {
    queueSave(async () => {
      const payload = configToServer(staffingConfig, new Set(doctors.map(d => d.id)));
      const serialized = JSON.stringify(payload);
      if (serialized === lastConfig.current) return;
      await api.saveStaffingConfig(payload);
      lastConfig.current = serialized;
    });
  }, [staffingConfig, doctors], 800, persistEnabled);

  useDebouncedEffect(() => {
    queueSave(async () => {
      const changed = requirements.filter(r => lastRequirements.current.get(r.date) !== requirementSignature(r));
      if (!changed.length) return;
      await api.saveRequirements(changed);
      changed.forEach(r => lastRequirements.current.set(r.date, requirementSignature(r)));
    });
  }, [requirements], 600, persistEnabled);

  useDebouncedEffect(() => {
    queueSave(async () => {
      lastSchedule.current = await syncSchedule(schedule, lastSchedule.current);
    });
  }, [schedule], 700, persistEnabled);

  // Stats
  const stats = useMemo(() => {
    const heavyShifts = doctors.map(d => ({
      name: d.name,
      count: schedule.filter(s => s.assignedDoctorId === d.id && s.shift === ShiftType.JOUR).length,
      role: d.role
    })).sort((a,b) => b.count - a.count);
    return { heavyShifts };
  }, [schedule, doctors]);

  const handleLogin = (user: User) => {
    setCurrentUser(user);
    if (user.role === UserRole.ADMIN) {
      setView('admin');
      setScheduleViewMode('DAY');
    } else {
      setView('doctor-schedule'); // Default view for doctors
      setScheduleViewMode('WEEK');
    }
  };

  const handleLogout = () => { setCurrentUser(null); };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setGenerationWarnings([]);

    let result: GenerationResult;
    try {
      // Primärt: OR-Tools (CP-SAT) i optimeringstjänsten under solver/.
      result = await generateScheduleWithSolver(doctors, requirements, leaves, staffingConfig);
    } catch (err) {
      // Reserv: den enklare logiken som körs direkt i webbläsaren, så appen fungerar även
      // när solver-tjänsten inte är igång. Det visas tydligt bland varningarna.
      console.warn('OR-Tools-solvern kunde inte nås, använder reservlogiken i webbläsaren.', err);
      const fallback = generateSchedule(doctors, requirements, leaves, staffingConfig);
      result = {
        schedule: fallback.schedule,
        warnings: [
          { date: 'Info', type: 'INFO', message: 'Optimeringstjänsten (OR-Tools) svarade inte - schemat skapades med den enklare reservlogiken. Starta solver/ för bästa resultat.' },
          ...fallback.warnings,
        ],
      };
    }

    setSchedule(result.schedule);
    setGenerationWarnings(result.warnings);
    setIsGenerating(false);
    if (result.warnings.length === 0) {
      setView('schedule');
      setScheduleViewMode('DAY');
    }
  };

  const handleLeaveRequest = (docId: string, date: string, reason: string) => {
    const request: LeaveRequest = { id: Math.random().toString(36), doctorId: docId, date, reason, status: 'PENDING' };
    const validated = validateLeaveRequest(request, doctors, requirements, leaves);
    setLeaves([...leaves, validated]);
    queueSave(() => api.createLeave(validated));
  };

  const handleLeaveSubmission = (requests: LeaveRequest[]) => {
    const validatedRequests = requests.map(req => validateLeaveRequest(req, doctors, requirements, leaves));
    setLeaves(prev => [...prev, ...validatedRequests]);
    validatedRequests.forEach(v => queueSave(() => api.createLeave(v)));
    setIsApplyingForLeave(false);
  };

  const handleAdminLeaveAction = (requestId: string, action: 'APPROVED' | 'DENIED') => {
      setLeaves(prev => prev.map(l => l.id === requestId ? { ...l, status: action } : l));
      queueSave(() => api.setLeaveStatus(requestId, action));
  };

  const handleCellClick = (doctor: Doctor, date: string, period: Period, assignment?: ScheduleAssignment) => {
    if (currentUser?.role === UserRole.ADMIN) {
      setEditModalData({ d: doctor, date, period, a: assignment });
    } else {
      if (assignment) setSelectedAssignment({ a: assignment, d: doctor });
    }
  };

  const handleManualSave = (type: ShiftType | 'CLEAR', period: Period) => {
    if (!editModalData) return;
    const { d, date, a } = editModalData;
    setSchedule(prev => {
      const filtered = prev.filter(s => !(s.assignedDoctorId === d.id && s.date === date && s.period === period));
      if (type === 'CLEAR') return filtered;
      const newAssignment: ScheduleAssignment = {
        date, period, shift: type, assignedDoctorId: d.id, aiExplanation: a?.aiExplanation || "Manuellt skapad av administratör.", scoreSnapshot: a?.scoreSnapshot || 0, isManual: true
      };
      return [...filtered, newAssignment];
    });
    setEditModalData(null);
  };

  const handleSaveDoctor = (newDoc: Doctor) => {
    const isNew = !doctors.some(d => d.id === newDoc.id);
    queueSave(() => (isNew ? api.createDoctor(newDoc) : api.updateDoctor(newDoc)));
    setDoctors(prev => {
      const exists = prev.find(d => d.id === newDoc.id);
      return exists ? prev.map(d => d.id === newDoc.id ? newDoc : d) : [...prev, newDoc];
    });
    setDoctorModalData({ isOpen: false });
  };

  const handleDeleteDoctor = (id: string) => {
     if (window.confirm("Är du säker på att du vill ta bort denna läkare?")) {
        setDoctors(prev => prev.filter(d => d.id !== id));
        setSchedule(prev => prev.filter(s => s.assignedDoctorId !== id)); 
        setLeaves(prev => prev.filter(l => l.doctorId !== id)); 
        // Återkommande uppgifter som pekade på läkaren blir "ingen utpekad".
        const clear = (ref: string) => (ref === id ? 'UNASSIGNED' : ref);
        setStaffingConfig(prev => ({ ...prev, recurringTasks: prev.recurringTasks.map(t => ({
          ...t, assignedDoctorId: clear(t.assignedDoctorId), backup1DoctorId: clear(t.backup1DoctorId), backup2DoctorId: clear(t.backup2DoctorId),
        })) }));
        queueSave(() => api.deleteDoctor(id));
     }
  };

  const updateRequirement = (date: string, field: 'minStaff' | 'jour', change: number) => {
    setRequirements(prev => prev.map(req => {
      if (req.date === date) {
        if (field === 'minStaff') return { ...req, minStaff: Math.max(0, req.minStaff + change) };
        else if (field === 'jour') return { ...req, requiredShifts: { ...req.requiredShifts, [ShiftType.JOUR]: Math.max(0, (req.requiredShifts[ShiftType.JOUR] || 0) + change) } };
      }
      return req;
    }));
  };

  // Helper to update specific fields within a specific Deviation
  const handleUpdateDeviation = (devId: string, field: keyof StaffingBaseCounts, value: number) => {
    setStaffingConfig(prev => ({
      ...prev,
      deviations: prev.deviations.map(dev => {
        if (dev.id === devId) {
          return {
            ...dev,
            counts: {
              ...dev.counts,
              [field]: value
            }
          };
        }
        return dev;
      })
    }));
  };

  // Helper to calculate week number for a specific week index relative to start date
  const getWeekForIndex = (index: number) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + (index * 7));
    return getWeekNumber(d);
  };

  // --- EARLY RETURN FOR GLOBAL AUTH ---
  if (!isAppAuthenticated) {
    return <GlobalAuthScreen onAuthenticated={() => setIsAppAuthenticated(true)} />;
  }

  if (loadState === 'loading') return <DataStatusScreen title="Hämtar data från databasen..." />;
  if (loadState === 'error') return <DataStatusScreen title="Kunde inte hämta data från databasen" detail={loadError} onRetry={loadFromDatabase} onDemo={startDemoMode} />;

  if (!currentUser) return <LoginScreen onLogin={handleLogin} doctors={doctors} />;

  const daysPerWeek = 7;
  const totalWeeks = Math.ceil(requirements.length / daysPerWeek);
  const visibleRequirements = requirements.slice(currentWeekIndex * daysPerWeek, (currentWeekIndex + 1) * daysPerWeek);
  const currentDayReq = requirements[currentDayIndex];
  const currentDayAssignments = schedule.filter(s => s.date === currentDayReq?.date);
  const currentDayDateObj = currentDayReq ? new Date(currentDayReq.date) : new Date();

  // --- DAY VIEW RENDERING HELPERS ---
  const hours = Array.from({ length: TIME_END_HOUR - TIME_START_HOUR + 1 }, (_, i) => TIME_START_HOUR + i);

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {demoMode && <div className="fixed bottom-4 left-4 z-50 bg-amber-100 border-2 border-amber-400 text-amber-900 text-sm font-extrabold rounded-lg px-4 py-2 shadow-lg">Demoläge – inget sparas</div>}
      {saveError && (
        <div className="fixed bottom-4 right-4 z-50 max-w-md bg-red-50 border-2 border-red-400 text-red-900 rounded-lg px-4 py-3 shadow-lg">
          <p className="font-extrabold text-sm">Ändringen kunde inte sparas i databasen</p>
          <p className="text-xs font-bold mt-1 break-words">{saveError}</p>
          <p className="text-xs font-bold mt-1">Kontrollera att servern körs. Nästa ändring försöker spara igen.</p>
          <button onClick={() => setSaveError('')} className="mt-2 text-xs font-extrabold underline">Stäng</button>
        </div>
      )}
      <nav className="w-full md:w-64 bg-slate-900 text-slate-200 flex-shrink-0 flex flex-col md:min-h-screen">
        <div className="p-6"><h1 className="text-4xl font-extrabold text-white flex items-center gap-2">ClinIQ</h1></div>
        <div className="px-6 mb-4">
          <div className="bg-slate-800 rounded p-4 text-sm font-bold border border-slate-700">
            <p className="text-slate-400 font-bold uppercase text-xs mb-1">Inloggad som:</p>
            <p className="font-extrabold text-white text-base">{currentUser.name}</p>
            <p className="text-primary font-bold">{currentUser.role === UserRole.ADMIN ? 'Administratör' : 'Läkare'}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 px-4 pb-4">
          {currentUser.role === UserRole.ADMIN && (
            <>
                <button onClick={() => setView('admin')} className={`p-3 text-left rounded-lg flex items-center gap-3 font-bold text-base transition-colors ${view === 'admin' ? 'bg-primary text-white shadow-md' : 'hover:bg-slate-800 text-slate-300'}`}><ChartBarIcon className="w-6 h-6" /> Generera schema</button>
                <button onClick={() => setView('admin-doctors')} className={`p-3 text-left rounded-lg flex items-center gap-3 font-bold text-base transition-colors ${view === 'admin-doctors' ? 'bg-primary text-white shadow-md' : 'hover:bg-slate-800 text-slate-300'}`}><UsersIcon className="w-6 h-6" /> Hantera läkare</button>
                <button onClick={() => setView('admin-leaves')} className={`p-3 text-left rounded-lg flex items-center gap-3 font-bold text-base transition-colors ${view === 'admin-leaves' ? 'bg-primary text-white shadow-md' : 'hover:bg-slate-800 text-slate-300'}`}><InboxStackIcon className="w-6 h-6" /> Ledighetsansökningar {leaves.filter(l => l.status === 'PENDING').length > 0 && ( <span className="ml-auto bg-red-600 text-white text-xs font-extrabold px-2 py-1 rounded-full shadow-sm">{leaves.filter(l => l.status === 'PENDING').length}</span> )}</button>
                <button onClick={() => { setView('schedule'); setScheduleViewMode('DAY'); }} className={`p-3 text-left rounded-lg flex items-center gap-3 font-bold text-base transition-colors ${view === 'schedule' ? 'bg-primary text-white shadow-md' : 'hover:bg-slate-800 text-slate-300'}`}><CalendarDaysIcon className="w-6 h-6" /> Schemaöversikt</button>
            </>
          )}
          {currentUser.role === UserRole.DOCTOR && ( 
              <>
                <button onClick={() => setView('doctor-schedule')} className={`p-3 text-left rounded-lg flex items-center gap-3 font-bold text-base transition-colors ${view === 'doctor-schedule' ? 'bg-primary text-white shadow-md' : 'hover:bg-slate-800 text-slate-300'}`}><CalendarDaysIcon className="w-6 h-6" /> Mitt Schema</button> 
                <button onClick={() => setView('doctor-dashboard')} className={`p-3 text-left rounded-lg flex items-center gap-3 font-bold text-base transition-colors ${view === 'doctor-dashboard' ? 'bg-primary text-white shadow-md' : 'hover:bg-slate-800 text-slate-300'}`}><DocumentTextIcon className="w-6 h-6" /> Mina Sidor</button> 
              </>
          )}
          
          <div className="h-px bg-slate-700 my-2 mx-1"></div>
          <button onClick={handleLogout} className="w-full p-3 text-base font-bold text-slate-300 hover:text-white flex items-center gap-3 hover:bg-slate-800 rounded-lg transition-colors"><ArrowRightOnRectangleIcon className="w-6 h-6 text-slate-400" /> Logga ut</button>
        </div>
      </nav>

      <main className="flex-1 p-6 md:p-10 overflow-auto bg-slate-50">
        
        {view === 'admin' && currentUser.role === UserRole.ADMIN && (
          <div className="space-y-8 animate-in fade-in duration-500">
            <header>
              <h2 className="text-4xl font-extrabold text-slate-900">Generera Schema & Krav</h2>
              <p className="text-slate-600 font-bold text-lg mt-2">Ställ in grundkrav, fasta uppdrag och generera schemat.</p>
            </header>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
              
              {/* LEFT COLUMN: CONFIGURATION */}
              <div className="xl:col-span-2 space-y-8">
                {/* 1. OWNER MEETING (ÄGARMÖTE) CONFIG - COLLAPSIBLE */}
                <CollapsibleSection title={staffingConfig.ownerMeeting.name}>
                    <div className="space-y-4">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-indigo-50 p-4 rounded-lg border border-indigo-100">
                             <div>
                                <p className="text-slate-700 font-bold text-sm flex items-center gap-2">
                                     <BuildingLibraryIcon className="w-5 h-5 text-indigo-600"/>
                                     Återkommande låsning av specialister (Måndag varannan månad).
                                </p>
                             </div>
                             <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
                                <span className="text-sm font-bold text-slate-500 uppercase">Status:</span>
                                <button 
                                    onClick={() => setStaffingConfig(prev => ({...prev, ownerMeeting: {...prev.ownerMeeting, isActive: !prev.ownerMeeting.isActive}}))}
                                    className={`px-4 py-2 rounded-full font-extrabold text-sm transition-colors ${staffingConfig.ownerMeeting.isActive ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-slate-200 text-slate-500 hover:bg-slate-300'}`}
                                >
                                    {staffingConfig.ownerMeeting.isActive ? 'AKTIV' : 'INAKTIV'}
                                </button>
                            </div>
                        </div>
                    
                        {staffingConfig.ownerMeeting.isActive && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in slide-in-from-top-2">
                                <NumberStepper 
                                    label="Antal Specialister" 
                                    value={staffingConfig.ownerMeeting.requiredCount} 
                                    onChange={(v) => setStaffingConfig(prev => ({...prev, ownerMeeting: {...prev.ownerMeeting, requiredCount: v}}))}
                                    subLabel="Låses 09:30-12:30"
                                />
                                <div className="bg-white p-3 rounded border border-indigo-200 shadow-sm">
                                    <span className="block text-xs font-extrabold text-indigo-400 uppercase mb-1">Tidsintervall</span>
                                    <div className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
                                        <ClockIcon className="w-5 h-5 text-slate-400"/> {staffingConfig.ownerMeeting.timeStart} - {staffingConfig.ownerMeeting.timeEnd}
                                    </div>
                                </div>
                                <div className="col-span-1 md:col-span-2 bg-white p-3 rounded border border-indigo-200 shadow-sm">
                                    <span className="block text-xs font-extrabold text-indigo-400 uppercase mb-1">Regelverk</span>
                                    <p className="text-sm font-bold text-slate-600">
                                        Måndag (Första i månaden) • Månader: Jan, Mars, Maj, Sep, Nov (Sommaruppehåll).
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </CollapsibleSection>

                {/* 2. STANDARD REQUIREMENTS (COLLAPSIBLE) */}
                <CollapsibleSection title="Bemanningskrav Standard">
                  <div className="space-y-6">
                    <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                       <NumberStepper 
                          label="Max Antal Läkare" 
                          value={staffingConfig.base.maxDoctors} 
                          onChange={(v) => setStaffingConfig(prev => ({...prev, base: {...prev.base, maxDoctors: v}}))} 
                          subLabel="Tak för total bemanning"
                        />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                         <NumberStepper label="Min Läkare (Totalt)" value={staffingConfig.base.minTotalDaily} onChange={(v) => setStaffingConfig(prev => ({...prev, base: {...prev.base, minTotalDaily: v}}))} subLabel="Per dag"/>
                         <NumberStepper label="Min Specialister" value={staffingConfig.base.minSpecDaily} onChange={(v) => setStaffingConfig(prev => ({...prev, base: {...prev.base, minSpecDaily: v}}))} subLabel="Per dag"/>
                    </div>
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-200">
                        <NumberStepper label="Min Läkare (efter 16:00)" value={staffingConfig.base.minTotalLate} onChange={(v) => setStaffingConfig(prev => ({...prev, base: {...prev.base, minTotalLate: v}}))} subLabel="Fram till 17:00"/>
                        <NumberStepper label="Min Specialister (efter 16:00)" value={staffingConfig.base.minSpecLate} onChange={(v) => setStaffingConfig(prev => ({...prev, base: {...prev.base, minSpecLate: v}}))} subLabel="Fram till 17:00"/>
                     </div>
                  </div>
                </CollapsibleSection>

                {/* 3. RECURRING TASKS (COLLAPSIBLE) */}
                <CollapsibleSection title="Återkommande Uppgifter & Resurslåsning">
                  <div className="bg-slate-50 rounded-lg border border-slate-200 overflow-hidden">
                    <table className="w-full text-left">
                      <thead className="bg-slate-100 text-xs font-extrabold text-slate-500 uppercase border-b border-slate-200">
                        <tr>
                          <th className="px-4 py-3">Uppgift / Dag</th>
                          <th className="px-4 py-3">Resurs (Låst)</th>
                          <th className="px-4 py-3">Ersättare (1:a & 2:a hand)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {staffingConfig.recurringTasks.map(task => (
                          <TaskAssignmentRow 
                            key={task.id} 
                            task={task} 
                            doctors={doctors}
                            onUpdate={(updated) => {
                               setStaffingConfig(prev => ({
                                 ...prev,
                                 recurringTasks: prev.recurringTasks.map(t => t.id === updated.id ? updated : t)
                               }));
                            }} 
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CollapsibleSection>

                {/* 4. DEVIATIONS - COLLAPSIBLE */}
                <CollapsibleSection title="Avvikande Grundschema">
                  <div className="space-y-4">
                  {staffingConfig.deviations.map(dev => (
                     <Card key={dev.id} title={`${dev.name} (${dev.startDate} - ${dev.endDate})`} className="border-t-4 border-t-amber-500 relative">
                        <div className="absolute top-4 right-4">
                            <button className="text-red-500 hover:bg-red-50 p-2 rounded"><TrashIcon className="w-5 h-5" /></button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            <NumberStepper label="Max Antal Läkare" value={dev.counts.maxDoctors} onChange={(v) => handleUpdateDeviation(dev.id, 'maxDoctors', v)} subLabel="Avvikelse"/>
                            <NumberStepper label="Min Läkare (Totalt)" value={dev.counts.minTotalDaily} onChange={(v) => handleUpdateDeviation(dev.id, 'minTotalDaily', v)} subLabel="Avvikelse"/>
                             <NumberStepper label="Min Specialister" value={dev.counts.minSpecDaily} onChange={(v) => handleUpdateDeviation(dev.id, 'minSpecDaily', v)} subLabel="Avvikelse"/>
                        </div>
                     </Card>
                  ))}
                  
                  <button className="w-full py-4 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 font-bold hover:bg-slate-50 hover:border-slate-400 hover:text-slate-700 transition-colors flex items-center justify-center gap-2">
                      <PlusIcon className="w-6 h-6" /> Lägg till ny periodavvikelse
                  </button>
                  </div>
                </CollapsibleSection>
              </div>

              {/* RIGHT COLUMN: ACTIONS & GENERATE */}
              <div className="space-y-6">
                <Card title="Åtgärder" className="sticky top-6 border-t-4 border-t-slate-800"> 
                  <Button onClick={handleGenerate} disabled={isGenerating} className="w-full mb-4 font-bold text-lg py-4 shadow-lg">{isGenerating ? 'Optimerar schema...' : 'Generera schema'}</Button>
                  
                  <div className="mt-2">
                    <Button variant="secondary" onClick={() => setIsColorModalOpen(true)} className="w-full flex items-center justify-center gap-2 font-bold py-3 bg-white border-2 border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300">
                      <SwatchIcon className="w-5 h-5" /> Konfigurera färger
                    </Button>
                  </div>

                  {generationWarnings.length > 0 && ( <div className="mt-4 bg-amber-50 border-2 border-amber-200 rounded-md p-5 space-y-2 animate-in slide-in-from-top-2"><h4 className="text-amber-900 font-extrabold text-lg flex items-center gap-2"><ExclamationTriangleIcon className="w-6 h-6" /> Varningar:</h4><ul className="text-sm text-amber-900 font-bold list-disc pl-5">{generationWarnings.map((w, idx) => ( <li key={idx}>{w.date}: {w.message}</li> ))}</ul></div> )}
                  
                  {schedule.length > 0 && generationWarnings.length === 0 && ( <div className="mt-4 p-4 bg-green-50 text-green-900 rounded border-2 border-green-200 flex items-center gap-3 animate-in slide-in-from-top-2"><CheckCircleIcon className="w-6 h-6 text-green-600"/> <span className="font-bold text-lg">Schema genererat!</span></div> )}
                </Card>

                {schedule.length > 0 && (
                  <Card title="Rättviseanalys" className="h-fit">
                    <p className="text-sm text-slate-600 font-bold mb-4">Jourfördelning baserat på genererat schema.</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-left">
                        <thead className="font-extrabold text-slate-600 uppercase bg-slate-100 border-b-2 border-slate-300"><tr><th className="px-3 py-2">Läkare</th><th className="px-3 py-2">Pass</th></tr></thead>
                        <tbody>
                          {stats.heavyShifts.slice(0, 5).map(d => (
                            <tr key={d.name} className="border-b last:border-0 hover:bg-slate-50 border-slate-200">
                              <td className="px-3 py-2 font-bold text-slate-900 truncate max-w-[120px]">{d.name}</td>
                              <td className="px-3 py-2"><div className="flex items-center gap-2"><span className="font-extrabold">{d.count}</span><div className="h-2 bg-slate-200 rounded-full w-16 overflow-hidden"><div className={`h-full ${d.count > 2 ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${d.count * 20}%` }}></div></div></div></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                )}
              </div>

            </div>
          </div>
        )}

        {/* ... (Admin Doctors, Leaves, Doctor Schedule, Dashboard same as previous implementation) ... */}
        {view === 'admin-doctors' && currentUser.role === UserRole.ADMIN && (
          <div className="space-y-6 animate-in fade-in duration-500">
             <header className="mb-8 flex justify-between items-center">
                <div><h2 className="text-4xl font-extrabold text-slate-900">Hantera Läkare</h2><p className="text-slate-600 font-bold text-lg mt-2">Lägg till, redigera eller ta bort läkare från systemet (Sessionsbaserat).</p></div>
                <Button onClick={() => setDoctorModalData({ isOpen: true })} className="flex items-center gap-2 font-bold text-lg px-6 py-3"><PlusIcon className="w-6 h-6" /> Lägg till ny läkare</Button>
             </header>
             <Card className="overflow-hidden">
                <table className="w-full text-base text-left">
                    <thead className="text-sm font-extrabold text-slate-600 uppercase bg-slate-100 border-b-2 border-slate-300">
                        <tr><th className="px-6 py-4">Namn</th><th className="px-6 py-4">Roll</th><th className="px-6 py-4">Kompetenser</th><th className="px-6 py-4 text-right">Åtgärder</th></tr>
                    </thead>
                    <tbody>
                        {doctors.map(doc => (
                            <tr key={doc.id} className="border-b last:border-0 hover:bg-slate-50 border-slate-200">
                                <td className="px-6 py-4 font-bold text-slate-900">{doc.name}</td>
                                <td className="px-6 py-4 text-slate-600 font-bold">{doc.role}</td>
                                <td className="px-6 py-4"><div className="flex flex-wrap gap-1">{doc.competence.map(c => ( <span key={c} className="text-sm font-bold bg-slate-100 text-slate-700 px-2 py-1 rounded border border-slate-300">{c}</span> ))}</div></td>
                                <td className="px-6 py-4 text-right flex justify-end gap-2"><button onClick={() => setDoctorModalData({ isOpen: true, doctor: doc })} className="p-2 text-slate-400 hover:text-primary hover:bg-slate-100 rounded" title="Redigera"><PencilSquareIcon className="w-6 h-6" /></button><button type="button" onClick={(e) => { e.stopPropagation(); setTimeout(() => { handleDeleteDoctor(doc.id); }, 10); }} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded relative z-10" title="Ta bort"><TrashIcon className="w-6 h-6 pointer-events-none" /></button></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
             </Card>
          </div>
        )}

        {view === 'admin-leaves' && currentUser.role === UserRole.ADMIN && (
             <div className="space-y-6 animate-in fade-in duration-500">
                <header className="mb-8"><h2 className="text-4xl font-extrabold text-slate-900">Ledighetsansökningar</h2><p className="text-slate-600 font-bold text-lg mt-2">Granska och besluta om inkomna ledighetsansökningar med AI-stöd.</p></header>
                <div className="space-y-4">
                    {leaves.filter(l => l.status === 'PENDING').length === 0 ? ( <div className="text-center py-16 bg-white rounded-xl shadow-md border-2 border-slate-200"><CheckCircleIcon className="w-20 h-20 text-green-200 mx-auto mb-4" /><p className="text-slate-500 font-bold text-xl">Korgen är tom! Alla ärenden hanterade.</p></div> ) : (
                        leaves.filter(l => l.status === 'PENDING').map(leave => {
                            const doc = doctors.find(d => d.id === leave.doctorId);
                            return (
                                <Card key={leave.id} className="border-l-8 border-l-primary">
                                    <div className="flex flex-col md:flex-row gap-6">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-3 mb-3"><h3 className="font-extrabold text-2xl text-slate-900">{doc?.name || 'Okänd Läkare'}</h3><span className="text-sm font-bold bg-slate-200 px-3 py-1 rounded text-slate-700">{doc?.role || '-'}</span></div>
                                            <div className="grid grid-cols-2 gap-6 text-base text-slate-700 mb-4">
                                                <div>
                                                    <span className="block font-extrabold text-slate-500 text-sm uppercase mb-1">Datum</span>
                                                    <span className="font-bold text-lg">{leave.date}</span>
                                                    {leave.isFullDay === false && (
                                                        <span className="block text-sm font-bold text-amber-600 mt-1">
                                                            Del av dag: {leave.startTime} - {leave.endTime}
                                                        </span>
                                                    )}
                                                </div>
                                                <div><span className="block font-extrabold text-slate-500 text-sm uppercase mb-1">Anledning</span><span className="font-bold text-lg">{leave.reason}</span></div>
                                            </div>
                                        </div>
                                        <div className="flex-1 bg-slate-50 p-5 rounded border-2 border-slate-200"><div className="flex items-center gap-2 mb-2"><BeakerIcon className="w-5 h-5 text-purple-700" /><span className="text-sm font-extrabold text-purple-700 uppercase tracking-wide">AI Rekommendation</span></div><p className={`font-extrabold text-xl mb-2 ${leave.aiRecommendation === 'APPROVED' ? 'text-green-800' : 'text-red-800'}`}>{leave.aiRecommendation === 'APPROVED' ? 'Bör Godkännas' : 'Bör Nekas'}</p><p className="text-base text-slate-700 font-bold italic">"{leave.aiReasoning}"</p></div>
                                        <div className="flex flex-col justify-center gap-3 min-w-[180px]"><Button variant="success" onClick={() => handleAdminLeaveAction(leave.id, 'APPROVED')} className="w-full flex items-center justify-center gap-2 font-bold text-lg py-3"><CheckCircleIcon className="w-6 h-6"/> Godkänn</Button><Button variant="danger" onClick={() => handleAdminLeaveAction(leave.id, 'DENIED')} className="w-full flex items-center justify-center gap-2 font-bold text-lg py-3"><XCircleIcon className="w-6 h-6"/> Neka</Button></div>
                                    </div>
                                </Card>
                            );
                        })
                    )}
                </div>
                {leaves.filter(l => l.status !== 'PENDING').length > 0 && ( <div className="mt-12 opacity-80 hover:opacity-100 transition-opacity"><h3 className="text-xl font-extrabold text-slate-600 mb-4">Tidigare beslut</h3><div className="space-y-3">{leaves.filter(l => l.status !== 'PENDING').map(l => ( <div key={l.id} className="flex justify-between items-center p-4 bg-white border-2 border-slate-200 rounded-lg text-base shadow-sm"><span className="font-bold text-slate-800">{doctors.find(d => d.id === l.doctorId)?.name || 'Borttagen läkare'} - {l.date}</span><span className={`px-3 py-1 rounded text-sm font-extrabold ${l.status === 'APPROVED' ? 'bg-green-100 text-green-800 border border-green-200' : 'bg-red-100 text-red-800 border border-red-200'}`}>{l.status === 'APPROVED' ? 'GODKÄND' : 'NEKAD'}</span></div> ))}</div></div> )}
             </div>
        )}

        {view === 'doctor-schedule' && currentUser.role === UserRole.DOCTOR && (
          <div className="space-y-6 animate-in fade-in duration-500">
             <header className="mb-4">
               <h2 className="text-4xl font-extrabold text-slate-900">Mitt Schema</h2>
               <p className="text-slate-600 font-bold text-lg mt-2">Välkommen tillbaka, {currentUser.name}.</p>
             </header>

            {/* --- PERSONAL SCHEDULE --- */}
             <div className="bg-white rounded-xl shadow-md border-2 border-slate-300 overflow-hidden mb-6">
                 <div className="flex items-center justify-between p-5 bg-slate-50 border-b-2 border-slate-300">
                    <div className="flex items-center gap-2 text-slate-800 font-extrabold text-xl"><CalendarDaysIcon className="w-6 h-6 text-primary"/> Veckovy</div>
                    <div className="flex items-center gap-4">
                      <Button variant="secondary" onClick={() => setCurrentWeekIndex(p => Math.max(0, p - 1))} disabled={currentWeekIndex === 0} className="flex items-center gap-2 text-sm font-bold py-1 px-3"><ChevronLeftIcon className="w-4 h-4" /> V. {getWeekForIndex(currentWeekIndex - 1)}</Button>
                      <div className="flex flex-col items-center min-w-[120px]">
                        <span className="font-extrabold text-slate-900 text-lg">
                            Vecka {getWeekForIndex(currentWeekIndex)}
                        </span>
                        <span className="text-xs font-bold text-slate-500">{visibleRequirements.length > 0 && `${visibleRequirements[0].date} - ${visibleRequirements[visibleRequirements.length - 1].date}`}</span>
                      </div>
                      <Button variant="secondary" onClick={() => setCurrentWeekIndex(p => Math.min(totalWeeks - 1, p + 1))} disabled={currentWeekIndex === totalWeeks - 1} className="flex items-center gap-2 text-sm font-bold py-1 px-3">V. {getWeekForIndex(currentWeekIndex + 1)} <ChevronRightIcon className="w-4 h-4" /></Button>
                    </div>
                 </div>
                 
                 {schedule.length === 0 ? (
                    <div className="p-10 text-center text-slate-500 font-bold"><p>Schemat är inte publicerat ännu.</p></div>
                 ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-base border-collapse">
                            <thead>
                            <tr>
                                <th className="p-4 border-b-2 border-r-2 border-slate-300 bg-slate-100 text-left min-w-[100px] font-extrabold text-slate-700">Tid</th>
                                {visibleRequirements.map(req => {
                                    const date = new Date(req.date);
                                    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                                    return ( <th key={req.date} className={`p-3 border-b-2 border-slate-300 min-w-[110px] text-center ${isWeekend ? 'bg-orange-50' : 'bg-slate-50'}`}><div className="font-extrabold uppercase text-sm text-slate-600">{date.toLocaleDateString('sv-SE', { weekday: 'short' })}</div><div className="font-bold text-slate-800">{date.getDate()}/{date.getMonth()+1}</div></th> );
                                })}
                            </tr>
                            </thead>
                            <tbody>
                                {/* Row for current doctor - using exact same rendering logic as Admin View */}
                                {(() => {
                                    const docId = currentUser.doctorId || doctors[0].id;
                                    const doc = doctors.find(d => d.id === docId);
                                    if (!doc) return null;

                                    return (
                                        <tr className="hover:bg-slate-50 group/row">
                                            <td className="p-4 border-b-2 border-r-2 border-slate-200 font-bold text-slate-900 sticky left-0 bg-white z-10">
                                                {doc.name}
                                                <div className="text-sm text-slate-500 font-bold">{doc.role}</div>
                                            </td>
                                            {visibleRequirements.map(req => {
                                                const assigns = schedule.filter(s => s.date === req.date && s.assignedDoctorId === doc.id);
                                                const leave = leaves.find(l => l.doctorId === doc.id && l.date === req.date && l.status === 'APPROVED');
                                                // Re-use calculateShiftRange for accurate visual feedback on work times
                                                const workHours = calculateShiftRange(assigns, req.date);

                                                return (
                                                    <td key={req.date} className="p-1 border-b-2 text-center border-l-2 border-slate-200 relative group/cell">
                                                      {leave && leave.isFullDay !== false ? ( 
                                                          <div className="w-full h-full p-2"><span className="text-sm font-bold bg-slate-200 text-slate-700 px-3 py-1 rounded block border border-slate-300">Ledig</span></div> 
                                                      ) : (
                                                        assigns.length > 0 || (leave && leave.isFullDay === false) ? (
                                                        <div className="flex flex-col gap-1 h-full p-1 min-h-[70px]">
                                                          <div className="flex-1 flex flex-col gap-1 justify-center">
                                                             {/* Render Partial Leave Badge if exists */}
                                                             {leave && leave.isFullDay === false && (
                                                                 <div className="text-[10px] font-bold bg-amber-100 text-amber-800 px-1 py-0.5 rounded border border-amber-200 mb-1">
                                                                     Ledig {leave.startTime}-{leave.endTime}
                                                                 </div>
                                                             )}
                                                             {assigns.filter(a => a.period === 'FM').map((a, i) => ( <ShiftBadge key={i+"fm"} type={a.shift} period="FM" colors={colors} isInteractive={false} isManual={a.isManual} taskName={a.taskName}/> ))}
                                                             {assigns.filter(a => a.period === 'EM').map((a, i) => ( <ShiftBadge key={i+"em"} type={a.shift} period="EM" colors={colors} isInteractive={false} isManual={a.isManual} taskName={a.taskName}/> ))}
                                                          </div>
                                                          <div className="mt-1 pt-0.5 border-t border-slate-100 text-center">
                                                              <div className="flex items-center justify-center gap-1 text-[9px] font-bold text-slate-500 bg-slate-50 rounded px-1">
                                                                  <ClockIcon className="w-3 h-3"/> {workHours}
                                                              </div>
                                                          </div>
                                                        </div>
                                                        ) : ( <span className="text-slate-300 font-bold block min-h-[20px]">-</span> )
                                                      )}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    );
                                })()}
                            </tbody>
                        </table>
                    </div>
                 )}
             </div>
          </div>
        )}

        {view === 'doctor-dashboard' && currentUser.role === UserRole.DOCTOR && (
          <div className="space-y-6 animate-in fade-in duration-500">
             <header className="mb-4">
               <h2 className="text-4xl font-extrabold text-slate-900">Mina Sidor</h2>
               <p className="text-slate-600 font-bold text-lg mt-2">Frånvaro och kollegor.</p>
             </header>
             <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card title="Frånvaro & Ansökan">
                   <div className="space-y-6">
                     <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                        <h4 className="font-extrabold text-slate-800 mb-3 flex items-center gap-2">
                            <PlusIcon className="w-5 h-5"/> Ny Ansökan
                        </h4>
                        <div className="space-y-3">
                            <p className="text-sm text-slate-600 font-bold">Ansök om ledighet för enstaka dagar eller längre perioder.</p>
                            <Button 
                                onClick={() => setIsApplyingForLeave(true)} 
                                className="w-full font-bold py-3 text-lg flex items-center justify-center gap-2"
                            >
                                <CalendarDaysIcon className="w-6 h-6" />
                                Skapa ny ansökan
                            </Button>
                        </div>
                     </div>
                     <div>
                        <h4 className="font-extrabold text-slate-800 mb-3 flex items-center gap-2">
                            <InboxStackIcon className="w-5 h-5"/> Mina Ansökningar
                        </h4>
                        {leaves.filter(l => l.doctorId === (currentUser.doctorId || doctors[0].id)).length === 0 ? ( 
                            <p className="text-slate-400 italic font-bold">Inga aktiva ansökningar.</p> 
                        ) : ( 
                            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                                {leaves.filter(l => l.doctorId === (currentUser.doctorId || doctors[0].id)).map((l) => (
                                    <div key={l.id} className="p-3 border border-slate-200 rounded bg-white flex items-center justify-between">
                                        <div>
                                            <span className="font-bold text-slate-900 block">{l.date}</span>
                                            {l.isFullDay === false && (
                                                <span className="text-xs font-bold text-amber-600 block mb-0.5">
                                                    {l.startTime} - {l.endTime}
                                                </span>
                                            )}
                                            <span className="text-xs text-slate-500 font-bold uppercase">{l.reason}</span>
                                        </div>
                                        <span className={`px-2 py-1 rounded text-xs font-extrabold border ${
                                            l.status === 'APPROVED' ? 'bg-green-100 text-green-800 border-green-200' : 
                                            l.status === 'DENIED' ? 'bg-red-100 text-red-800 border-red-200' : 
                                            'bg-yellow-100 text-yellow-800 border-yellow-200'
                                        }`}>
                                            {l.status === 'APPROVED' ? 'Beviljad' : l.status === 'DENIED' ? 'Nekad' : 'Väntar'}
                                        </span>
                                    </div>
                                ))}
                            </div> 
                        )}
                     </div>
                   </div>
                </Card>
                <Card title="Kollegors Frånvaro">
                    <p className="text-slate-600 font-bold text-sm mb-4">Översikt över planerade ledigheter för andra läkare.</p>
                    {(() => { 
                        const currentDocId = currentUser.doctorId || doctors[0].id; 
                        const colleagueLeaves = leaves
                            .filter(l => l.doctorId !== currentDocId && l.status === 'APPROVED')
                            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()); 
                        
                        if (colleagueLeaves.length === 0) { 
                            return (
                                <div className="text-center py-10 bg-slate-50 rounded border border-slate-200">
                                    <BriefcaseIcon className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                                    <p className="text-slate-400 font-bold">Ingen planerad frånvaro bland kollegor.</p>
                                </div>
                            ); 
                        } 
                        return (
                            <div className="bg-white border-2 border-slate-200 rounded-lg overflow-hidden">
                                <table className="w-full text-left">
                                    <thead className="bg-slate-50 border-b border-slate-200">
                                        <tr>
                                            <th className="px-4 py-2 text-xs font-extrabold text-slate-500 uppercase">Datum</th>
                                            <th className="px-4 py-2 text-xs font-extrabold text-slate-500 uppercase">Läkare</th>
                                            <th className="px-4 py-2 text-xs font-extrabold text-slate-500 uppercase">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {colleagueLeaves.map(l => { 
                                            const docName = doctors.find(d => d.id === l.doctorId)?.name || "Okänd"; 
                                            return (
                                                <tr key={l.id} className="hover:bg-slate-50">
                                                    <td className="px-4 py-3 font-bold text-slate-900">{l.date}</td>
                                                    <td className="px-4 py-3 font-bold text-slate-700">{docName}</td>
                                                    <td className="px-4 py-3">
                                                        <span className="text-xs font-extrabold bg-slate-100 text-slate-500 px-2 py-1 rounded">LEDIG</span>
                                                    </td>
                                                </tr>
                                            ); 
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        ); 
                    })()}
                </Card>
             </div>
          </div>
        )}

        {view === 'schedule' && (
          <div className="space-y-6 animate-in fade-in duration-500">
             {/* ... Schedule View Content is identical structure, handles logic internally ... */}
             <header className="mb-6 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
              <div>
                <h2 className="text-4xl font-extrabold text-slate-900">Schema</h2>
                <p className="text-slate-600 font-bold text-lg mt-2">{scheduleViewMode === 'WEEK' ? 'Veckoöversikt' : 'Dagvy (Tidbok)'}</p>
              </div>
              <div className="flex gap-2 bg-white rounded-lg p-1 border border-slate-300">
                  <button onClick={() => setScheduleViewMode('WEEK')} className={`px-4 py-2 rounded font-bold text-sm flex items-center gap-2 ${scheduleViewMode === 'WEEK' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><CalendarDaysIcon className="w-4 h-4" /> Vecka</button>
                  {currentUser.role === UserRole.ADMIN && ( <button onClick={() => setScheduleViewMode('DAY')} className={`px-4 py-2 rounded font-bold text-sm flex items-center gap-2 ${scheduleViewMode === 'DAY' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><TableCellsIcon className="w-4 h-4" /> Dag (Admin)</button> )}
              </div>
            </header>

            {schedule.length === 0 && ( <div className="text-amber-800 bg-amber-50 px-5 py-3 rounded-lg border-2 border-amber-200 flex items-center gap-3 text-base font-bold"><InformationCircleIcon className="w-6 h-6" /> Gå till Admin för att generera schemat först.</div> )}

            {schedule.length > 0 && scheduleViewMode === 'WEEK' && (
               <div className="bg-white rounded-xl shadow-md border-2 border-slate-300 overflow-hidden">
                 <div className="flex items-center justify-between p-5 bg-slate-50 border-b-2 border-slate-300">
                    <Button variant="secondary" onClick={() => setCurrentWeekIndex(p => Math.max(0, p - 1))} disabled={currentWeekIndex === 0} className="flex items-center gap-2 text-base font-bold py-2"><ChevronLeftIcon className="w-5 h-5" /> Föregående</Button>
                    <div className="flex flex-col items-center"><span className="font-extrabold text-slate-900 text-xl">
                    Vecka {(() => {
                        const startReq = visibleRequirements.length > 0 ? visibleRequirements[0] : null;
                        return startReq ? getWeekNumber(new Date(startReq.date)) : currentWeekIndex + 1;
                    })()}
                    </span><span className="text-sm font-bold text-slate-500">{visibleRequirements.length > 0 && `${visibleRequirements[0].date} - ${visibleRequirements[visibleRequirements.length - 1].date}`}</span></div>
                    <Button variant="secondary" onClick={() => setCurrentWeekIndex(p => Math.min(totalWeeks - 1, p + 1))} disabled={currentWeekIndex === totalWeeks - 1} className="flex items-center gap-2 text-base font-bold py-2">Nästa <ChevronRightIcon className="w-5 h-5" /></Button>
                 </div>
                 <div className="overflow-x-auto">
                   <table className="w-full text-base border-collapse">
                     <thead>
                       <tr>
                         <th className="p-4 border-b-2 border-r-2 border-slate-300 bg-slate-100 text-left min-w-[180px] sticky left-0 z-10 font-extrabold text-slate-700">Läkare</th>
                         {visibleRequirements.map(req => {
                            const date = new Date(req.date);
                            const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                            return ( <th key={req.date} className={`p-3 border-b-2 border-slate-300 min-w-[110px] text-center ${isWeekend ? 'bg-orange-50' : 'bg-slate-50'}`}><div className="font-extrabold uppercase text-sm text-slate-600">{date.toLocaleDateString('sv-SE', { weekday: 'short' })}</div><div className="font-bold text-slate-800">{date.getDate()}/{date.getMonth()+1}</div></th> );
                         })}
                       </tr>
                     </thead>
                     <tbody>
                        {doctors.map(doc => (
                          <tr key={doc.id} className="hover:bg-slate-50 group/row">
                            <td className="p-4 border-b-2 border-r-2 border-slate-200 font-bold text-slate-900 sticky left-0 bg-white z-10">{doc.name}<div className="text-sm text-slate-500 font-bold">{doc.role}</div></td>
                            {visibleRequirements.map(req => {
                              const assigns = schedule.filter(s => s.date === req.date && s.assignedDoctorId === doc.id);
                              const leave = leaves.find(l => l.doctorId === doc.id && l.date === req.date && l.status === 'APPROVED');
                              const isAdmin = currentUser.role === UserRole.ADMIN;
                              
                              // Calculate based on assigned shifts using Day view logic
                              const workHours = calculateShiftRange(assigns, req.date);

                              return (
                                <td key={req.date} className={`p-1 border-b-2 text-center border-l-2 border-slate-200 relative group/cell ${isAdmin ? 'cursor-pointer hover:bg-sky-50 transition-colors' : ''}`} onClick={() => { if (isAdmin) handleCellClick(doc, req.date, 'FM', assigns[0]); }}>
                                  {leave && leave.isFullDay !== false ? ( 
                                      <div className="w-full h-full p-2"><span className="text-sm font-bold bg-slate-200 text-slate-700 px-3 py-1 rounded block border border-slate-300">Ledig</span></div> 
                                  ) : (
                                    assigns.length > 0 || (leave && leave.isFullDay === false) ? (
                                    <div className="flex flex-col gap-1 h-full p-1 min-h-[70px]">
                                      <div className="flex-1 flex flex-col gap-1 justify-center">
                                         {/* Render Partial Leave Badge if exists */}
                                         {leave && leave.isFullDay === false && (
                                             <div className="text-[10px] font-bold bg-amber-100 text-amber-800 px-1 py-0.5 rounded border border-amber-200 mb-1">
                                                 Ledig {leave.startTime}-{leave.endTime}
                                             </div>
                                         )}
                                         {assigns.filter(a => a.period === 'FM').map((a, i) => ( <ShiftBadge key={i+"fm"} type={a.shift} period="FM" colors={colors} isInteractive={false} isManual={a.isManual} taskName={a.taskName}/> ))}
                                         {assigns.filter(a => a.period === 'EM').map((a, i) => ( <ShiftBadge key={i+"em"} type={a.shift} period="EM" colors={colors} isInteractive={false} isManual={a.isManual} taskName={a.taskName}/> ))}
                                      </div>
                                      <div className="mt-1 pt-0.5 border-t border-slate-100 text-center">
                                          <div className="flex items-center justify-center gap-1 text-[9px] font-bold text-slate-500 bg-slate-50 rounded px-1">
                                              <ClockIcon className="w-3 h-3"/> {workHours}
                                          </div>
                                      </div>
                                    </div>
                                    ) : ( <span className="text-slate-300 font-bold block min-h-[20px]">-</span> )
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                     </tbody>
                   </table>
                 </div>
               </div>
            )}

            {/* ... Day view with Enhanced Rendering for Locked Tasks ... */}
             {schedule.length > 0 && scheduleViewMode === 'DAY' && currentUser.role === UserRole.ADMIN && (
                <div className="bg-white rounded-xl shadow-md border-2 border-slate-300 overflow-hidden flex flex-col h-[800px]">
                     <div className="flex items-center justify-between p-4 bg-slate-100 border-b-2 border-slate-300">
                        <Button variant="secondary" onClick={() => setCurrentDayIndex(Math.max(0, currentDayIndex - 1))} disabled={currentDayIndex === 0}><ChevronLeftIcon className="w-5 h-5" /> Föregående dag</Button>
                        <div className="text-center"><h3 className="text-xl font-extrabold text-slate-900 capitalize">{currentDayDateObj.toLocaleDateString('sv-SE', { weekday: 'long' })}</h3><p className="text-slate-600 font-bold">{currentDayDateObj.toLocaleDateString('sv-SE')}</p></div>
                        <Button variant="secondary" onClick={() => setCurrentDayIndex(Math.min(requirements.length - 1, currentDayIndex + 1))} disabled={currentDayIndex === requirements.length - 1}>Nästa dag <ChevronRightIcon className="w-5 h-5" /></Button>
                     </div>

                     <div className="flex-1 overflow-auto relative">
                        {/* Headers */}
                        <div className="flex sticky top-0 z-30 bg-slate-100 border-b-2 border-slate-300">
                            <div className="w-20 flex-shrink-0 border-r-2 border-slate-300 bg-slate-200"></div>
                            {doctors.map(doc => (
                                <div key={doc.id} className="w-32 flex-shrink-0 p-2 border-r border-slate-300 text-center bg-slate-50">
                                    <div className="font-bold text-slate-900 text-xs truncate">{doc.name}</div>
                                </div>
                            ))}
                        </div>

                        <div className="flex relative">
                            {/* Time Axis */}
                            <div className="w-20 flex-shrink-0 border-r-2 border-slate-300 bg-slate-100 z-20">
                                {hours.map(h => (
                                    <div key={h} style={{ height: PIXELS_PER_HOUR }} className="border-b border-slate-200 text-xs font-bold text-slate-500 p-1 text-right">
                                        {h}:00
                                    </div>
                                ))}
                            </div>

                            {/* Grid Body */}
                            {doctors.map(doc => {
                                const leave = leaves.find(l => l.doctorId === doc.id && l.date === currentDayReq?.date && l.status === 'APPROVED');
                                const docAssignments = currentDayAssignments.filter(a => a.assignedDoctorId === doc.id);
                                
                                // CALCULATE DYNAMIC END TIME BASED ON SHIFTS
                                let dynamicEndTime = null;
                                if (docAssignments.length > 0) {
                                  const endTimes = docAssignments.map(a => {
                                      const isWeekend = currentDayDateObj.getDay() === 0 || currentDayDateObj.getDay() === 6;
                                      return getVisualTimes(a.period, a.shift, isWeekend).end;
                                  });
                                  dynamicEndTime = Math.max(...endTimes);
                                }

                                const endPos = dynamicEndTime ? getRelativePosition(TIME_START_HOUR, dynamicEndTime) : { top: 0, height: 0 };
                                
                                return (
                                <div key={doc.id} className="w-32 flex-shrink-0 border-r border-slate-200 relative bg-white">
                                    {/* Background Grid Lines */}
                                    {hours.map(h => ( <div key={h} style={{ height: PIXELS_PER_HOUR }} className="border-b border-slate-100"></div> ))}

                                    {/* End Time Marker & Greyed Out Area - ONLY IF SHIFTS EXIST */}
                                    {dynamicEndTime && (
                                      <div 
                                          className="absolute w-full z-20 pointer-events-none flex flex-col"
                                          style={{ top: endPos.height, height: (TIME_END_HOUR - dynamicEndTime + 1) * PIXELS_PER_HOUR }}
                                      >
                                          {/* The Block Indicator */}
                                          <div className="w-full bg-slate-700 py-1 flex items-center justify-center shadow-sm border-b border-slate-800">
                                               <span className="text-[10px] font-bold text-white uppercase tracking-wider flex items-center gap-1">
                                                  Slutar {formatDecimalTime(dynamicEndTime)}
                                               </span>
                                          </div>
                                          {/* The Greyed Out Area with pattern */}
                                          <div className="flex-1 w-full bg-slate-100/80" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #f1f5f9 25%, transparent 25%, transparent 50%, #f1f5f9 50%, #f1f5f9 75%, transparent 75%, transparent)', backgroundSize: '10px 10px' }}></div>
                                      </div>
                                    )}

                                    {leave && leave.isFullDay !== false ? (
                                        <div className="absolute inset-0 bg-slate-200/80 m-1 rounded flex items-center justify-center flex-col z-10 border-2 border-slate-300 border-dashed">
                                            <span className="font-extrabold text-slate-500">LEDIG</span>
                                            <span className="text-xs text-slate-400 font-bold">{leave.reason}</span>
                                        </div>
                                    ) : (
                                        <>
                                            {/* Render Partial Leave Block if exists */}
                                            {leave && leave.isFullDay === false && leave.startTime && leave.endTime && (
                                                <div 
                                                    className="absolute inset-x-1 z-20 bg-amber-100/90 border-2 border-amber-300 border-dashed rounded flex items-center justify-center flex-col shadow-sm"
                                                    style={{
                                                        top: (parseFloat(leave.startTime.replace(':', '.')) - TIME_START_HOUR) * PIXELS_PER_HOUR,
                                                        height: (parseFloat(leave.endTime.replace(':', '.')) - parseFloat(leave.startTime.replace(':', '.'))) * PIXELS_PER_HOUR
                                                    }}
                                                >
                                                    <span className="text-[10px] font-extrabold text-amber-800 uppercase tracking-wider">Ledig</span>
                                                    <span className="text-[9px] font-bold text-amber-700">{leave.startTime}-{leave.endTime}</span>
                                                </div>
                                            )}

                                            {/* Render Shifts */}
                                            {docAssignments.map((assignment, idx) => {
                                                const { start, end } = getVisualTimes(assignment.period, assignment.shift, false);
                                                
                                                // Adjust visual position if it's based on timeline
                                                const topPx = (start - TIME_START_HOUR) * PIXELS_PER_HOUR;
                                                const heightPx = (end - start) * PIXELS_PER_HOUR;
                                                
                                                // Determine styling based on type
                                                let style = colors[assignment.shift] || DEFAULT_COLORS[ShiftType.MOTTAGNING];
                                                if (assignment.shift === ShiftType.MOTTAGNING) {
                                                    // Day view can use standard colors or specific override if we wanted distinction FM/EM here too
                                                    // Keeping standard logic for simplicity but ensuring specific tasks pop
                                                }

                                                return (
                                                    <div 
                                                        key={idx}
                                                        className={`absolute inset-x-1 z-10 rounded border-l-4 shadow-sm flex flex-col p-1 overflow-hidden transition-all hover:z-20 hover:scale-[1.02] cursor-pointer
                                                            ${style.bg} ${style.border} ${style.text}
                                                        `}
                                                        style={{ top: topPx, height: heightPx - 4 }} // -4 for spacing
                                                        onClick={() => handleCellClick(doc, currentDayReq.date, assignment.period, assignment)}
                                                    >
                                                        {/* Header for Locked Tasks */}
                                                        {assignment.taskName ? (
                                                            <div className="flex justify-between items-start w-full mb-1">
                                                                <span className="font-extrabold text-[10px] uppercase tracking-wider opacity-90">{assignment.shift}</span>
                                                                {assignment.isManual && <LockClosedIcon className="w-3 h-3 opacity-70" />}
                                                            </div>
                                                        ) : null}
                                                        
                                                        {/* Main Content */}
                                                        <div className="flex-1 flex flex-col justify-center items-center text-center">
                                                            <span className="text-xs font-extrabold leading-tight">
                                                                {assignment.taskName || (assignment.shift === ShiftType.JOUR ? 'JOUR' : assignment.shift)}
                                                            </span>
                                                            {!assignment.taskName && assignment.isManual && (
                                                                <LockClosedIcon className="w-3 h-3 mt-1 opacity-50" />
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                            
                                            {/* Add Button Placeholders (Clicking empty space defaults to adding) */}
                                            <div className="absolute inset-0 z-0 cursor-pointer" onClick={(e) => {
                                                // Simple logic to detect if clicked upper or lower half
                                                const rect = e.currentTarget.getBoundingClientRect();
                                                const y = e.clientY - rect.top;
                                                const isAm = y < (rect.height / 2);
                                                handleCellClick(doc, currentDayReq.date, isAm ? 'FM' : 'EM');
                                            }}></div>
                                        </>
                                    )}
                                </div>
                            )})}
                        </div>
                     </div>
                </div>
            )}
          </div>
        )}

      </main>

      {/* MODALS */}
      {selectedAssignment && ( <ExplainabilityModal assignment={selectedAssignment.a} doctor={selectedAssignment.d} onClose={() => setSelectedAssignment(null)} /> )}
      {editModalData && ( <AdminShiftModal doctor={editModalData.d} date={editModalData.date} period={editModalData.period} currentAssignment={editModalData.a} onSave={handleManualSave} onClose={() => setEditModalData(null)} /> )}
      {doctorModalData.isOpen && ( <DoctorModal doctor={doctorModalData.doctor} onSave={handleSaveDoctor} onClose={() => setDoctorModalData({ isOpen: false })} /> )}
      {isColorModalOpen && ( <ColorConfigModal colors={colors} onSave={(newColors) => { setColors(newColors); setIsColorModalOpen(false); }} onClose={() => setIsColorModalOpen(false)} /> )}
      
      {isApplyingForLeave && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto backdrop-blur-sm">
           <LeaveRequestForm 
              doctor={doctors.find(d => d.id === (currentUser?.doctorId || doctors[0].id)) || doctors[0]} 
              onSubmit={handleLeaveSubmission} 
              onCancel={() => setIsApplyingForLeave(false)} 
           />
        </div>
      )}
    </div>
  );
};

export default App;
