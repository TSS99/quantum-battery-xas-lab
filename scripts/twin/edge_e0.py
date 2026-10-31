"""E0 of a normalized near edge spectrum, one rule for computed and measured spectra (make-xanes-library.py,
make-measured-xanes.py; src/lib/twin/xanes.ts reads the stored grids, which start from it).

E0 is the first steep rise of the absorption that it does not fall back from: on a 0.05 eV grid smoothed by a
Gaussian of 0.5 eV, take the local maxima of d mu / dE after which mu stays at or above 0.3 from 2 to 8 eV on; E0 is
the first of them that reaches 40 % of the steepest of them. The maximum derivative alone (Athena's default) lands on an intense pre-edge
peak such as K2CrO4's, which falls back to a fifth of the step before the edge proper; the half step lands after the
shoulder of a metal such as Cu. This rule keeps a metal's E0 on its first inflection and skips a pre-edge peak.
"""

import numpy as np

STEP = 0.05


def edge_e0(energy, mu):
    grid = np.arange(energy[0], energy[-1], STEP)
    y = np.interp(grid, energy, mu)
    sigma = 0.5 / STEP
    kernel = np.exp(-0.5 * (np.arange(-int(4 * sigma), int(4 * sigma) + 1) / sigma) ** 2)
    smooth = np.convolve(np.pad(y, len(kernel) // 2, mode="edge"), kernel / kernel.sum(), mode="valid")
    slope = np.gradient(smooth, STEP)
    def stays(i):
        after = (grid >= grid[i] + 2) & (grid <= grid[i] + 8)
        return after.any() and smooth[after].min() >= 0.3
    rises = [i for i in range(1, len(slope) - 1) if slope[i] >= slope[i - 1] and slope[i] > slope[i + 1] and stays(i)]
    if not rises:
        return float(grid[int(np.argmax(slope))])
    steepest = max(slope[i] for i in rises)
    return float(grid[next(i for i in rises if slope[i] >= 0.4 * steepest)])
