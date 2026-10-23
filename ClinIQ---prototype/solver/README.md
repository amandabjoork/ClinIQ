# ClinIQ – schemaläggare med Google OR-Tools

Python-tjänst som tar fram schemat med **CP-SAT** (OR-Tools constraint solver)
istället för den giriga dag-för-dag-logiken i `schedulingLogic.ts`. Webbappen
anropar den när du trycker **Generera schema**. Är tjänsten inte igång faller
appen tillbaka på den gamla logiken och visar en tydlig varning.

## Starta

Kräver Python 3.10+.

```bash
cd solver
python -m venv .venv
.venv\Scripts\activate          # Windows   (Mac/Linux: source .venv/bin/activate)
pip install -r requirements.txt
uvicorn main:app --port 8000
```

Kolla att den lever: http://localhost:8000/health ska visa `{"ok":true}`.
Starta sedan webbappen som vanligt (`npm run dev`) – ingen mer konfiguration behövs.

### Alternativ: Docker

```bash
cd server
docker compose --profile solver up -d --build
```
(Startar solvern på port 8000, och Postgres om den inte redan körs.)

Ligger solvern på en annan adress: sätt `VITE_SOLVER_URL=https://...` i `.env.local`
i projektroten, och `CLINIQ_ALLOWED_ORIGINS=https://din-webbapp` för solvern.

## Vad modellen gör

Hela perioden optimeras i glidande fönster om 14 dagar. Jourbelastning, helgjour,
vilodagar och admin-önskemål förs över mellan fönstren, så rättvisan gäller hela perioden.

**Aldrig brutet (hårda regler):** högst ett pass per läkare och halvdag · bara pass man
har kompetens för · ingen under godkänd ledighet (hel- eller delvis) · ingen utanför sin
arbetstid (t.ex. slutar 12 på fredagar => inga eftermiddagspass) · låsta återkommande
uppgifter ligger fast (med reserv 1/2 och "inställd") · max ett jourpass per läkare och dygn.

**Så långt det går, annars en varning:** rätt antal jour (FM/EM) · ägarmöte · dagens krav
per passtyp (BVC, SÄBO, OM, Admin, Mottagning) · minimum läkare/specialister/sena ·
tak för antal läkare (`maxDoctors`).

**Optimeras:** jämn jourfördelning (även helger, med hänsyn till tidigare belastning) ·
vila mellan jourpass · specialister föredras något för jour · admin-önskemål ("Gillar admin
på fredagar") uppfylls och fördelas jämnt · ledig tid fylls med Mottagning.

### Tolkningar du bör känna till
- **Min läkare per dag** = dagens `minStaff` (det du ändrar med stegknapparna per dag).
  Under en avvikelseperiod (t.ex. julveckan) gäller periodens `minTotalDaily` på vardagar.
  Min specialister / sena gäller bara vardagar.
- **"Sena"** räknar bara läkare som arbetar till kl. 17 (utifrån arbetstid och `defaultEndTime`).
- **Jour på vardagar** kräver att läkaren faktiskt jobbar den dagen. Helgjour får läggas
  oavsett ordinarie schema (som förut).
- **Extra Mottagning:** kraven är minimum. Ledig arbetstid fylls med Mottagning så att ingen
  står oanvänd. Stäng av med `fillIdleWithMottagning: false` i `options`.
- En återkommande uppgift där *ingen* är utpekad (`UNASSIGNED`) låses inte; behovet fylls
  av optimeraren om kvoten kräver det.
- Samma indata ger **samma schema** varje gång (deterministisk sökning).

## Inställningar (`options` i anropet, alla valfria)
| namn | standard | betydelse |
|---|---|---|
| `timeLimitSeconds` | 2.0 | Sökbudget för hela perioden. Högre = lite bättre schema, längre väntan |
| `windowDays` | 14 | Dagar per optimeringsfönster |
| `fillIdleWithMottagning` | true | Fyll outnyttjad arbetstid med Mottagning |

## Test
```bash
python tests/test_solver.py
```
Kontrollerar med separat kod att inga regler bryts, att resultatet är reproducerbart, att
ej godkända ledigheter ignoreras, och att omöjliga krav ger varningar i stället för krasch.

## Säkerhet
Tjänsten har ingen inloggning och får personaldata (namn, scheman, ledighetsdagar – *inte*
ledighetens fritext). Kör den bara lokalt eller bakom inloggning/privat nätverk, och se
till att den som driftar den omfattas av ert PUB-avtal innan riktig personaldata skickas.
