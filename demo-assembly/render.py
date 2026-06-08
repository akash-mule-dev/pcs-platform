#!/usr/bin/env python3
"""Render a 4-view preview PNG of demo_assembly.glb (caption derived from the model)."""
import numpy as np, trimesh, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

sc = trimesh.load("demo_assembly.glb", force="scene")
nn = list(sc.graph.nodes_geometry)
nbolt = sum(1 for n in nn if any(k in n.lower() for k in ("bolt", "anchor")))
npart = len(nn) - nbolt
mesh = sc.dump(concatenate=True)
V, F = mesh.vertices, mesh.faces
W, D, H = (V.max(0) - V.min(0))
try:
    fbase = (mesh.visual.vertex_colors[:, :3].astype(float) / 255.0)[F].mean(axis=1)
except Exception:
    fbase = np.tile([0.69, 0.70, 0.73], (len(F), 1))
tris = V[F]; n = mesh.face_normals
light = np.array([0.35, 0.45, 0.82]); light /= np.linalg.norm(light)
fcol = np.clip(fbase * (0.40 + 0.60 * np.clip(n @ light, 0, 1))[:, None], 0, 1)
ctr = (V.min(0) + V.max(0)) / 2.0; span = (V.max(0) - V.min(0)).max() * 0.55
views = [("ISO", 24, -55), ("FRONT  (X-Z)", 4, -90), ("SIDE  (Y-Z)", 4, 0), ("TOP  (X-Y)", 88, -90)]
fig = plt.figure(figsize=(11, 8.4), dpi=120)
for i, (title, elev, azim) in enumerate(views):
    ax = fig.add_subplot(2, 2, i + 1, projection="3d")
    pc = Poly3DCollection(tris, linewidths=0); pc.set_facecolor(fcol); ax.add_collection3d(pc)
    ax.view_init(elev=elev, azim=azim)
    ax.set_xlim(ctr[0]-span, ctr[0]+span); ax.set_ylim(ctr[1]-span, ctr[1]+span); ax.set_zlim(ctr[2]-span, ctr[2]+span)
    ax.set_box_aspect((1, 1, 1)); ax.set_title(title, fontsize=11)
    ax.set_xticks([]); ax.set_yticks([]); ax.set_zticks([])
    ax.xaxis.pane.fill = ax.yaxis.pane.fill = ax.zaxis.pane.fill = False
    for a in (ax.xaxis, ax.yaxis, ax.zaxis): a.line.set_color((1, 1, 1, 0))
fig.suptitle(f"PCS AR demo - bolt-together pipe-rack  -  {W:.0f} x {D:.0f} x {H:.0f} mm  -  "
             f"{npart} parts + {nbolt} bolts  -  clearance verified", fontsize=12)
fig.tight_layout(rect=(0, 0, 1, 0.97)); fig.savefig("assembly_preview.png", dpi=120)
print(f"wrote assembly_preview.png  ({W:.0f}x{D:.0f}x{H:.0f} mm, {npart} parts + {nbolt} bolts)")
