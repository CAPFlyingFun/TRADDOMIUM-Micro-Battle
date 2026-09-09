# The ant rigs, read off the files

The two skeletons the Creature Lab's ants are drawn with, measured with
three's own loader under node (`tests/faunaRealRigs.test.ts` pins every
number here; the throwaway that produced them ran `measureRig`,
`findLegs`, `findWings` and `findAntennae` from `src/fauna/rig.ts` on the
files and then walked the skinned vertices by their dominant joint). The
brief's rule for this pass (§27): "Do NOT rebuild GLBs merely to fit a
guessed bone naming convention. Read the actual skeleton." Nothing was
rebuilt; both files are byte-for-byte what their donors ship.

Read this if you are the agent driving these rigs (`src/fauna/`) or the
one filling their species entries (`src/creatures/species.ts`). The
numbers the entries need are in §5; the things that will bite are in §7.

---

## 1. The files

| | `public/models/queen-winged.glb` | `public/models/worker.glb` |
|---|---|---|
| From | `legacy/v0-main`, commit `a1ff8fc` (2026-08-21), "The winged queen: one model, wings that can be taken away" | Thronemound-Colony-Sim `public/models/worker.glb`, commit `39f95d3` (2026-08-19), "Milestone 0b" |
| Bytes | 2,066,824 (md5 `d0a79012efdf7270721b69043e08dc00`) | 645,824 (md5 `5aa558c7c2f1ab033a6ec4c6ddde79c4`) |
| Made by | Meshy auto-rig (`UniRigArmature`), textures to 1024 WebP and geometry through meshopt by glTF-Transform 4.4.2, then v0's `scripts/bakeQueen.mjs` split the wings off into their own mesh | Meshy auto-rig (`UniRigArmature`), glTF-Transform 4.4.1 — the same pipeline that made the aphid, the worm and the fly, which are TCS's bytes too (md5s match) |
| Requires | `EXT_meshopt_compression`, `EXT_texture_webp`, `KHR_mesh_quantization` | the same three |
| Bones | 74, all `Bone_0NN` | 61, all `Bone_0NN` |
| Meshes | TWO skinned meshes on one skeleton, `queen_body` (73,579 verts, 69,561 tris) and `queen_wings` (35,137 verts, 33,930 tris), sharing one material `material.001` and one set of vertex attributes; two skins (`skin 0`, `skin 1`) over the same 74 joints | ONE skinned mesh `Mesh_0` (36,764 verts, 56,442 tris), material `Material_0` |
| Triangles (what `measureRig` counts) | 103,491 | 56,442 |
| Textures | base colour 1024², normal 1024² (325 KB — real detail), metallic-roughness 1024² | base colour 1024², normal 1024² (11 KB — nearly flat), metallic-roughness 1024², and an EMISSIVE map 1024² that is black (means 0.0, max 16/255) behind `emissiveFactor [1,1,1]` |
| Clips | none | none |
| Extras | `wingRoots` and `wingBones` — the bake wrote which bones are the four wings into the file (§3.4) | none |

The worker is TCS's `worker.glb`, not its `major.glb`: the task allowed
either, and the worker is the one whose bone map TCS already derived
(`src/anim/hexapod.ts`, `WORKER_RIG`) and drove on a device, so every
name below can be cross-checked against a second reading. *S. invicta*
workers are ONE polymorphic caste, so this one rig at the size draw is
the right rig for a minim and a major alike; `major.glb` (64 joints,
two-bone jaws, its front legs hung off the head chain) stays in TCS.

TCS's `CLAUDE.md` says nothing about these assets. TCS's `hexapod.ts`
does, and it holds here: "In every one of these exports her head runs
toward +Z and her feet sit at y ≈ 0, so she faces +Z with +Y up", and
"every export is height-normalised to 1.7" — both files' bounding boxes
top out at y = 1.70 exactly (the queen's at her raised wingtips, the
worker's at his head), which is why the model's own units mean nothing
about size and every rig is scaled from its measured spine (§5).

---

## 2. Conventions, before the tables

**Frame.** Rig units, root at the identity, +Y up, the head toward +Z.
Both files face +Z, which is the forward `rig.ts` assumes ("front is +Z
on every rig here") and the forward `motion.ts` banks and pitches
about. No rotation is needed on load.

**Which side is her left.** Facing +Z with +Y up in a right-handed
frame puts the animal's LEFT at +X (up × forward = +Y × +Z = +X). TCS
measured this from the device after shipping it backwards ("each
antenna and legs are correct as far as placement, but reversed").
`rig.ts` never says left or right — its `side` is the sign of X — and
this document follows it: **−X first, +X second, and +X is her left**.
v0's `extras.wingRoots` in the queen file names the −X wings `left*`
(the bake keyed "left" to negative X); those keys are the VIEWER's left
when she faces the camera, i.e. her right. Read them by the sign of X,
not by the word.

**What "thorax" and "head" mean here.** TCS's tables call the neck
chain `thorax` and learnt the hard way that it is the head ("what's
labeled as Thorax is actually the Head"). The naming below is by what
the bone DOES: the *hub* is the bone the six legs hang from (the
thorax, `hubOf` finds it), the *head chain* runs forward from the hub to
the antenna sockets, the *gaster chain* runs back from the hub to the
tip.

**Chains.** Every limb is a single-file chain whose children hang on
the parent's local +Y (`t = (0, L, 0)`), so a bone's local +Y is the
direction of its own length. That is the only structure the files
carry, and it is what `rig.ts` reads.

---

## 3. The queen — `queen-winged.glb`, 74 bones

### 3.1 Trunk

| Bone | Role | Position (rig units) |
|---|---|---|
| `Bone_000` | root, on the petiole | (0.008, 1.015, 0.163) |
| `Bone_001` | **hub / thorax** — 12 children: the head chain, the gaster chain, six coxae, four wing roots | (−0.011, 1.015, 0.104) |

### 3.2 Head, mandibles, antennae

```
Bone_001 → Bone_004 → Bone_003 → Bone_002        head chain: neck to antenna sockets, z 0.57 → 0.90
                                   ├ Bone_059 → 058 → 057 → 056   mandible, −X (her RIGHT), rest length 0.358, tip (−0.19, 0.39, 1.13)
                                   ├ Bone_063 → 062 → 061 → 060   mandible, +X (her LEFT),  rest length 0.384, tip ( 0.18, 0.37, 1.13)
                                   ├ Bone_068 → 067 → 066 → 065 → 064   antenna, −X, rest length 0.933, tip (−0.54, 0.55, 1.50)
                                   └ Bone_073 → 072 → 071 → 070 → 069   antenna, +X, rest length 0.950, tip ( 0.55, 0.53, 1.50)
```

The head chain is three bones; `Bone_004` is the neck (a head turn or
nod is a rotation of `Bone_004` about the body's vertical or the body's
X, in `Bone_001`'s frame). Both mandibles and both antennae root on
`Bone_002`. `findAntennae` returns `Bone_068` / `Bone_073` — correct.
v0's commit says "both mandibles articulated"; they are the four-bone
chains, 0.36–0.38 units long, tips at the very front of the head.

### 3.3 Gaster

```
Bone_001 → Bone_007 → Bone_006 → Bone_005      z −0.21 → −0.60 → −1.24 (bone tip); the skin runs to z −1.487
```

A gaster lift (sting posture, the alate's abdomen bob) is a pitch of
`Bone_007` about the body's X in the hub's frame.

### 3.4 Wings — four, three bones each, hung on the hub, BAKED SPREAD

| Key in `extras.wingRoots` | Root → tip | Side | Root at | Tip at | Chain length | Rest direction (yaw from −Z, elevation) |
|---|---|---|---|---|---|---|
| `leftFore` | `Bone_046 → 045 → 044` | −X (her right) | (−0.22, 1.13, 0.14) | (−2.03, 1.44, 0.18) | 1.835 | −91°, +10° |
| `leftHind` | `Bone_052 → 051 → 050` | −X (her right) | (−0.22, 1.15, 0.01) | (−2.05, 1.46, −0.15) | 1.860 | −85°, +10° |
| `rightFore` | `Bone_049 → 048 → 047` | +X (her left) | (0.24, 1.13, 0.14) | (2.05, 1.44, 0.18) | 1.835 | +91°, +10° |
| `rightHind` | `Bone_055 → 054 → 053` | +X (her left) | (0.24, 1.15, 0.01) | (2.07, 1.48, −0.15) | 1.864 | +85°, +10° |

Fore and hind are told apart by Z: the forewing roots sit 0.13 units
further forward, the way the bake decided it. The wing skin reaches
|X| 2.49 and spans z −0.28 … 0.29: **the wings are baked pointing
straight out to the sides**, raised ten degrees, the flight pose. The
housefly's pair rests folded back along the abdomen (yaw ±8° from −Z,
measured on `Bone_022`/`Bone_024`). Everything in §6.3 follows from
that one difference.

`findWings` returns ONE pair, `Bone_052` / `Bone_055` — the hind pair,
because their tips sit highest (y 1.46/1.48 against the forewings'
1.44). The forewings are not found. The file's `extras.wingRoots` names
all four, and reading them is the honest fix (§7.4).

### 3.5 Legs — the order `findLegs` ranks them

| Side | Rank | Coxa → foot | Foot at (rig units) | Tripod phase |
|---|---|---|---|---|
| −X (her right) | 0 front | `Bone_013 → 012 → 011 → 010 → 009 → 008` | (−0.79, 0.04, 0.92) | 0 |
| −X | 1 mid | `Bone_025 → 024 → 023 → 022 → 021 → 020` | (−1.29, 0.04, 0.16) | 1 |
| −X | 2 hind | `Bone_037 → 036 → 035 → 034 → 033 → 032` | (−1.31, 0.06, −0.48) | 0 |
| +X (her left) | 0 front | `Bone_019 → 018 → 017 → 016 → 015 → 014` | (0.82, 0.04, 0.92) | 1 |
| +X | 1 mid | `Bone_031 → 030 → 029 → 028 → 027 → 026` | (1.33, 0.04, 0.16) | 0 |
| +X | 2 hind | `Bone_043 → 042 → 041 → 040 → 039 → 038` | (1.35, 0.06, −0.50) | 1 |

Six bones a leg, coxa at the hub. `findLegs` finds exactly these, feet
and coxae, with the tripod halves alternating across every pair. The
gait's swing axis (`LegSpec.axis`, the body's vertical in the coxa's
parent frame) is (−0.999, 0.042, 0.001) on all six — `Bone_001`'s local
−X is the world's up, which is only a statement about how the
auto-rigger oriented the hub and changes nothing for the poser.

---

## 4. The worker — `worker.glb`, 61 bones

### 4.1 Trunk

| Bone | Role | Position |
|---|---|---|
| `Bone_000` | root, on the petiole (an explicit `scale [1,1,1]` on `Bone_008`'s node is the only oddity in the file) | (0.010, 1.280, −0.129) |
| `Bone_001` | **hub / thorax** — 8 children: head chain, gaster chain, six coxae | (−0.010, 1.359, 0.129) |

### 4.2 Head, face, mandibles, antennae

```
Bone_001 → Bone_004 → Bone_003 → Bone_002       head chain: neck to antenna sockets, z 0.47 → 0.80 → 1.26
                                   ├ Bone_046 → Bone_045              FACE (clypeus), midline, rest length 0.109, tip (−0.01, 1.14, 1.82)
                                   │              ├ Bone_057 → 056 → 055   mandible, −X (her RIGHT), rest length 0.171, tip (−0.11, 0.98, 2.00)
                                   │              └ Bone_060 → 059 → 058   mandible, +X (her LEFT),  rest length 0.243, tip ( 0.01, 0.94, 2.00)
                                   ├ Bone_050 → 049 → 048 → 047       antenna, −X, rest length 1.797, tip (−1.34, 0.94, 2.37)
                                   └ Bone_054 → 053 → 052 → 051       antenna, +X, rest length 1.777, tip ( 1.34, 0.96, 2.37)
```

This matches TCS's `WORKER_RIG` name for name (`mouth: 046, 045`;
`mandibleLeft: 060, 059, 058`; `antennaLeft: 054 … 051`; TCS's "left" is
+X, as here). The difference from the queen that matters: the mandibles
hang off the FACE bone `Bone_045`, one level below the head hub, and the
antennae are long (1.8 units, 1.4 mm at 3 mm — real for a fire ant) and
droop until their tips are at the mandibles' height (y 0.94–0.96 against
the jaws' 0.94–0.98).

**`findAntennae` returns the MANDIBLES on this file** (`Bone_057` /
`Bone_060`). The finder takes, on each secondary hub, the child with the
highest tip and looks for its mirror: on `Bone_002` the highest tip is
the midline face chain (y 1.14), which has no mirror, so `Bone_002`
yields nothing, and the mandible pair on `Bone_045` (y 0.98) wins. The
rule that separates them on all four legged rigs is LENGTH, not height —
the antennae are the longest mirrored pair on a head hub by a wide
margin (aphid 1.33 vs mouthparts 0.30; fly 0.07/0.08 with the 0.10
proboscis unmirrored; queen 0.93 vs 0.36; worker 1.80 vs 0.24). §7.3.

### 4.3 Gaster

```
Bone_001 → Bone_008 → Bone_007 → Bone_006 → Bone_005     z −0.41 → −0.74 → −0.94 → −1.80 (bone tip); skin to z −2.268
```

### 4.4 Legs — the order `findLegs` ranks them

| Side | Rank | Coxa → foot | Foot at | Tripod phase | TCS slot |
|---|---|---|---|---|---|
| −X (her right) | 0 front | `Bone_032 → 031 → 030 → 029 → 028 → 027` | (−0.80, 0.05, 1.78) | 0 | frontRight |
| −X | 1 mid | `Bone_014 → 013 → 012 → 011 → 010 → 009` | (−1.94, 0.05, −0.11) | 1 | midRight |
| −X | 2 hind | `Bone_044 → 043 → 042 → 041 → 040 → 039` | (−1.52, 0.07, −2.33) | 0 | rearRight |
| +X (her left) | 0 front | `Bone_026 → 025 → 024 → 023 → 022 → 021` | (0.80, 0.05, 1.78) | 1 | frontLeft |
| +X | 1 mid | `Bone_020 → 019 → 018 → 017 → 016 → 015` | (2.03, 0.05, −0.11) | 0 | midLeft |
| +X | 2 hind | `Bone_038 → 037 → 036 → 035 → 034 → 033` | (1.50, 0.07, −2.31) | 1 | rearLeft |

`findLegs` finds exactly TCS's six chains, coxa and foot. Swing axis in
the coxa's parent frame: (−0.595, 0.174, −0.785) on all six.

---

## 5. Scale — what the species entries carry

`model.spineUnits` is `measureRig(scene, null).spine`: for a legged rig,
the extent along Z of the BONES that lie within 12 % of the rig's width
of the median plane (`MEDIAN_BAND`). On both ants that is the mandible
bone tips to the gaster bone tip. The renderer scales the template by
`unitsOfMm(lengthMm) / spineUnits` and warns if its own reading of the
file disagrees with the table by more than `SPINE_TOLERANCE` (35 %), so
the entry MUST carry the measured number, not a rounded one — the test
holds it to 1e-3.

| | Queen at 8 mm | Worker at 3.0 mm |
|---|---|---|
| **`spineUnits`** | **2.3718** | **3.7917** |
| 1 GLB unit | 3.373 mm | 0.791 mm |
| `rigScale` (world units per GLB unit) | 0.8 / 2.3718 = 0.33729 | 0.3 / 3.7917 = 0.079121 |
| Skin, jaw tip to gaster tip (z −1.487 … 1.155 / z −2.268 … 1.917) | 2.642 units = **8.91 mm** as drawn | 4.185 units = **3.31 mm** as drawn |
| Skin, head capsule to gaster tip (mandibles excluded) | 2.596 units = 8.75 mm | 4.170 units = 3.30 mm |
| Thorax top (skin) | 1.383 units = 4.67 mm | 1.624 units = 1.29 mm |
| Hub bone height | 1.015 units = 3.42 mm | 1.359 units = 1.08 mm |
| Gaster underside above ground | 0.059 units = 0.20 mm | 0.147 units = 0.12 mm |
| Highest point | wingtips, 1.700 units = 5.73 mm | head, 1.698 units = 1.34 mm |
| Foot bones above ground / skin underside | 0.043–0.063 / 0.0000 | 0.049–0.069 / 0.0004 |
| Stance: feet across, front foot ahead of hub, hind foot behind | 2.66 units = 9.0 mm; 0.82 ahead; 0.60 behind | 4.0 units = 3.2 mm; 1.65 ahead; 2.46 behind |
| Wingspan (skin) | 4.977 units = 16.8 mm | — |
| Antenna reach (skin, |X| max) | 0.59 units = 2.0 mm | 1.44 units = 1.14 mm |

Two consequences worth reading before typing the numbers in:

- The skin overhangs the bones by 11 % on the queen and 10 % on the
  worker, so at `spineUnits` above the drawn animal is 8.9 mm and
  3.3 mm jaw-to-tip — inside the cited 7–9.5 and 1.6–6.0. If a future
  reader wants the SKIN to be exactly the cited length, the number to
  change is `lengthMm`, never `spineUnits`, which is a fact about the
  file that the test re-measures.
- Both rigs stand on y = 0 as exported: the feet's skin touches the
  ground and the foot bones sit a skin's thickness above it. The queen's
  spread wings hang nowhere near the ground (their lowest skin is at
  y 0.94), so v0's "standing on her wingtips" trap does not apply to the
  rest pose — it returns the moment a poser folds them back and down.
- TCS's `lengthUnits 4.83` for the worker is the WHOLE mesh along Z,
  antennae and hind feet included (4.825 here); it is not this number.

---

## 6. What `src/fauna/motion.ts` already does, and how far it carries

All three current posers were run on clones of both ant rigs for thirty
frames through a walk and a takeoff without a NaN
(`tests/faunaRealRigs.test.ts`, "clone and take thirty frames").

### 6.1 Legs — carries as is

`poseLegs` turns each coxa about the body's vertical (in the coxa's
parent frame, which `findLegs` supplies) by a sine of distance walked,
`STRIDES_PER_LENGTH` strides a body length, the two tripod halves a
half-cycle apart, with `IDLE_STIR` while standing and everything eased
to nothing in the air. `findLegs` picks the right six coxae and feet on
both ants, ranks them front/mid/hind by Z and alternates the tripod, so
the aphid's and the fly's gait drives the queen and the worker with no
change. What it is NOT: there is no foot lift, no knee, no IK — a foot
slides along the ground through the swing. TCS's `hexapod.ts` +
`legIk.ts` lifted feet and planted them on terrain; v1 chose coxa yaw
only, and at ant scale on a phone that reads as walking. If the Lab's
camera sits close enough that sliding feet show, the joint to add lift
on is the second bone of each chain (`Bone_012` on the queen's −X front
leg, `Bone_031` on the worker's), pitched about the leg's own sideways
axis; nothing in this document argues for it yet.

### 6.2 Antennae — carries on the queen, needs the finder fixed on the worker

`poseAntennae` yaws each antenna root about the body's up on a slow
clock. On the queen `findAntennae` names `Bone_068`/`Bone_073`, which are
the antennae. On the worker it names the mandibles (§4.2): the jaws would
wave and the antennae would stand still. Fix in §7.3.

### 6.3 Wings — the queen is the fly's opposite

`poseWings` does two things from the REST quaternion: a yaw about the
body's up by `−side × WING_SPREAD × air` (folded-back → held out as the
air lever rises) and a roll about the body's forward by `side × sin(beat)
× WING_FLAP × air`. On the fly that is right because the fly's rest is
FOLDED (yaw ±8° from −Z): the yaw carries the wing out to the side, then
the roll about +Z beats a sideways wing up and down.

On the queen the rest is already SPREAD (yaw ±85–91°). Applied as it
stands, the spread yaw of 1.15 rad would swing each wing from "out to
the side" to "forward past the head" in flight, and on the ground the
wings would stay out sideways. The rule that is right for both, in the
same sign convention:

- Measure the rest yaw ψ of each wing from −Z once, on the template
  (`atan2(dir.x, −dir.z)` of root→tip in the rig's frame; the fly ±8°,
  the queen ±88°).
- Decide the folded yaw ψ_folded ≈ 8° and the spread yaw ψ_spread ≈ 75°
  (the fly's `WING_SPREAD` of 66° added to its rest is 74°; the queen's
  rest is her own spread, and 75° puts her within 13° of her bind pose
  in flight, which the skinning tolerates).
- Yaw by `−side × (lerp(ψ_folded, ψ_spread, air) − ψ_rest)` about the
  body's up. For the fly that is the current behaviour to within a
  constant; for the queen it folds the wings back over the gaster by
  ~80° while walking and lets them open to the rest as she takes off.
  The queen's wing chains are 1.86 units long and her gaster tip is
  1.4 units behind the wing roots, so the folded wings reach a little
  past the gaster, which is what an alate's wings do.
- The flap (`WING_FLAP` about body forward, mirrored per side) then
  works unchanged on both, because it is applied to a sideways wing.
- The queen has two pairs; drive the hind pair a few degrees behind
  the fore pair or lock them together — hymenopteran fore and hind
  wings are hooked into one surface in flight, so together is honest.

`WINGBEAT_HZ` is 200 for the fly and is a module constant; the queen's
measured beat is 96 Hz (*S. richteri*, Gui et al. 2010 — a congener,
labelled so in `SUMMARY.md`). At 60 fps both alias, which the brief
accepts, but the two should not share one number: the beat belongs on
the species or the wing spec.

Do NOT copy v0's `queenModel.ts` beat: it rotates each wing root about
the root bone's LOCAL +Y, and on these chains a bone's local +Y is the
direction of its own length — the measured root local +Y in the rig's
frame is (±0.996, 0.09, 0) — so v0 was twisting the wing about its own
long axis, a feathering, not a stroke. It looked like movement at
2 MB from a phone; it was not a wingbeat.

### 6.4 Mandibles, head, gaster — no poser exists

`motion.ts` has no mandible, head or gaster poser and `rig.ts` has no
finder for them, so a chain that wants them is named, not found. The
brief's early targets (§27) for the queen list "abdomen/head reactions"
and for the worker "head/mandible actions". The bones and the axes, in
the parent's frame the way `LegSpec.axis` is expressed:

| Motion | Queen | Worker | Axis |
|---|---|---|---|
| Jaw open/close | `Bone_059` (−X), `Bone_063` (+X), parent `Bone_002` | `Bone_057` (−X), `Bone_060` (+X), parent `Bone_045` | yaw about the body's up, mirrored per side (open = tips apart) |
| Head turn / nod | `Bone_004`, parent `Bone_001` | `Bone_004`, parent `Bone_001` | turn: body up; nod: body X |
| Gaster lift / curl | `Bone_007`, parent `Bone_001` | `Bone_008`, parent `Bone_001` | body X (lift = tip down toward the ground for a sting, up for the alate's bob) |

Compose them the way `poseLegs` does — every frame from the rest
quaternion, premultiplied — never onto last frame's answer.

### 6.5 Attitude in flight — carries

`stepMotion`'s pitch and bank are body-level (the rig root), read the
measured climb and turn, and only count in the air. The queen's root
pitches about X and banks about Z exactly as the fly's does; her slower
turn (no measured saccade, SUMMARY.md §5) means `BANK_PER_RAD_S` simply
sees smaller inputs.

---

## 7. Problems, in the order they will be met

### 7.1 The game's loader cannot open either file

`src/assets/assets.ts` constructs a bare `GLTFLoader`. Both ant files
list `EXT_meshopt_compression` in `extensionsRequired`, and three's
loader throws `setMeshoptDecoder must be called before loading
compressed files` on the first buffer view — the aphid, worm and fly
never needed it, so nothing noticed. The fix is one line in `assets/`
(`gltfLoader.setMeshoptDecoder(MeshoptDecoder)` from
`three/examples/jsm/libs/meshopt_decoder.module.js`, which ships inside
the three package, resolves under Vite and needs no served `.wasm` — the
reason TCS and v0 chose meshopt over Draco). The test's own loader
carries it already. `KHR_mesh_quantization` and `EXT_texture_webp` are
handled by the loader and the browser as they are today. Not fixed
here: `assets/` is not this pass's file.

### 7.2 The worker glows white after `dressRig`

`worker.glb`'s material carries `emissiveFactor [1,1,1]` behind a black
emissive map. three renders `emissive × emissiveMap` = black, so the
file is fine as exported. `dressRig` drops `emissiveMap` (it is in the
list of packed maps to release) and leaves `material.emissive` at
(1, 1, 1): the whole worker becomes a flat white light source. The fix
belongs in `dressRig`: when the emissive map goes, set `emissive` to
black too (or leave both, which costs one texture fetch). The queen has
no emissive slot and is unaffected. Pinned as a file fact in the test.

### 7.3 `findAntennae` names the worker's jaws

§4.2. Two fixes, either honest: (a) in `rig.ts`, on each secondary hub
consider MIRRORED pairs first and take the longest by rest length (all
four legged rigs agree; "highest" was a proxy that held on three of
them); or (b) name the antennae on the species model the way the worm's
chain is named. (a) keeps "found by measurement" true, which is the
file's whole premise. When it lands, move the `antennaeFound` pin in the
test to `Bone_050` / `Bone_054`.

### 7.4 `findWings` finds one pair of the queen's two

§3.4. The file carries the answer in `extras.wingRoots`
(`Bone_046`, `Bone_049` fore; `Bone_052`, `Bone_055` hind), and
`gltf.parser.json.extras` is how v0 read it — but `assets.loadModel`
returns only the scene, so the extras are not reachable through the
current seam. Alternatives that stay inside "found by measurement":
have `findWings` return EVERY mirrored pair of hub children that are
not legs and lie above the body (the queen's four wing roots are the
only hub children at y > 1.1; the fly's two likewise), ranked fore to
hind by Z. Then `WingSpec` gains nothing and `poseWings` loops four
instead of two.

### 7.5 The wings are baked open

§3.4 and §6.3. Not a defect in the file — the bind pose is the flight
pose — but the fly's spread-by-air-lever cannot be applied to it as it
stands. Measure the rest yaw and drive toward a target yaw instead.

### 7.6 The file's `left`/`right` keys are the viewer's

§2. `extras.wingRoots.leftFore` is `Bone_046` at x = −0.22, her right
forewing. v0 only ever used the keys mirrored, so it never mattered
there. Anything that turns "left" into a sign here should take the sign
from the bone's X.

### 7.7 Two skinned meshes, two skins, twelve influences

The queen is two `SkinnedMesh`es (`queen_body`, `queen_wings`) over one
bone hierarchy with two `Skeleton` objects built from the same 74
bones. `SkeletonUtils.clone`, `dressRig` (one material touched) and the
posers all handle it, measured. Both files carry three (queen) or two
(worker) joint/weight sets — 12 and 8 influences a vertex — of which
three uses the first four; the wing roots and the coxae may skin a
little differently from the authoring tool, invisibly at this size.
The existing test's "one skinned mesh each" and `output_unwrapped`
checks are about the wild rigs and are left saying so; the ants have
their own.

### 7.8 The species table's shape

`CreatureModel` is `{ path, spineUnits, chain }`. The `QUEEN` and
`WORKER` entries in `species.ts` already name these two paths and carry
`UNMEASURED_SPINE_UNITS` (zero, below the validator's floor, so the
table refuses to boot an ant nobody has measured). The two numbers that
replace it:

```
queen:  model: { path: 'models/queen-winged.glb', spineUnits: 2.3718, chain: null }
worker: model: { path: 'models/worker.glb',       spineUnits: 3.7917, chain: null }
```

with `lengthMm` 8 (range 7–9.5) and 3.0 (range 1.6–6.0) per
`SUMMARY.md`, which the entries have. Both are legged rigs, posed by
their legs and wings, so `chain` is null exactly as the aphid's and the
fly's are. `tests/faunaRealRigs.test.ts` holds any typed `spineUnits` on
an entry that names one of these files to the measurement, to 1e-3;
the zero is left to the table's validator. If the species entry grows
named chains for the mandibles, head and gaster (§6.4), the strings are
the ones in §3 and §4 and the test already holds every one of them to
the file.

---

## 8. What was not measured

- Skinning quality under the posers (a folded queen wing against her
  gaster, a worker's mandible opening through its own head) — this
  pass ran the posers for NaNs, not for a look. The Lab's probe shot is
  where that shows.
- The queen's normal map at 3.4 mm a unit is real detail (325 KB);
  whether the worker's near-flat 11 KB normal is worth its fetch at
  0.8 mm a unit is a rung question `dressRig`'s `keepNormal` already
  exists to answer.
- Whether the meshopt decoder's WASM start-up (a few ms, once) is
  visible on the phone's first load. It is inside the three package and
  loads with it.
