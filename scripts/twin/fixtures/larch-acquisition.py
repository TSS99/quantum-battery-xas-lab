"""Reduce larch-acquisition.xdi with the same settings as the XAS Lab beamline twin.

Keep this file beside larch-acquisition.xdi. Requires xraylarch 2026.3.1 or a compatible release.
The printed R coordinate is the uncorrected Fourier-transform peak, not a bond length.
"""
from pathlib import Path

import numpy as np
from larch.io import read_xdi
from larch.xafs import autobk, pre_edge, xftf


xdi_path = Path(__file__).with_suffix(".xdi")
data = read_xdi(str(xdi_path))
energy = np.asarray(data.energy, dtype=float)
mu = np.asarray(data.mutrans, dtype=float)

pre_edge(energy, mu, group=data)
autobk(
    energy,
    mu,
    group=data,
    e0=data.e0,
    edge_step=data.edge_step,
    rbkg=1,
    kmin=0,
    kmax=11.6890808001,
    kweight=1,
    dk=0.1,
    win="hanning",
    nfft=2048,
    kstep=0.05,
    nclamp=3,
    clamp_lo=0,
    clamp_hi=1,
)
xftf(
    data.k,
    data.chi,
    group=data,
    kmin=2,
    kmax=11.6890808001,
    kweight=2,
    dk=1,
    window="hanning",
    rmax_out=10,
    nfft=2048,
    kstep=0.05,
)

peak_index = int(np.nanargmax(data.chir_mag))
print(f"e0: {data.e0:.10g} eV")
print(f"edge step: {data.edge_step:.10g}")
print(f"|chi(R)| peak: {data.r[peak_index]:.10g} angstrom")
