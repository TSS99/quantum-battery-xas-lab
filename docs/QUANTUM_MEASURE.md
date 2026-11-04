# Quantum XAS, step 5: measuring a computed spectrum, and fitting it back

Phase 5 of [PLAN-quantum.md](PLAN-quantum.md). The Quantum XAS page now sends the oxide clusters' computed oxygen K edges through a model soft X-ray beamline, and fits what it records back as a mixture of oxygen environments. You can load a measured spectrum of your own instead; it never leaves the browser. The engine is `src/lib/quantum/measure.ts`, tested in `measure.test.ts`.

## The beamline

The sample's absorption is a mixture of the library clusters' exact stick spectra, per oxygen atom, with the 0.15 eV lifetime width of the O 1s hole and a chosen extra broadening for what the clusters leave out (vibrations, band dispersion). Then:

* **Monochromator.** A grating, Gaussian resolution E / R with R from 1,000 to 20,000 (5,000 by default, 0.11 eV at 530 eV).
* **Detection.** Total electron yield (the sample's drain current, 0.01 electrons per incident photon at the top of the edge) or fluorescence yield (a silicon drift detector, 1 % of the sphere, 50 % efficient at O Kα, the O K fluorescence yield of 0.0058), each point divided by an I0 gold mesh. Counts are Poisson, with 0.2 % normalization noise at 1 s falling as 1/√dwell, and a background under the edge (the other atoms in electron yield, scatter in fluorescence) subtracted as a pre-edge line would be.
* **Saturation.** Fluorescence from a thick, concentrated sample at 45° in and out reads rt/(rt + 2) for an absorption t (1 at the top) and an edge jump r = 3.3.
* **Dose.** The surface dose N E (μ/ρ) / A. For Li₂MnO₃ above the O K edge μ/ρ = 9,180 cm²/g, an attenuation length of 280 nm; a 232 point scan at 1 s and 10¹¹ photons per second on 100 × 50 µm gives about 390 MGy.
* **Vacuum.** At 530 eV X-rays lose 1/e of their intensity in 0.66 mm of air, so beam and sample are in vacuum.

The material numbers are tabulated cross sections from xraydb (Elam, Ravel and Sieber 2002) for Li₂MnO₃ at 3.9 g/cm³. The rest are round numbers for a generic beamline, not a facility's.

## The fit

The fit finds the non-negative mixture of candidate spectra, one common energy shift and one extra Gaussian broadening that match a spectrum best, by weighted least squares (non-negative least squares at each shift and broadening; shifts searched every 0.5 eV, then every 0.05 eV around the best). Each fraction comes with its standard uncertainty from the covariance of the fitted weights, and each candidate is also fitted alone, which ranks the hypotheses. A loaded spectrum is kept from 5 eV below its edge to 20 eV above, and fitted with a free shift over 50 eV (computed edges sit 6 to 30 eV high) and a free constant and slope.

## What it says

At 1 eV of broadening in the sample, electron yield, 1 s per point (seed 1):

| Sample | O2 site | O1 site | One Li removed | Two Li removed |
| --- | --- | --- | --- | --- |
| Li₂MnO₃ crystal, O2 and O1 sites 2 : 1 | 66.6 ± 0.3 % | 33.3 ± 0.3 % | 0 | 0 |
| Partly charged (33.3, 16.7, 30, 20 %) | 33.3 ± 0.3 % | 16.7 ± 0.2 % | 30.1 % | 20.0 % |

* **Noise is not what limits a comparison.** Electron yield recovers every mixture to a few tenths of a percent, at any sample broadening from 0 to 2 eV, with χ²ᵥ near 1. A real material differs from these 11 orbital clusters by far more than any scan's noise, so a fit says which computed environment is closest, not that it is right.
* **Fluorescence from a concentrated oxide misleads.** Saturation flattens the strongest peaks, and the fit reads the pristine crystal as 79 % "two lithium removed". Electron yield, or a dilute sample, avoids it.
* **The quantum run's resolution decides what can be told apart.** A noiseless quantum run gives each candidate broadened by its resolution η, so the fit was run on the partly charged sample with candidates at each η. The cost columns come from the Phase 4 model with the evolution growing as 1/η and the Trotter step as √η (`scripts/quantum/estimates.py`, the `resolution` rows):

| η | O2 | O1 | One Li removed | Two Li removed | Longest circuit, Toffolis | Machine class |
| --- | --- | --- | --- | --- | --- | --- |
| exact (0.15 eV lifetime) | 33.3 % | 16.7 % | 30.1 % | 20.0 % | | |
| 0.14 eV (0.005 Ha) | 38.7 % | 12.7 % | 30.2 % | 18.4 % | 2.1×10⁹ | beyond both |
| 0.27 eV (0.01 Ha) | 34.4 % | 17.4 % | 30.7 % | 17.5 % | 7.3×10⁸ | Blue Jay |
| 0.54 eV (0.02 Ha) | 46.4 % | 9.8 % | 29.2 % | 14.7 % | 2.6×10⁸ | Blue Jay |
| 1.36 eV (0.05 Ha, used so far) | 0 | 0 | 13.8 % | 86.2 % | 6.5×10⁷ | Starling |

  At the 1.36 eV resolution of steps 1 to 4, which fits the first announced fault tolerant generation, the fit cannot tell these environments apart. Reading how much lithium has gone needs η near 0.27 eV, eleven times the gates, which moves the 11 orbital clusters to the Blue Jay class (about 53 hours on the active volume layout at 1 MHz). Telling the two oxygen sites apart needs about 0.14 eV, beyond both announced generations.

## What is not done

* **Measured references.** The plan asks that measured spectra be reproduced. No openly licensed measured O K edge of Li₂MnO₃ or its delithiated forms was found, so this step stops at synthetic data and lets you load your own. It stays open until there is data the project may publish.
* **The twin's hutch.** The soft X-ray beamline lives on the Quantum XAS page; the twin's 3D hutch stays a hard X-ray beamline.
* **Mn L edges.** They need spin orbit coupling, which the library's problems do not have yet (a research track in the plan).
