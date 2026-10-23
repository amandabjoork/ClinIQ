"""Oberoende kontroll av att solverns schema följer reglerna.

Kör:  python tests/test_solver.py        (eller: pytest tests)

Valideringen är medvetet skriven separat från model.py och räknar ut allt på
nytt från rådata, så att ett fel i modellen inte kan gömma sig själv.
"""
import copy
import json
import os
import sys
from collections import Counter, defaultdict
from datetime import date as Date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from model import solve  # noqa: E402

with open(os.path.join(os.path.dirname(__file__), "sample_payload.json"), encoding="utf-8") as f:
    SAMPLE = json.load(f)

JOUR, MOTT, ADMIN, BVC, SABO, OM, MEETING, SAKNAS = "Jour", "Mottagning", "Admin", "BVC", "SÄBO", "OM", "Möte", "BEMANNING SAKNAS"


def hours(s):
    h, m = s.split(":")
    return int(h) + int(m) / 60


def js_wd(d):
    return (Date.fromisoformat(d).weekday() + 1) % 7


def validate(payload, result):
    """Returnerar en lista med regelbrott (tom lista = allt OK)."""
    errors = []
    docs = {d["id"]: d for d in payload["doctors"]}
    rows = [r for r in result["schedule"] if r["shift"] != SAKNAS]
    saknas = [r for r in result["schedule"] if r["shift"] == SAKNAS]
    leaves = [l for l in payload["leaves"] if l["status"] == "APPROVED"]

    # 1. Aldrig dubbelbokad
    slots = Counter((r["assignedDoctorId"], r["date"], r["period"]) for r in rows)
    errors += [f"Dubbelbokad: {k}" for k, n in slots.items() if n > 1]

    for r in rows:
        doc, wd = docs[r["assignedDoctorId"]], js_wd(r["date"])
        weekend = wd in (0, 6)
        # 2. Kompetens (ägarmöte kräver roll, inte kompetens)
        # (Låsta uppgifter är ett uttryckligt adminval och respekteras även utan kompetens.)
        if r["shift"] != MEETING and not r.get("isManual") and r["shift"] not in doc["competence"]:
            errors.append(f"Saknar kompetens: {doc['name']} {r['shift']} {r['date']}")
        # 3. Arbetsdag
        cfg = next(c for c in doc["baseSchedule"] if c["dayIndex"] == wd)
        if weekend and r["shift"] != JOUR:
            errors.append(f"Annat än jour på helg: {doc['name']} {r['date']}")
        if not weekend and cfg["isOff"]:
            errors.append(f"Schemalagd på ledig dag: {doc['name']} {r['date']}")
        if not weekend and not cfg["isOff"]:
            s, e = hours(cfg["start"]), hours(cfg["end"])
            if r["period"] == "EM" and not (s < 16.5 and e > 13.5):
                errors.append(f"EM utanför arbetstid: {doc['name']} {r['date']}")
        # 4. Ledighet
        for l in leaves:
            if l["doctorId"] == doc["id"] and l["date"] == r["date"]:
                if l.get("isFullDay") is not False:
                    errors.append(f"Schemalagd under ledighet: {doc['name']} {r['date']}")
                else:
                    s, e = hours(l["startTime"]), hours(l["endTime"])
                    blocked = ("FM" if s < 11.5 and e > 8.5 else None, "EM" if s < 16.5 and e > 13.5 else None)
                    if r["period"] in blocked:
                        errors.append(f"Schemalagd under delledighet: {doc['name']} {r['date']} {r['period']}")

    by_day = defaultdict(list)
    for r in rows:
        by_day[r["date"]].append(r)

    n_saknas_jour = Counter((r["date"]) for r in saknas if r.get("taskName") is None)
    for req in payload["requirements"]:
        day = req["date"]
        today = by_day.get(day, [])
        need_jour = req["requiredShifts"].get(JOUR, 0)
        jour = [r for r in today if r["shift"] == JOUR]
        # 5. Jourkrav uppfyllt (eller redovisat som BEMANNING SAKNAS)
        if len(jour) + n_saknas_jour.get(day, 0) != need_jour:
            errors.append(f"Fel antal jour {day}: {len(jour)} (+{n_saknas_jour.get(day, 0)} saknas) av {need_jour}")
        if Counter(r["assignedDoctorId"] for r in jour).most_common(1)[0:1] and Counter(r["assignedDoctorId"] for r in jour).most_common(1)[0][1] > 1:
            errors.append(f"Samma läkare två jour samma dag: {day}")
        # 6. Specialpass överskrider aldrig kravet (låsta uppgifter räknas med)
        for shift in (BVC, SABO, OM, ADMIN):
            n = sum(1 for r in today if r["shift"] == shift)
            locked = sum(1 for r in today if r["shift"] == shift and r.get("isManual"))
            if n > max(req["requiredShifts"].get(shift, 0), locked):
                errors.append(f"För många {shift} {day}: {n} > {req['requiredShifts'].get(shift, 0)}")

    # 7. Ägarmöte: bara första måndagen i listade månader
    cfg = payload["config"]["ownerMeeting"]
    for day, today in by_day.items():
        d = Date.fromisoformat(day)
        meeting = [r for r in today if r["shift"] == MEETING]
        should = cfg["isActive"] and d.month - 1 in cfg["months"] and js_wd(day) == cfg["dayOfWeek"] and d.day <= 7
        if meeting and not should:
            errors.append(f"Ägarmöte på fel dag: {day}")
        for r in meeting:
            if docs[r["assignedDoctorId"]]["role"] != cfg["requiredRole"]:
                errors.append(f"Fel roll på ägarmöte: {day}")

    # 8. Tak för antal läkare (kontrolleras bara när lösningen inte redan varnar för det)
    warned_over = {w["date"] for w in result["warnings"] if "över taket" in w["message"]}
    for day, today in by_day.items():
        base = payload["config"]["base"]
        cap = base["maxDoctors"]
        for dev in payload["config"]["deviations"]:
            if dev["startDate"][:10] <= day <= dev["endDate"][:10]:
                cap = dev["counts"]["maxDoctors"]
        n = len({r["assignedDoctorId"] for r in today})
        if n > cap and day not in warned_over:
            errors.append(f"Över maxDoctors utan varning {day}: {n} > {cap}")
    return errors


def jour_stats(payload, result):
    docs = {d["id"]: d["name"] for d in payload["doctors"]}
    per = Counter()
    weekend = Counter()
    days = defaultdict(list)
    for r in result["schedule"]:
        if r["shift"] == JOUR:
            per[docs[r["assignedDoctorId"]]] += 1
            days[r["assignedDoctorId"]].append(r["date"])
            if js_wd(r["date"]) in (0, 6):
                weekend[docs[r["assignedDoctorId"]]] += 1
    back_to_back = 0
    for ds in days.values():
        ds.sort()
        back_to_back += sum(1 for a, b in zip(ds, ds[1:]) if (Date.fromisoformat(b) - Date.fromisoformat(a)).days == 1)
    return per, weekend, back_to_back


def test_normal_schedule():
    result = solve(copy.deepcopy(SAMPLE))
    errors = validate(SAMPLE, result)
    assert not errors, "\n".join(errors[:20])
    assert not [w for w in result["warnings"] if w["type"] == "CRITICAL"], result["warnings"][:5]


def test_is_reproducible():
    a = solve(copy.deepcopy(SAMPLE))
    b = solve(copy.deepcopy(SAMPLE))
    assert a["schedule"] == b["schedule"]


def test_pending_leave_is_ignored():
    # l5 är PENDING (Kristina/index 6 den 2026-11-03) och får inte påverka något
    result = solve(copy.deepcopy(SAMPLE))
    doc6 = SAMPLE["doctors"][6]["id"]
    assert any(r["assignedDoctorId"] == doc6 and r["date"] == "2026-11-03" for r in result["schedule"])


def test_impossible_demand_gives_warnings_not_crash():
    p = copy.deepcopy(SAMPLE)
    # Alla med jour-kompetens är ledig 2026-10-27 => jourplats måste saknas, men schemat ska ändå skapas
    for d in p["doctors"]:
        if "Jour" in d["competence"]:
            p["leaves"].append({"id": "x" + d["id"], "doctorId": d["id"], "date": "2026-10-27",
                                "status": "APPROVED", "reason": "test", "isFullDay": True})
    result = solve(p)
    assert not validate(p, result)
    crit = [w for w in result["warnings"] if w["date"] == "2026-10-27" and "Jour" in w["message"]]
    assert crit, result["warnings"]
    assert any(r["shift"] == SAKNAS and r["date"] == "2026-10-27" for r in result["schedule"])


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("OK  ", name)
    res = solve(copy.deepcopy(SAMPLE))
    per, wk, b2b = jour_stats(SAMPLE, res)
    print("\nJourpass per läkare:", dict(sorted(per.items(), key=lambda kv: -kv[1])))
    print("Helgjour per läkare:", dict(sorted(wk.items(), key=lambda kv: -kv[1])))
    print("Jour dagen efter jour:", b2b)
    print("Varningar:", len(res["warnings"]), "| rader:", len(res["schedule"]), "| stats:", res["stats"])
