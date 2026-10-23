"""ClinIQ - schemaläggning med Google OR-Tools (CP-SAT).

Hela perioden optimeras på en gång (inte dag för dag som den gamla
TypeScript-logiken), så t.ex. jourbördan kan fördelas rättvist över hela
horisonten och "hårda" krav kan garanteras istället för att bara hoppas på
att en girig algoritm råkar klara dem.

Hårda regler (kan aldrig brytas av modellen):
  * En läkare har högst ett pass per halvdag (FM/EM).
  * Bara pass som läkaren har kompetens för.
  * Ingen schemaläggs under godkänd ledighet eller utanför sin arbetstid.
  * Låsta återkommande uppgifter (BVC, SÄBO, OM ...) ligger fast.
  * Max ett jourpass per läkare och dygn.

"Mjuka" regler (modellen försöker, och varnar när det inte går):
  * Jourpass, ägarmöte, dagens kvoter per passtyp och bemanningsminimum.
  * Tak för antal läkare per dag (maxDoctors).
  * Rättvis jourfördelning (även helger), vila mellan jourpass,
    önskemål om admin, samt att inte lämna betald personal oanvänd.

Indata/utdata använder exakt samma JSON-former och textvärden som frontendens
types.ts ('Mottagning', 'Jour', 'SÄBO', 'Specialist' osv).
"""
from __future__ import annotations

import json
import math
import os
import time
from datetime import date as Date
from typing import Any

from ortools.sat.python import cp_model

# --- Textvärden (identiska med enums i frontendens types.ts) ---
MOTTAGNING = "Mottagning"
JOUR = "Jour"
ADMIN = "Admin"
BVC = "BVC"
SABO = "SÄBO"
OM = "OM"
SAKNAS = "BEMANNING SAKNAS"
MEETING = "Möte"

SPECIALIST = "Specialist"
ST = "ST-läkare"

FM, EM = "FM", "EM"
PERIODS = (FM, EM)

# Passtyper som fylls enligt dagens krav (requiredShifts), förutom Jour/Möte.
QUOTA_SHIFTS = (BVC, SABO, OM, ADMIN, MOTTAGNING)

DAY_NAMES_SV = ["Söndag", "Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag"]

# --- Vikter i målfunktionen (lägre total = bättre schema) ---
# De stora talen betyder "bryt helst aldrig"; de små är finjustering.
W = {
    "SHORT_JOUR": 100_000,        # saknat jourpass
    "SHORT_MEETING": 50_000,      # saknad deltagare på ägarmöte
    "SHORT_MIN_TOTAL": 20_000,    # för få läkare på plats
    "SHORT_MIN_SPEC": 20_000,     # för få specialister på plats
    "SHORT_QUOTA": 10_000,        # kravet för en passtyp ej uppfyllt
    "OVER_MAX_DOCTORS": 15_000,   # fler läkare än maxDoctors
    "SHORT_LATE": 5_000,          # för få kvar till 17:00
    "JOUR_CONSECUTIVE": 300,      # jour två dagar i rad
    "JOUR_GAP2": 60,              # jour med bara en dag emellan
    "JOUR_FAIRNESS": 40,          # per jourpass från "rättvis andel"
    "WEEKEND_FAIRNESS": 25,       # per helgjour från "rättvis andel"
    "ADMIN_PREF": -30,            # belöning när admin-önskemål uppfylls
    "ADMIN_PREF_SPREAD": 15,      # önskemål ska fördelas jämnt mellan läkare
    "FILL_IDLE": -2,              # liten belöning för extra Mottagning
}
JOUR_ROLE_COST = {SPECIALIST: 0, ST: 8}   # specialister föredras lite för jour
FATIGUE_PER_JOUR_UNIT = 10                # ~ hur mycket "trötthet" som motsvarar ett jourpass


# --------------------------------------------------------------------------
# Hjälpfunktioner
# --------------------------------------------------------------------------
def _hours(value: str | None, default: float) -> float:
    if not value:
        return default
    try:
        h, m = value.split(":")[:2]
        return int(h) + int(m) / 60
    except (ValueError, AttributeError):
        return default


def _js_weekday(d: Date) -> int:
    """JavaScripts getDay(): 0 = söndag ... 6 = lördag."""
    return (d.weekday() + 1) % 7


def _periods_overlapping(start: float, end: float) -> set[str]:
    """Samma överlappsregel som frontendens ledighetslogik: FM ~ 08-12, EM ~ 13-17."""
    out: set[str] = set()
    if start < 11.5 and end > 8.5:
        out.add(FM)
    if start < 16.5 and end > 13.5:
        out.add(EM)
    return out


def _leave_blocked(leave: dict) -> set[str]:
    if leave.get("isFullDay") is not False:
        return {FM, EM}
    return _periods_overlapping(_hours(leave.get("startTime"), 0.0), _hours(leave.get("endTime"), 24.0))


def _task_shift_type(name: str) -> str:
    """Samma namnbaserade tolkning som den gamla logiken."""
    if "BVC" in name:
        return BVC
    if "SÄBO" in name or "Vallon" in name or "Attendo" in name:
        return SABO
    if "OM" in name or "Ortoped" in name:
        return OM
    if "Mottagning" in name:
        return MOTTAGNING
    return ADMIN


def _display_task_name(name: str) -> str:
    if "BVC" in name:
        return "BVC"
    if "OM" in name:
        return "OM (Ortoped)"
    return name


def _wants_admin(doc: dict, day_name: str) -> bool:
    return any("admin" in p.lower() and day_name.lower() in p.lower() for p in doc.get("preferences", []))


# --------------------------------------------------------------------------
# Huvudfunktion
# --------------------------------------------------------------------------
def solve(payload: dict[str, Any]) -> dict[str, Any]:
    t_start = time.time()

    docs: list[dict] = payload["doctors"]
    reqs: list[dict] = payload["requirements"]
    leaves: list[dict] = [l for l in payload.get("leaves", []) if l.get("status") == "APPROVED"]
    config: dict = payload["config"]
    options: dict = payload.get("options", {}) or {}

    time_limit = float(options.get("timeLimitSeconds", 2.0))   # deterministisk "tidsbudget" för hela perioden
    fill_idle = bool(options.get("fillIdleWithMottagning", True))
    workers = int(options.get("numWorkers", 1))  # 1 = samma schema varje gång

    if not docs:
        raise ValueError("Inga läkare i indata.")
    if not reqs:
        raise ValueError("Inga dagar (requirements) i indata.")

    D, T = len(docs), len(reqs)
    id_to_idx = {d["id"]: i for i, d in enumerate(docs)}
    base_cfg = config["base"]
    meeting_cfg = config.get("ownerMeeting") or {}
    tasks = config.get("recurringTasks", [])
    deviations = config.get("deviations", [])

    # ---- Förberäkna per dag -------------------------------------------------
    dates = [Date.fromisoformat(r["date"][:10]) for r in reqs]
    ordinals = [d.toordinal() for d in dates]
    wd = [_js_weekday(d) for d in dates]
    day_name = [DAY_NAMES_SV[i] for i in wd]
    is_weekend = [i in (0, 6) for i in wd]
    required = [r.get("requiredShifts", {}) or {} for r in reqs]

    def active_deviation(d: Date):
        for dev in deviations:
            if Date.fromisoformat(dev["startDate"][:10]) <= d <= Date.fromisoformat(dev["endDate"][:10]):
                return dev
        return None

    day_dev = [active_deviation(d) for d in dates]
    day_counts = [(dev["counts"] if dev else base_cfg) for dev in day_dev]

    # Tillgänglighet: vilka halvdagar kan läkare di jobba dag t?
    std_avail: list[list[set[str]]] = [[set() for _ in range(T)] for _ in range(D)]
    jour_avail: list[list[set[str]]] = [[set() for _ in range(T)] for _ in range(D)]
    late_ok: list[list[bool]] = [[False] * T for _ in range(D)]

    blocked: dict[tuple[int, int], set[str]] = {}
    date_strs = [r["date"][:10] for r in reqs]
    for l in leaves:
        di = id_to_idx.get(l["doctorId"])
        if di is None or l["date"][:10] not in date_strs:
            continue
        t = date_strs.index(l["date"][:10])
        blocked.setdefault((di, t), set()).update(_leave_blocked(l))

    for di, doc in enumerate(docs):
        for t in range(T):
            cfg = next((c for c in doc.get("baseSchedule", []) if c["dayIndex"] == wd[t]), None)
            lb = blocked.get((di, t), set())
            if cfg and not cfg.get("isOff"):
                s, e = _hours(cfg.get("start"), 8.0), _hours(cfg.get("end"), 17.0)
                std_avail[di][t] = _periods_overlapping(s, e) - lb
                end_for_late = min(e, _hours(doc.get("defaultEndTime"), e))
                late_ok[di][t] = end_for_late >= 17.0
            if JOUR in doc.get("competence", []):
                # Jour får läggas på helger oavsett ordinarie schema (som förut),
                # men på vardagar måste läkaren faktiskt jobba den dagen.
                jour_avail[di][t] = ({FM, EM} - lb) if is_weekend[t] else set(std_avail[di][t])

    # ---- Låsta återkommande uppgifter (BVC, SÄBO, OM ...) ------------------
    locked: dict[tuple[int, int], tuple[str, str, str]] = {}   # (di,t) -> (shift, taskName, reason)
    locked_count = [dict() for _ in range(T)]                  # t -> {shift: n}
    warnings: list[dict] = []
    schedule: list[dict] = []

    for t in range(T):
        for task in tasks:
            if not any(day_name[t].find(d.split(" ")[0]) >= 0 for d in task.get("days", [])):
                continue
            primary = task.get("assignedDoctorId", "UNASSIGNED")
            if primary == "UNASSIGNED":
                continue   # ingen är utpekad -> inget att låsa (kvoten fylls av optimeraren)
            shift = _task_shift_type(task["name"])
            chain = [("PRIMARY", primary),
                     ("BACKUP1", task.get("backup1DoctorId", "UNASSIGNED")),
                     ("BACKUP2", task.get("backup2DoctorId", "UNASSIGNED"))]
            resolved, cancelled = None, False
            for label, ref in chain:
                if ref == "UNASSIGNED":
                    continue
                if ref == "CANCEL":
                    cancelled = True
                    break
                di = id_to_idx.get(ref)
                if di is not None and FM in std_avail[di][t] and (di, t) not in locked:
                    resolved = (di, label)
                    break
            if cancelled:
                warnings.append({"date": date_strs[t], "type": "INFO",
                                 "message": f"{task['name']} inställd pga frånvaro."})
            elif resolved:
                di, label = resolved
                suffix = {"PRIMARY": "", "BACKUP1": " (reserv 1)", "BACKUP2": " (reserv 2)"}[label]
                locked[(di, t)] = (shift, _display_task_name(task["name"]), f"Låst uppgift: {task['name']}{suffix}")
                locked_count[t][shift] = locked_count[t].get(shift, 0) + 1
            else:
                schedule.append({"date": date_strs[t], "period": FM, "shift": SAKNAS, "assignedDoctorId": "N/A",
                                 "aiExplanation": f"Kunde ej bemanna {task['name']}", "scoreSnapshot": 0,
                                 "taskName": task["name"]})
                warnings.append({"date": date_strs[t], "type": "INFO",
                                 "message": f"Kunde ej bemanna {task['name']}."})

    # ---- Modell (löses i glidande fönster) --------------------------------------
    # Hela perioden i en enda modell blir tung att lösa snabbt. Därför optimeras
    # perioden i fönster om `windowDays` dagar (standard 14). Jourbelastning,
    # helgjour, vilodagar och admin-önskemål förs över från fönster till fönster,
    # så rättvisan gäller fortfarande hela perioden.
    window_days = int(options.get("windowDays", 14)) or T
    windows = [(lo, min(lo + window_days, T)) for lo in range(0, T, window_days)]

    meeting_day = [
        bool(meeting_cfg.get("isActive"))
        and dates[t].month - 1 in meeting_cfg.get("months", [])
        and wd[t] == meeting_cfg.get("dayOfWeek")
        and dates[t].day <= 7
        for t in range(T)
    ]
    jour_fm = [math.ceil(int(required[t].get(JOUR, 0)) / 2) for t in range(T)]
    jour_em = [int(required[t].get(JOUR, 0)) // 2 for t in range(T)]
    is_spec = [d.get("role") == SPECIALIST for d in docs]

    prior = {di: int(docs[di].get("accumulatedFatigue", 0)) // FATIGUE_PER_JOUR_UNIT for di in range(D)}
    # Löpande tillstånd som förs mellan fönster
    jour_load = dict(prior)                                   # tidigare belastning + jour hittills
    weekend_load = {di: 0 for di in range(D)}                 # helgjour hittills
    last_jour_ord = {di: ordinals[0] - int(docs[di].get("daysSinceLastJour", 14)) for di in range(D)}
    admin_sat = {di: 0 for di in range(D)}                    # uppfyllda admin-önskemål hittills

    chosen: list[tuple[int, int, str, str]] = []
    statuses: list[str] = []
    total_obj = 0.0
    total_vars = 0

    def free_capacity(t: int, shift: str) -> int | None:
        """Hur många EXTRA pass av typen får optimeraren lägga ut (utöver låsta). None = obegränsat."""
        need = int(required[t].get(shift, 0))
        if shift == MOTTAGNING and fill_idle:
            return None
        return max(need - locked_count[t].get(shift, 0), 0)

    def run_window(lo: int, hi: int, limit: float) -> None:
        nonlocal total_obj, total_vars
        m = cp_model.CpModel()
        x: dict[tuple[int, int, str, str], Any] = {}
        obj: list = []
        days = range(lo, hi)

        # Variabler
        for di, doc in enumerate(docs):
            comp = set(doc.get("competence", []))
            for t in days:
                for p in PERIODS:
                    if p == FM and (di, t) in locked:
                        continue  # FM är upptagen av låst uppgift
                    if JOUR in comp and p in jour_avail[di][t] and (jour_fm[t] if p == FM else jour_em[t]) > 0:
                        x[di, t, p, JOUR] = m.NewBoolVar(f"jour_{di}_{t}_{p}")
                    if p in std_avail[di][t]:
                        for shift in QUOTA_SHIFTS:
                            if shift in comp:
                                cap = free_capacity(t, shift)
                                if cap is None or cap > 0:
                                    x[di, t, p, shift] = m.NewBoolVar(f"{shift}_{di}_{t}_{p}")
                        if p == FM and meeting_day[t] and doc.get("role") == meeting_cfg.get("requiredRole"):
                            x[di, t, p, MEETING] = m.NewBoolVar(f"meet_{di}_{t}")

        by_slot: dict[tuple[int, int, str], list] = {}
        by_day_shift: dict[tuple[int, str, str], list] = {}
        by_doc_day: dict[tuple[int, int], list] = {}
        for (di, t, p, shift), v in x.items():
            by_slot.setdefault((di, t, p), []).append(v)
            by_day_shift.setdefault((t, shift, p), []).append(v)
            by_doc_day.setdefault((di, t), []).append(v)

        # Högst ett pass per läkare och halvdag; högst ett jourpass per läkare och dygn
        for vs in by_slot.values():
            if len(vs) > 1:
                m.AddAtMostOne(vs)
        for di in range(D):
            for t in days:
                jv = [x[di, t, p, JOUR] for p in PERIODS if (di, t, p, JOUR) in x]
                if len(jv) > 1:
                    m.AddAtMostOne(jv)

        short_jour, short_meeting, short_quota, over_max, short_staff = [], [], [], [], []

        for t in days:
            # Jour: exakt så många som kravet säger (med "saknas"-slack)
            for p, n in ((FM, jour_fm[t]), (EM, jour_em[t])):
                if n > 0:
                    s = m.NewIntVar(0, n, f"short_jour_{t}_{p}")
                    m.Add(sum(by_day_shift.get((t, JOUR, p), [])) + s == n)
                    obj.append(W["SHORT_JOUR"] * s)
                    short_jour.append((t, p, s))

            # Ägarmöte
            if meeting_day[t]:
                n = int(meeting_cfg.get("requiredCount", 0))
                s = m.NewIntVar(0, n, f"short_meet_{t}")
                m.Add(sum(by_day_shift.get((t, MEETING, FM), [])) + s == n)
                obj.append(W["SHORT_MEETING"] * s)
                short_meeting.append((t, s, n))

            # Kvoter per passtyp (låsta uppgifter räknas med)
            for shift in QUOTA_SHIFTS:
                need = int(required[t].get(shift, 0))
                lc = locked_count[t].get(shift, 0)
                vs = by_day_shift.get((t, shift, FM), []) + by_day_shift.get((t, shift, EM), [])
                if need - lc > 0:
                    s = m.NewIntVar(0, need - lc, f"short_{shift}_{t}")
                    m.Add(sum(vs) + s >= need - lc)
                    obj.append(W["SHORT_QUOTA"] * s)
                    short_quota.append((t, shift, s, need))
                if shift != MOTTAGNING or not fill_idle:
                    if vs:
                        m.Add(sum(vs) <= max(need - lc, 0))

        # "Arbetar läkare di dag t?" och "arbetar till 17:00?"
        works: dict[tuple[int, int], Any] = {}
        late: dict[tuple[int, int], Any] = {}
        for di in range(D):
            for t in days:
                if (di, t) in locked:
                    works[di, t] = 1
                else:
                    vs = by_doc_day.get((di, t), [])
                    if vs:
                        w = m.NewBoolVar(f"works_{di}_{t}")
                        m.AddMaxEquality(w, vs)
                        works[di, t] = w
                em_vs = [x[di, t, EM, s] for s in (JOUR, *QUOTA_SHIFTS) if (di, t, EM, s) in x]
                if em_vs and late_ok[di][t]:
                    lv = m.NewBoolVar(f"late_{di}_{t}")
                    m.AddMaxEquality(lv, em_vs)
                    late[di, t] = lv

        for t in days:
            counts = day_counts[t]
            total_w = sum(works[di, t] for di in range(D) if (di, t) in works)

            # Tak för antal läkare
            ov = m.NewIntVar(0, D, f"over_max_{t}")
            m.Add(total_w - int(counts["maxDoctors"]) <= ov)
            obj.append(W["OVER_MAX_DOCTORS"] * ov)
            over_max.append((t, ov))

            # Minst så många läkare på plats: dagens egna minimum (admin kan ändra per dag),
            # eller avvikelseperiodens värde (t.ex. julveckan) på vardagar.
            min_total = int(counts["minTotalDaily"]) if (day_dev[t] and not is_weekend[t]) else int(reqs[t].get("minStaff", 0))
            if min_total > 0:
                s = m.NewIntVar(0, min_total, f"short_total_{t}")
                m.Add(total_w + s >= min_total)
                obj.append(W["SHORT_MIN_TOTAL"] * s)
                short_staff.append((t, "total", s, min_total))

            if not is_weekend[t]:
                checks = [
                    ("spec", int(counts["minSpecDaily"]), sum(works[di, t] for di in range(D) if is_spec[di] and (di, t) in works), W["SHORT_MIN_SPEC"]),
                    ("late", int(counts["minTotalLate"]), sum(late[di, t] for di in range(D) if (di, t) in late), W["SHORT_LATE"]),
                    ("speclate", int(counts["minSpecLate"]), sum(late[di, t] for di in range(D) if is_spec[di] and (di, t) in late), W["SHORT_LATE"]),
                ]
                for kind, need, have, weight in checks:
                    if need > 0:
                        s = m.NewIntVar(0, need, f"short_{kind}_{t}")
                        m.Add(have + s >= need)
                        obj.append(weight * s)
                        short_staff.append((t, kind, s, need))

        # ---- Rättvis jourfördelning (med belastning från tidigare fönster) ----------
        jour_by_doc = {di: [(t, v) for (d_, t, p, s), v in x.items() if d_ == di and s == JOUR] for di in range(D)}
        eligible = [di for di in range(D) if jour_by_doc[di]]
        slots = sum(jour_fm[t] + jour_em[t] for t in days)

        def level(exprs: dict[int, Any], target: int, weight: int, name: str):
            for di, e in exprs.items():
                dv = m.NewIntVar(0, 10_000, f"{name}_{di}")
                m.Add(e - target <= dv)
                m.Add(target - e <= dv)
                obj.append(weight * dv)

        if eligible and slots:
            target = round((sum(jour_load[d] for d in eligible) + slots) / len(eligible))
            level({di: jour_load[di] + sum(v for _, v in jour_by_doc[di]) for di in eligible}, target, W["JOUR_FAIRNESS"], "jfair")

            wk_slots = sum(jour_fm[t] + jour_em[t] for t in days if is_weekend[t])
            if wk_slots:
                wk_target = round((sum(weekend_load[d] for d in eligible) + wk_slots) / len(eligible))
                level({di: weekend_load[di] + sum(v for t, v in jour_by_doc[di] if is_weekend[t]) for di in eligible},
                      wk_target, W["WEEKEND_FAIRNESS"], "wfair")

            for di in eligible:
                role_cost = JOUR_ROLE_COST.get(docs[di].get("role"), 0)
                if role_cost:
                    for _, v in jour_by_doc[di]:
                        obj.append(role_cost * v)

            # Vila mellan jourpass (mjukt) - även mot förra fönstrets sista jourpass
            jday = {(di, t): sum(x[di, t, p, JOUR] for p in PERIODS if (di, t, p, JOUR) in x) for di in eligible for t in days}
            for di in eligible:
                for t in days:
                    if not any((di, t, p, JOUR) in x for p in PERIODS):
                        continue
                    dist_prev = ordinals[t] - last_jour_ord[di]
                    if dist_prev <= 1:
                        obj.append(W["JOUR_CONSECUTIVE"] * jday[di, t])
                    elif dist_prev == 2:
                        obj.append(W["JOUR_GAP2"] * jday[di, t])
                    for t2 in range(t + 1, min(t + 3, hi)):
                        gap = ordinals[t2] - ordinals[t]
                        if gap > 2 or not any((di, t2, p, JOUR) in x for p in PERIODS):
                            continue
                        pv = m.NewBoolVar(f"rest_{di}_{t}_{t2}")
                        m.Add(jday[di, t] + jday[di, t2] - 1 <= pv)
                        obj.append((W["JOUR_CONSECUTIVE"] if gap == 1 else W["JOUR_GAP2"]) * pv)

        # ---- Önskemål: admin (fördelas jämnt över hela perioden) ----------------------
        pref_vars: dict[int, list] = {}
        for (di, t, p, shift), v in x.items():
            if shift == ADMIN and _wants_admin(docs[di], day_name[t]):
                pref_vars.setdefault(di, []).append(v)
                obj.append(W["ADMIN_PREF"] * v)
        if len(pref_vars) > 1:
            sats = {di: admin_sat[di] + sum(vs) for di, vs in pref_vars.items()}
            hi_v, lo_v = m.NewIntVar(0, T * 2, "pref_hi"), m.NewIntVar(0, T * 2, "pref_lo")
            for e in sats.values():
                m.Add(hi_v >= e)
                m.Add(lo_v <= e)
            obj.append(W["ADMIN_PREF_SPREAD"] * (hi_v - lo_v))

        # ---- Fyll outnyttjad tid med mottagning ------------------------------------
        if fill_idle:
            for (di, t, p, shift), v in x.items():
                if shift == MOTTAGNING:
                    obj.append(W["FILL_IDLE"] * v)

        m.Minimize(sum(obj))
        solver = cp_model.CpSolver()
        # Deterministisk tidsgräns => samma indata ger samma schema varje gång.
        # (Väggklockan är bara ett skyddsnät om datorn är mycket långsam.)
        # Är något krav ouppfyllt när tiden tagit slut får solvern en längre tid och
        # fortsätter från föregående lösning. Efter några försök antar vi att kravet
        # verkligen inte går att uppfylla (t.ex. för många lediga) och varnar istället.
        slack_vars = ([s for _, _, s in short_jour] + [s for _, s, _ in short_meeting]
                      + [s for _, _, s, _ in short_quota] + [ov for _, ov in over_max]
                      + [s for _, _, s, _ in short_staff])
        det_limit = max(0.05, limit)
        status = cp_model.UNKNOWN
        for attempt in range(3):
            solver.parameters.max_deterministic_time = det_limit
            solver.parameters.max_time_in_seconds = max(5.0, det_limit * 4)
            status = solver.Solve(m)
            solved = status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
            if status == cp_model.OPTIMAL or (solved and all(solver.Value(s) == 0 for s in slack_vars)):
                break
            if solved:   # fortsätt från bästa lösning hittills
                m.ClearHints()
                for i, val in enumerate(solver.ResponseProto().solution):
                    m.AddHint(m.GetIntVarFromProtoIndex(i), val)
            det_limit *= 3
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            raise ValueError(f"Hittade ingen lösning för {date_strs[lo]}-{date_strs[hi - 1]} (status: {solver.StatusName(status)}).")
        statuses.append(solver.StatusName(status))
        total_obj += solver.ObjectiveValue()
        total_vars += len(x)

        # Spara valen och uppdatera tillståndet inför nästa fönster
        win_chosen = [k for k, v in x.items() if solver.Value(v)]
        chosen.extend(win_chosen)
        for (di, t, p, shift) in sorted(win_chosen, key=lambda k: (k[1], k[2])):
            if shift == JOUR:
                jour_load[di] += 1
                last_jour_ord[di] = ordinals[t]
                if is_weekend[t]:
                    weekend_load[di] += 1
            elif shift == ADMIN and _wants_admin(docs[di], day_name[t]):
                admin_sat[di] += 1

        # Varningar för det här fönstret
        for t, p, s in short_jour:
            n = solver.Value(s)
            if n:
                warnings.append({"date": date_strs[t], "type": "CRITICAL", "message": f"Jour-plats ({p}) saknas."})
                for _ in range(n):
                    schedule.append({"date": date_strs[t], "period": p, "shift": SAKNAS, "assignedDoctorId": "N/A",
                                     "aiExplanation": "Ingen tillgänglig.", "scoreSnapshot": 0})
        for t, s, n in short_meeting:
            got = n - solver.Value(s)
            if got < n:
                warnings.append({"date": date_strs[t], "type": "INFO",
                                 "message": f"Ägarmöte: Kunde bara hitta {got}/{n} specialister."})
        for t, shift, s, need in short_quota:
            short = solver.Value(s)
            if short:
                warnings.append({"date": date_strs[t], "type": "INFO",
                                 "message": f"Behov av {shift} ej fyllt: {need - short}/{need}."})
        texts = {"total": "läkare bemannade (min totalt)", "spec": "specialister bemannade",
                 "late": "läkare kvar fram till 17:00", "speclate": "specialister kvar fram till 17:00"}
        for t, kind, s, need in short_staff:
            short = solver.Value(s)
            if short:
                warnings.append({"date": date_strs[t], "type": "CRITICAL" if kind in ("total", "spec") else "INFO",
                                 "message": f"Endast {need - short}/{need} {texts[kind]}."})
        for t, ov in over_max:
            if solver.Value(ov):
                mx = int(day_counts[t]["maxDoctors"])
                warnings.append({"date": date_strs[t], "type": "INFO",
                                 "message": f"{mx + solver.Value(ov)} läkare schemalagda, över taket på {mx}."})

    per_window = time_limit / len(windows)
    for lo, hi in windows:
        run_window(lo, hi, per_window)

    # ---- Skapa schemarader ------------------------------------------------------
    # Förklaringar för jour: hur många jourpass hade läkaren före, och hur länge sedan förra?
    jour_hist: dict[int, list[int]] = {}
    for (di, t, p, shift) in sorted(chosen, key=lambda c: (c[1], c[2])):
        if shift == JOUR:
            jour_hist.setdefault(di, []).append(t)

    def jour_explanation(di: int, t: int) -> tuple[str, float]:
        doc = docs[di]
        before = [tt for tt in jour_hist[di] if tt < t]
        base = prior[di]
        score = float(base + len(before))
        if before:
            gap = ordinals[t] - ordinals[before[-1]]
        else:
            gap = ordinals[t] - ordinals[0] + int(doc.get("daysSinceLastJour", 14))
        factors = []
        if gap >= 14:
            factors.append({"label": "Återhämtning", "text": "Lång tid sedan förra jourpasset", "positive": True})
        if base >= 5:
            factors.append({"label": "Belastning", "text": "Hög tidigare arbetsbörda", "positive": False})
        if is_weekend[t]:
            factors.append({"label": "Helgpass", "text": "Helgjour fördelas rättvist mellan läkare", "positive": True})
        details = [
            f"Tidigare belastning (+{base})",
            f"Jourpass tidigare i perioden (+{len(before)})",
            f"Dagar sedan förra jour ({gap})",
            f"Rollbas (+{JOUR_ROLE_COST.get(doc.get('role'), 0)})",
            "Optimerat med OR-Tools CP-SAT",
        ]
        summary = f"{doc['name']} valdes av optimeraren för att fördela jourbördan så rättvist som möjligt."
        return json.dumps({"summary": summary, "score": score, "factors": factors, "details": details},
                          ensure_ascii=False), score

    for (di, t, p, shift) in chosen:
        doc = docs[di]
        row = {"date": date_strs[t], "period": p, "shift": shift, "assignedDoctorId": doc["id"],
               "aiExplanation": "", "scoreSnapshot": 0, "isManual": False}
        if shift == JOUR:
            row["aiExplanation"], row["scoreSnapshot"] = jour_explanation(di, t)
        elif shift == MEETING:
            row.update(aiExplanation="Ägarmöte (Låst)", isManual=True, taskName=meeting_cfg.get("name"))
        elif shift == ADMIN and _wants_admin(doc, day_name[t]):
            row["aiExplanation"] = "Matchar preferens: Admin"
        elif shift == MOTTAGNING:
            row["aiExplanation"] = "Generell schemaläggning (Fyllnad)"
        else:
            row["aiExplanation"] = f"Bemannar behov: {shift}"
        schedule.append(row)

    for (di, t), (shift, name, reason) in locked.items():
        schedule.append({"date": date_strs[t], "period": FM, "shift": shift, "assignedDoctorId": docs[di]["id"],
                         "aiExplanation": reason, "scoreSnapshot": 0, "isManual": True, "taskName": name})

    order = {FM: 0, EM: 1}
    schedule.sort(key=lambda r: (r["date"], order[r["period"]], r["shift"], r["assignedDoctorId"]))
    warnings.sort(key=lambda w: (w["date"], 0 if w["type"] == "CRITICAL" else 1))

    return {
        "schedule": schedule,
        "warnings": warnings,
        "stats": {
            "status": "OPTIMAL" if all(s == "OPTIMAL" for s in statuses) else "FEASIBLE",
            "windows": len(windows),
            "objective": total_obj,
            "solveSeconds": round(time.time() - t_start, 2),
            "variables": total_vars,
        },
    }
