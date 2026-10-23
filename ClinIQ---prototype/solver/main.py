"""HTTP-API för ClinIQ:s schemaläggare (Google OR-Tools / CP-SAT).

Starta lokalt:   uvicorn main:app --port 8000 --reload
Hälsokoll:       GET  http://localhost:8000/health
Generera schema: POST http://localhost:8000/solve   (JSON, se model.solve)

Tjänsten är stateless: allt den behöver (läkare, krav, ledigheter, konfig)
skickas med i anropet. Den lagrar ingenting och pratar inte med databasen.
"""
import os

from fastapi import Body, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from model import solve

app = FastAPI(title="ClinIQ solver", version="0.1.0")

# Vilka webbadresser som får anropa tjänsten från en webbläsare.
# Sätt CLINIQ_ALLOWED_ORIGINS="https://din-domän.se" i produktion.
_origins = os.environ.get(
    "CLINIQ_ALLOWED_ORIGINS",
    "http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _origins.split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True}


# Vanlig `def` (inte async): FastAPI kör den i en trådpool, så en lång
# optimering blockerar inte övriga anrop.
@app.post("/solve")
def solve_endpoint(payload: dict = Body(...)):
    try:
        return solve(payload)
    except (ValueError, KeyError) as e:
        raise HTTPException(status_code=422, detail=f"Ogiltig indata: {e}")
