---
name: PPF flattening quality
description: Lessons on turning flattened mesh regions into clean PPF cut outlines.
---
Raw region boundaries follow mesh triangles and look stair-stepped; offsetting them by the wrap allowance creates self-intersecting "swallowtail" loops in concave spots.

**Rule:** resample boundary loops to ~half the mean edge length, Taubin-smooth (λ 0.5 / μ -0.53, ~60 iterations), simplify, then offset and remove self-intersections before simplifying again.

**Why:** without this, cut lines were jagged and had loops visible in SVG/PDF exports (seen on helmet and mirror samples).

**How to apply:** any change to segmentation, offsetting or the outline pipeline in the PPF engine — re-render sample SVGs and zoom in on concave edges.
