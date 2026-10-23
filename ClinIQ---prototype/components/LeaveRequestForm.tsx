import React, { useState, useMemo } from 'react';
import { Doctor, LeaveRequest } from '../types';
import { Button } from './Button';
import { 
  ChevronLeftIcon, 
  ChevronRightIcon, 
  CalendarDaysIcon, 
  ClockIcon, 
  XMarkIcon, 
  PlusIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';

interface LeaveRequestFormProps {
  doctor: Doctor;
  onSubmit: (requests: LeaveRequest[]) => void;
  onCancel: () => void;
}

// Helper to get days in month
const getDaysInMonth = (year: number, month: number) => {
  return new Date(year, month + 1, 0).getDate();
};

// Helper to get day of week for 1st of month (0-6, 0=Sun)
// Adjusted to 0=Mon, 6=Sun for Swedish calendar
const getFirstDayOfMonth = (year: number, month: number) => {
  const day = new Date(year, month, 1).getDay();
  return day === 0 ? 6 : day - 1;
};

const MONTH_NAMES = ["Januari", "Februari", "Mars", "April", "Maj", "Juni", "Juli", "Augusti", "September", "Oktober", "November", "December"];

export const LeaveRequestForm: React.FC<LeaveRequestFormProps> = ({ doctor, onSubmit, onCancel }) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [reason, setReason] = useState('');
  
  // Single Day Time Selection
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('17:00');
  const [isFullDay, setIsFullDay] = useState(true);

  // Range Deviations: Map of DateString -> { startTime, endTime, isWork }
  // Deviation means: "I am working these hours" (so NOT on leave)
  // OR "I am on leave these hours" (partial leave).
  // The prompt says: "Ange arbetstid endast för den dagen".
  // So if the default is Full Day Leave, a deviation defines WORKING hours.
  // Example: Leave Mon-Fri. Deviation Tue: Work 08-12.
  // Result: Mon (Leave), Tue (Leave 12-17), Wed (Leave), Thu (Leave), Fri (Leave).
  // Wait, if I work 08-12, I am ON LEAVE 12-17.
  // So the generated LeaveRequest for Tue should be: start=12:00, end=17:00.
  // Let's store deviations as "Working Hours".
  const [deviations, setDeviations] = useState<Record<string, { start: string, end: string }>>({});
  const [showDeviationModal, setShowDeviationModal] = useState(false);
  const [deviationDate, setDeviationDate] = useState<string>('');
  const [deviationStart, setDeviationStart] = useState('08:00');
  const [deviationEnd, setDeviationEnd] = useState('12:00');

  // --- CALENDAR LOGIC ---
  const handleDateClick = (date: Date) => {
    if (!startDate || (startDate && endDate)) {
      setStartDate(date);
      setEndDate(null);
      setDeviations({});
    } else {
      // Ensure start is before end
      if (date < startDate) {
        setEndDate(startDate);
        setStartDate(date);
      } else {
        setEndDate(date);
      }
    }
  };

  const isSelected = (date: Date) => {
    if (!startDate) return false;
    if (startDate && !endDate) return date.getTime() === startDate.getTime();
    return date >= startDate && date <= endDate!;
  };

  const isRangeStart = (date: Date) => startDate && date.getTime() === startDate.getTime();
  const isRangeEnd = (date: Date) => endDate && date.getTime() === endDate.getTime();
  const isInRange = (date: Date) => startDate && endDate && date > startDate && date < endDate;

  const renderMonth = (offset: number) => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth() + offset;
    const date = new Date(year, month, 1);
    const displayYear = date.getFullYear();
    const displayMonth = date.getMonth(); // 0-11

    const daysInMonth = getDaysInMonth(displayYear, displayMonth);
    const firstDay = getFirstDayOfMonth(displayYear, displayMonth); // 0=Mon

    const days = [];
    // Empty slots
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} className="h-10 w-10" />);
    }
    // Days
    for (let d = 1; d <= daysInMonth; d++) {
      const currentDate = new Date(displayYear, displayMonth, d);
      const isSel = isSelected(currentDate);
      const isStart = isRangeStart(currentDate);
      const isEnd = isRangeEnd(currentDate);
      const isMiddle = isInRange(currentDate);
      
      let bgClass = '';
      let textClass = 'text-slate-700';
      let roundedClass = 'rounded-full';

      if (isStart || isEnd) {
        bgClass = 'bg-primary text-white font-bold';
        textClass = 'text-white';
        if (isStart && endDate) roundedClass = 'rounded-l-full';
        if (isEnd && startDate) roundedClass = 'rounded-r-full';
        if (isStart && isEnd) roundedClass = 'rounded-full';
      } else if (isMiddle) {
        bgClass = 'bg-sky-100';
        roundedClass = '';
      }

      const dateStr = currentDate.toISOString().split('T')[0];
      const hasDeviation = deviations[dateStr];

      days.push(
        <button 
          key={d} 
          onClick={() => handleDateClick(currentDate)}
          className={`h-10 w-10 flex items-center justify-center text-sm font-medium relative hover:bg-slate-100 transition-colors ${bgClass} ${textClass} ${roundedClass}`}
        >
          {d}
          {hasDeviation && <div className="absolute bottom-1 w-1 h-1 bg-amber-500 rounded-full"></div>}
        </button>
      );
    }

    return (
      <div className="w-full">
        <div className="text-center font-bold text-slate-800 mb-4 capitalize">
          {MONTH_NAMES[displayMonth]} {displayYear}
        </div>
        <div className="grid grid-cols-7 gap-1 mb-2">
          {['M', 'T', 'O', 'T', 'F', 'L', 'S'].map(day => (
            <div key={day} className="text-xs font-bold text-slate-400 text-center">{day}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-1">
          {days}
        </div>
      </div>
    );
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  // --- SUBMISSION LOGIC ---
  const handleSubmit = () => {
    if (!startDate) return;
    
    const requests: LeaveRequest[] = [];
    const end = endDate || startDate;
    
    // Loop through dates
    const current = new Date(startDate);
    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      
      // Check if weekend? Usually leave requests include weekends or skip them?
      // Assuming we request for every day in range, and system filters weekends if needed.
      // Or better: Only create requests for Mon-Fri?
      // Let's include all days, the scheduling logic handles weekends (Jour).
      
      let reqStart = '00:00';
      let reqEnd = '24:00';
      let isFull = true;

      // 1. Single Day Case
      if (startDate.getTime() === end.getTime()) {
        if (!isFullDay) {
          reqStart = startTime;
          reqEnd = endTime;
          isFull = false;
        }
      } 
      // 2. Range Case with Deviations
      else {
        // Default is Full Day Leave
        // Deviation means "Working Hours"
        // If I work 08-12, I am ON LEAVE 12-17 (approx).
        // Wait, if I work 08-12, my LEAVE is the rest of the day.
        // How to represent "Rest of the day"?
        // If I work 08-12, I am NOT on leave 08-12.
        // So Leave is 12:00 - 24:00?
        // Or 00:00 - 08:00 AND 12:00 - 24:00?
        // The current LeaveRequest only supports ONE start/end.
        // Simplification: If deviation says "Work 08-12", we assume the Leave is "12:00 - 17:00" (PM Leave).
        // If deviation says "Work 13-17", Leave is "08:00 - 13:00" (AM Leave).
        // If deviation says "Work 08-17", Leave is None (Delete request).
        
        if (deviations[dateStr]) {
           const dev = deviations[dateStr];
           // Heuristic to determine Leave based on Work
           // Work Start < 10 => Working Morning. Leave is Afternoon.
           // Work Start > 12 => Working Afternoon. Leave is Morning.
           const workStartHour = parseInt(dev.start.split(':')[0]);
           
           if (workStartHour < 10) {
             // Working Morning -> Leave starts at Work End
             reqStart = dev.end;
             reqEnd = '17:00'; // Standard end
             isFull = false;
           } else {
             // Working Afternoon -> Leave ends at Work Start
             reqStart = '08:00'; // Standard start
             reqEnd = dev.start;
             isFull = false;
           }
           
           // If they work full day (e.g. 8-17), we shouldn't create a request.
           // But let's assume deviation implies *some* leave unless explicitly full work.
        }
      }

      requests.push({
        id: Math.random().toString(36).substr(2, 9),
        doctorId: doctor.id,
        date: dateStr,
        status: 'PENDING',
        reason: reason || 'Ledighet',
        isFullDay: isFull,
        startTime: isFull ? undefined : reqStart,
        endTime: isFull ? undefined : reqEnd
      });

      current.setDate(current.getDate() + 1);
    }

    onSubmit(requests);
  };

  const addDeviation = () => {
    if (!deviationDate) return;
    setDeviations(prev => ({
      ...prev,
      [deviationDate]: { start: deviationStart, end: deviationEnd }
    }));
    setShowDeviationModal(false);
  };

  const removeDeviation = (dateStr: string) => {
    const newDevs = { ...deviations };
    delete newDevs[dateStr];
    setDeviations(newDevs);
  };

  const isSingleDay = startDate && endDate && startDate.getTime() === endDate.getTime();
  const isRange = startDate && endDate && startDate.getTime() !== endDate.getTime();

  return (
    <div className="bg-white rounded-xl shadow-xl border-2 border-slate-200 overflow-hidden max-w-4xl w-full mx-auto my-8 animate-in fade-in slide-in-from-bottom-4">
      <div className="bg-slate-50 p-6 border-b border-slate-200 flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-extrabold text-slate-900">Ansök om ledighet</h2>
          <p className="text-slate-500 font-bold">Välj datum och tid för din frånvaro</p>
        </div>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-600">
          <XMarkIcon className="w-8 h-8" />
        </button>
      </div>

      <div className="p-8">
        {/* Step 1: Calendars */}
        <div className="flex flex-col md:flex-row gap-8 mb-8 relative">
          <button onClick={prevMonth} className="absolute left-0 top-2 p-2 hover:bg-slate-100 rounded-full z-10">
            <ChevronLeftIcon className="w-6 h-6 text-slate-600" />
          </button>
          <button onClick={nextMonth} className="absolute right-0 top-2 p-2 hover:bg-slate-100 rounded-full z-10">
            <ChevronRightIcon className="w-6 h-6 text-slate-600" />
          </button>
          
          <div className="flex-1 border-r border-slate-100 pr-4">
            {renderMonth(0)}
          </div>
          <div className="flex-1 pl-4 hidden md:block">
            {renderMonth(1)}
          </div>
        </div>

        {/* Step 2: Configuration */}
        {startDate && (
          <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 mb-6 animate-in fade-in">
            <div className="flex items-center gap-3 mb-4">
              <CalendarDaysIcon className="w-6 h-6 text-primary" />
              <span className="font-extrabold text-lg text-slate-800">
                {startDate.toLocaleDateString('sv-SE')} 
                {endDate && endDate.getTime() !== startDate.getTime() ? ` - ${endDate.toLocaleDateString('sv-SE')}` : ''}
              </span>
            </div>

            {/* Single Day Options */}
            {(!endDate || (endDate && startDate.getTime() === endDate.getTime())) && (
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="radio" 
                    checked={isFullDay} 
                    onChange={() => setIsFullDay(true)} 
                    className="w-5 h-5 text-primary focus:ring-primary" 
                  />
                  <span className="font-bold text-slate-700">Heldag</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="radio" 
                    checked={!isFullDay} 
                    onChange={() => setIsFullDay(false)} 
                    className="w-5 h-5 text-primary focus:ring-primary" 
                  />
                  <span className="font-bold text-slate-700">Del av dag</span>
                </label>
                
                {!isFullDay && (
                  <div className="flex items-center gap-2 ml-4 bg-white p-2 rounded border border-slate-300">
                    <ClockIcon className="w-5 h-5 text-slate-400" />
                    <input 
                      type="time" 
                      value={startTime} 
                      onChange={e => setStartTime(e.target.value)} 
                      className="font-bold text-slate-900 outline-none w-20"
                    />
                    <span className="text-slate-400 font-bold">-</span>
                    <input 
                      type="time" 
                      value={endTime} 
                      onChange={e => setEndTime(e.target.value)} 
                      className="font-bold text-slate-900 outline-none w-20"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Range Options (Deviations) */}
            {isRange && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-bold text-slate-500">Standard: Heldag ledigt alla dagar.</p>
                  <Button variant="secondary" onClick={() => {
                    setDeviationDate(startDate.toISOString().split('T')[0]);
                    setShowDeviationModal(true);
                  }} className="text-xs py-1 px-3">
                    <PlusIcon className="w-4 h-4 mr-1" /> Lägg till avvikelse
                  </Button>
                </div>

                {Object.keys(deviations).length > 0 && (
                  <div className="space-y-2 mt-3">
                    {Object.entries(deviations).map(([date, times]) => (
                      <div key={date} className="flex items-center justify-between bg-white p-3 rounded border border-slate-200 shadow-sm">
                        <div className="flex items-center gap-3">
                          <ExclamationTriangleIcon className="w-5 h-5 text-amber-500" />
                          <span className="font-bold text-slate-800">{date}:</span>
                          <span className="text-sm font-medium text-slate-600">Jobbar {times.start} - {times.end}</span>
                        </div>
                        <button onClick={() => removeDeviation(date)} className="text-red-500 hover:text-red-700 font-bold text-sm">Ta bort</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Reason */}
        <div className="mb-8">
          <label className="block text-base font-bold text-slate-800 mb-2">Orsak (valfritt)</label>
          <input 
            type="text" 
            value={reason} 
            onChange={e => setReason(e.target.value)} 
            className="w-full p-4 border-2 border-slate-300 rounded-lg font-bold bg-white focus:ring-2 focus:ring-primary outline-none"
            placeholder="T.ex. Semester, VAB, Utbildning..."
          />
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 pt-6 border-t border-slate-100">
          <Button variant="secondary" onClick={onCancel} className="px-6 py-3 text-lg">Avbryt</Button>
          <Button onClick={handleSubmit} disabled={!startDate} className="px-8 py-3 text-lg shadow-lg shadow-primary/20">Skicka ansökan</Button>
        </div>
      </div>

      {/* Deviation Modal */}
      {showDeviationModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-2xl border-2 border-slate-300">
            <h3 className="text-xl font-extrabold text-slate-900 mb-4">Lägg till avvikelse</h3>
            <p className="text-sm font-bold text-slate-500 mb-4">Välj dag och ange när du JOBBAR.</p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Datum</label>
                <select 
                  value={deviationDate} 
                  onChange={e => setDeviationDate(e.target.value)}
                  className="w-full p-3 border-2 border-slate-300 rounded font-bold"
                >
                  {(() => {
                    const opts = [];
                    const curr = new Date(startDate!);
                    const end = endDate || startDate!;
                    while (curr <= end) {
                      const dStr = curr.toISOString().split('T')[0];
                      opts.push(<option key={dStr} value={dStr}>{dStr}</option>);
                      curr.setDate(curr.getDate() + 1);
                    }
                    return opts;
                  })()}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Arbetstid (När du är på plats)</label>
                <div className="flex items-center gap-2">
                  <input type="time" value={deviationStart} onChange={e => setDeviationStart(e.target.value)} className="flex-1 p-3 border-2 border-slate-300 rounded font-bold" />
                  <span>-</span>
                  <input type="time" value={deviationEnd} onChange={e => setDeviationEnd(e.target.value)} className="flex-1 p-3 border-2 border-slate-300 rounded font-bold" />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <Button variant="secondary" onClick={() => setShowDeviationModal(false)}>Avbryt</Button>
              <Button onClick={addDeviation}>Lägg till</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
