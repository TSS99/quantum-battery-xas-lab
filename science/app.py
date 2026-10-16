"""Optional localhost reference service. The browser implementation needs no server."""
import numpy
import scipy
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .quantum import QuantumRequest, simulate

app = FastAPI(title="Quantum Battery XAS Lab — exact toy reference", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"], allow_methods=["GET", "POST"], allow_headers=["Content-Type"])


@app.get("/health")
def health():
    return {"status": "ok", "provenance": "exact-toy", "numpy": numpy.__version__, "scipy": scipy.__version__, "units": "toy eV; time eV^-1; hbar=1"}


@app.post("/simulate")
def simulate_request(request: QuantumRequest):
    return simulate(request)
