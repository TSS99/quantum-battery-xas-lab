import type { Acquisition, TwinMode } from './types';
import { muOf, reduceAcquisition, TWIN_REDUCTION } from './reduction';

export interface LarchExport {
  filename: string;
  code: string;
}

const pythonName = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'twin-acquisition';

/** A self-contained xraylarch reduction script for an XDI downloaded with the same base name. */
export function larchScript(acquisition: Acquisition, baseName: string, mode: TwinMode = acquisition.kind): LarchExport {
  // Validate the data and obtain the same data-dependent k maximum the dock uses.
  muOf(acquisition.columns, mode);
  const { kmax } = reduceAcquisition(acquisition, mode);
  const muColumn = mode === 'fluorescence' || mode === 'xrf' ? 'mufluor' : 'mutrans';
  const base = pythonName(baseName.replace(/\.(?:xdi|py)$/i, ''));
  const p = TWIN_REDUCTION;
  const code = `"""Reduce ${base}.xdi with the same settings as the XAS Lab beamline twin.

Keep this file beside ${base}.xdi. Requires xraylarch 2026.3.1 or a compatible release.
The printed R coordinate is the uncorrected Fourier-transform peak, not a bond length.
"""
from pathlib import Path

import numpy as np
from larch.io import read_xdi
from larch.xafs import autobk, pre_edge, xftf


xdi_path = Path(__file__).with_suffix(".xdi")
data = read_xdi(str(xdi_path))
energy = np.asarray(data.energy, dtype=float)
mu = np.asarray(data.${muColumn}, dtype=float)

pre_edge(energy, mu, group=data)
autobk(
    energy,
    mu,
    group=data,
    e0=data.e0,
    edge_step=data.edge_step,
    rbkg=${p.rbkg},
    kmin=${p.autobkKmin},
    kmax=${kmax.toPrecision(12)},
    kweight=${p.autobkKweight},
    dk=${p.autobkDk},
    win="${p.window}",
    nfft=${p.nfft},
    kstep=${p.kstep},
    nclamp=${p.nclamp},
    clamp_lo=${p.clampLow},
    clamp_hi=${p.clampHigh},
)
xftf(
    data.k,
    data.chi,
    group=data,
    kmin=${p.kmin},
    kmax=${kmax.toPrecision(12)},
    kweight=${p.kweight},
    dk=${p.dk},
    window="${p.window}",
    rmax_out=10,
    nfft=${p.nfft},
    kstep=${p.kstep},
)

peak_index = int(np.nanargmax(data.chir_mag))
print(f"e0: {data.e0:.10g} eV")
print(f"edge step: {data.edge_step:.10g}")
print(f"|chi(R)| peak: {data.r[peak_index]:.10g} angstrom")
`;
  return { filename: `${base}.py`, code };
}
