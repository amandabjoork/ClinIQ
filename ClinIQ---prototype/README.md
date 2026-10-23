# ClinIQ

Schemaläggare för vårdcentral. Tre delar som körs tillsammans:

| Del | Mapp | Startas med | Port |
|---|---|---|---|
| Webbappen | (roten) | `npm install` + `npm run dev` | 3000 |
| Databas + API | `server/` | se `server/README.md` (Postgres + `npm run dev`) | 4000 |
| Optimering (OR-Tools) | `solver/` | se `solver/README.md` (`uvicorn main:app --port 8000`) | 8000 |

Starta i ordningen databas -> server -> solver -> webbapp. Utan solver används en enklare
reservlogik i webbläsaren (med varning); utan server kan appen köras i demoläge (sparar inget).
Adresserna kan ändras med `VITE_API_URL` och `VITE_SOLVER_URL` i `.env.local`.

---

<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/ed80fad0-e81d-4c81-892a-9712d942589b

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
