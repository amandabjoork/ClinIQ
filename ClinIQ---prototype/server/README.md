# ClinIQ – server

Ett litet Express-API ovanpå PostgreSQL (via Prisma) som ersätter den
sessionsbaserade lagringen i frontend-prototypen. Datamodellen i
`prisma/schema.prisma` speglar `types.ts` i frontend-projektet.

## Snabbstart (enklast – ingen installation av databas)

1. **Skapa ett gratiskonto på [neon.tech](https://neon.tech)** och skapa ett
   nytt projekt. Kopiera "Connection string" som visas direkt efter skapandet
   (den börjar med `postgresql://...`).

2. **Installera beroenden:**
   ```bash
   cd server
   npm install
   ```

3. **Sätt din databas-URL:**
   ```bash
   cp .env.example .env
   ```
   Klistra in din Neon-connection-string som `DATABASE_URL` i `.env`.

4. **Skapa tabellerna:**
   ```bash
   npx prisma migrate dev --name init
   ```

5. **Fyll databasen med testdata** (motsvarande dagens `mockData.ts`):
   ```bash
   npm run seed
   ```

6. **Starta API:t:**
   ```bash
   npm run dev
   ```
   Servern startar på `http://localhost:4000`. Testa `GET /api/health`.

Det är allt – ingen Docker, ingen lokal Postgres-installation. Samma
databas funkar sedan när ni lanserar (Neon har en gratisnivå som räcker
långt för en pilot).

## Alternativ: kör Postgres lokalt via Docker

Om du hellre vill ha databasen på din egen dator (t.ex. om du inte vill
skapa ett molnkonto än):

```bash
docker compose up -d
cp .env.example .env
# Avkommentera DATABASE_URL-raden för Docker i .env, kommentera bort Neon-raden
npx prisma migrate dev --name init
npm run seed
npm run dev
```
Kräver att Docker Desktop är installerat och igång innan du kör `docker
compose up -d` – det är det steget som brukar strula (kontrollera att
Docker-ikonen visar att den faktiskt körs, inte bara är installerad).

## Endpoints (urval)

- `GET/POST/PUT/DELETE /api/doctors`
- `GET/POST /api/leave-requests`, `PATCH /api/leave-requests/:id/status`
- `GET/PUT /api/staffing-config`, plus `/recurring-tasks` och `/deviations`
- `GET/PUT /api/requirements/:date`, `POST /api/requirements/bulk`
- `GET /api/schedule`, `POST /api/schedule/bulk`, `PATCH /api/schedule/:id`

## Hur appen använder databasen

Webbappen (`npm run dev` i projektroten) hämtar all data härifrån när du loggat in, och
sparar ändringar automatiskt:

| Du gör i appen | Sparas |
|---|---|
| Lägger till / ändrar / tar bort läkare | direkt |
| Skickar in ledighet, godkänner/nekar | direkt |
| Ändrar krav per dag (stegknapparna) | ca 0,6 s efter sista klicket |
| Ändrar grundkrav, ägarmöte, fasta uppdrag, avvikelser | ca 0,8 s efter sista ändringen (hela konfigurationen i en transaktion) |
| Genererar schema eller ändrar ett pass | ca 0,7 s efter ändringen; bara de dagar som ändrats sparas |

Övrigt att veta:
- **Du behöver inte köra om `npm run seed`** om du redan gjort det. Dagskrav skapas av appen
  själv och sparas första gången den startar (`seed` skapar dem inte längre).
- Är databasen helt tom startar appen ändå och sparar standardvärden. Läkare får du via
  `npm run seed` eller "Hantera läkare" i appen.
- Nås inte servern visar appen ett felmeddelande med "Försök igen" – eller "Fortsätt i
  demoläge" (mockdata, ingenting sparas). Misslyckas ett sparande mitt i ett arbete visas en
  röd ruta längst ned till höger.
- Det är *klienten* som väljer id för nya läkare, ledigheter och uppdrag.
- Läkarinloggningen är fortfarande en prototyp: den loggar in som "Anna Andersson" om hon
  finns, annars första specialisten.

## Vad som INTE är gjort än

- **Ingen autentisering.** `/api/*` är helt öppet – innan en skarp pilot med riktig personaldata
  behövs inloggning, en riktig användartabell (finns i schemat men används inte av appen än)
  och sannolikt ett PUB-avtal med den som driftar servern/databasen. Lösenordet för att öppna
  appen ligger fortfarande i klartext i `App.tsx`.
- **Ingen versionering/konfliktkontroll:** om två admins ändrar samma sak samtidigt vinner den
  som sparar sist.
- **Schemat räknas fram i optimeringstjänsten (`solver/`) eller i webbläsaren – inte på servern.**
  Vill ni generera scheman automatiskt utan öppen webbläsare (t.ex. nattligt) bör servern hämta
  data ur databasen och anropa solvern själv.
