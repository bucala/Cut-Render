---
name: Pattern-based garment meshing
description: Pitfalls when triangulating garment silhouettes with cdt2d for the 3D tops.
---
cdt2d's interior/exterior classification is parity-based, so interior constraint polylines (armhole, hem-band and cuff seams) confuse it. Triangulate with exterior:true and keep triangles whose centroid is inside the outline. Every constraint endpoint must be an exact outline vertex (e.g. add the fold point at the cuff seam explicitly) or cdt2d gets T-junctions.
**Why:** the first design pass found parity misclassification; separate sleeve tubes were rejected by the user as unacceptable.
**How to apply:** any change to buildTop outlines/constraints, or adding new garments built the same way.

**Path tracer + vertex colours:** three-gpu-pathtracer merges `color` attributes with itemSize 3 incorrectly (garbage → near-black garment). Always write RGBA (itemSize 4) colour attributes, and give colour-less geometries a white RGBA attribute too.
**Rib band direction:** a band that rises straight up at the neck points makes "horns" at the shoulders; lean each band vertex toward the opening centre (in-plane component of centre − P) instead.
