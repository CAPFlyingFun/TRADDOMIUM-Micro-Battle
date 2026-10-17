#!/bin/sh
# Sarah v2's outfit: a white tank over grey maternity leggings, over the belly and under it, grown
# from the approved body and written beside it. Run from the repository root:
#   sh scripts/sarahV2Outfit/build.sh [work dir, default .scratch/outfit]
# then pack and install:  cp <work>/a8.glb public/models/sarah-v2-body.glb && node scripts/packSarah.mjs public/models/sarah-v2-body.glb
# IMPORTANT: the source must be the approved body WITHOUT clothes (git show 2b9adfc:public/models/sarah-v2-body.glb).
# It takes about fifteen minutes. See README.md in this folder for what each step fixes.
set -e
O=scripts/sarahV2Outfit; W=${1:-.scratch/outfit}; mkdir -p "$W"
B=${SRC:-$W/body.glb}; [ -f "$B" ] || git show 2b9adfc:public/models/sarah-v2-body.glb > "$B"
RISE=under RENAME=leggings:leggingsLow node $O/grow.mjs $B $W/a1.glb leggings
RISE=over node $O/grow.mjs $W/a1.glb $W/a2.glb shirt leggings
node $O/islands.mjs $W/a2.glb $W/a2i.glb shirt
node $O/dress.mjs $W/a2i.glb $W/a3.glb leggings $O/knit-grey-1k.jpg 0.02823
node $O/dress.mjs $W/a3.glb $W/a4.glb leggingsLow $O/knit-grey-1k.jpg 0.02823
node $O/dress.mjs $W/a4.glb $W/a5.glb shirt $O/knit-white-1k.jpg 0.05646
node $O/rebind.mjs $W/a5.glb $W/a7.glb shirt:0.007:leggings:0.005 leggings:0.0025 leggingsLow:0.0025
RINGS=3 UNTANGLE_ROUNDS=40 node $O/untangle.mjs $W/a7.glb $W/a7u.glb leggings leggingsLow shirt
node $O/bridge.mjs $W/a7u.glb $W/a7b.glb leggings:150:10 leggingsLow:150:10
BRIDGE_HULL=0.1:0.34:15 node $O/bridge.mjs $W/a7b.glb $W/a7b2.glb shirt:150:14
node $O/normals.mjs $W/a7b2.glb $W/a7n.glb leggings leggingsLow shirt
TRIM_ALONG=1500 node $O/trim.mjs $W/a7n.glb $W/a8.glb shirt:0.014:0.0015:0.007:0.93,0.93,0.92 leggings:0.022:0.002:0.0025:0.42,0.42,0.43 leggingsLow:0.018:0.002:0.0025:0.42,0.42,0.43
echo "built $W/a8.glb"
