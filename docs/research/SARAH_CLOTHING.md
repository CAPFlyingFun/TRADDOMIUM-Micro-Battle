# Sarah Lab clothing — alpha.86

Joshua's 2026-10-08 clarification: finish the bright red tee and black leggings
first, then fitted one-piece suits. Original bust size is normal at belly 0%;
belly 100% adds 50%, and belly 200% adds 100%. These are local geometric shape
scales with a fade into the chest, not volume or cup-size measurements.

The shirt remains a separate cloth mesh, with the existing eight-view reference
providing fabric folds and seams. Its colour is brighter red. Every garment
copies the body's final bone weights and morph targets. Cleavage-only bridging
now runs for the bikini and swimsuit as intended.

The body carries `_CLOTH_COVER`: four bits, in the order shirt, leggings, bikini,
swimsuit. Each bit marks original vertices safely inside the garment, with a
3 mm margin at the cut. Sarah Lab hides a body triangle only when all three
vertices belong to the same visible garment. Boundary skin remains visible;
switching to `none` restores every original triangle. Outfit indices are cached
on the CPU and reuse one GPU buffer, without filtering triangles each frame.

## Rebuild without the source master

`npm run bake:sarah-clothes` reads the shipped `public/models/sarah-base.glb`.
It recovers the mesh's corrective bind-space transform from each joint and its
inverse bind matrix, verifies they agree, dequantizes the body back to metres,
and preserves its geometry, UVs, skeleton and repaired weights. It regenerates
shapes and clothing, compresses them, and replaces the file only after writing
a complete temporary GLB. It can run again on its own output. The original
source master is neither needed nor changed; normal `bake:humans` also uses the
updated growth and clothing definitions when that master is available.

Next recommended order: sleeveless catsuit, bodysuit, long-sleeved wetsuit.
A loose jumper needs its own hanging garment surface rather than copying the
skin into the space between the legs. Keep all new designs in Sarah Lab until
Joshua reviews their appearance and movement.

## alpha.87 fit corrections

Joshua's close-up review: limit added bust width to 10% at the largest setting,
grow mainly forward and tilt slightly downward with weight. The maximum forward
growth target is now 1.9 rather than 2.0; the halfway setting reads 1.45. These
labels describe forward growth, not a uniform scale or volume. Vertical expansion
is reduced and a small downward rotation term gives weight without long hanging
lobes. Original bust geometry remains the zero setting.

Smaller belly keys now receive mesh smoothing, with the back and limbs held
outside its region. The transition fades over 10 cm below the bust instead of
6 cm. This addresses the upper-belly crease in the bare body as well as clothing.
The tee's welded open hem is relaxed along its boundary, with surface smoothing
fading upward over the lower fabric. All garment targets use the same operation.
Close-up front, side and underside probe shots supplement the wider motion checks.

### Rounded bust revision after preview

The initial alpha.87 preview was held for review. Joshua identified flattened
tips at large sizes. Growth now uses an affine rounded cap; its transition fades
at the chest attachment rather than radially through the front tip. Width and
height are capped at +10%, growth is mainly forward, with a small downward tilt.

Use nominal volume targets of 1.30 at belly 100 and 1.55 at belly 200. These are
artistic controls, not measured volumes of the baked local mesh: attachment fades
and interpolation change the exact result. 1.55 is a larger optional setting,
not an average for twins or triplets. Research did not establish such a multiplier.

The CGATE study followed women from week 12 to birth and found average volumes
of 420 and 516 mL (about 23% growth). Another study of 83 women between roughly
weeks 10 and 35 reported 27.2%. These exclude growth before the early-pregnancy
measurement and show substantial individual variation. Do not confuse volume
ratios with dimension scales: uniform 1.55 dimension scaling would mean 3.72
times volume; uniform 1.90 would mean 6.86 times volume.

Sources: https://pubmed.ncbi.nlm.nih.gov/24100511/ and
https://www.nature.com/articles/s41598-026-41646-5 .

### Shirt revision after the rounded-body preview

All four earlier review panels were the same revision, bare above and clothed
below. The tee's envelope was changing the rounded bust contour. Protect the
outer bust from projection while continuing to fill the cleavage and abdomen
hollows. Hold open neckline edges through the envelope pass and relax their boundary loops to remove sharp corners. Cut an explicit
U neckline, 14 cm below the neck joint at front centre, with a 20 cm front opening, rising toward the shoulders;
use the neck's actual front depth rather than the belly's forward-depth threshold.
Increase clearance from 8 to 12 mm and reduce borrowed normal-map strength to 0.25.
The new clothing regression compares rounded-cap geometry with envelope bridging
on/off and checks that the neckline centre lies lower than its sides.

The next tee refinement lifts fabric across the sternum toward the horizontal
bust envelope, with a slight 1 mm sag. It changes only forward depth in the
central strip, fades into the rounded outer cups, and holds the neckline. Avoid
normal-direction masking here: the sides of the cleft face sideways, which
otherwise leaves a thin centre crease. Apply this span to every cloth morph;
the body geometry and other outfits retain their own shapes. The regression
also requires at least 25 mm of central fabric lift compared with a skin-fit tee.

Further review widened the central span to fade out at 7.8 cm from the centre,
with stronger averaging of the central cloth positions. Protect the outer cap
beyond 8.5 cm in the regression. Front renders of the bare body at 20, 30, 40,
50, 60 and 70% show a smooth upper abdomen. The tee wrinkles include both
borrowed fabric detail and ridges in the generated envelope: fair the actual
front abdomen cloth positions, fading away from the bust, back and outer sides.
Reduce the texture detail to 35% for the shirt alone,
leaving the normal scale at 0.25. SARAH_SWEEP=1 captures all six bare front views
before running the tee and motion checks.

Close-up review then identified a thin central line and diagonal junction lines.
The chest has no open mesh edges. Fair the base sternum and under-bust junction
once before rebuilding morphs, with UV copies sharing positions and repaired
normals. A primitive marker prevents repeated rebuilds from accumulating this
fairing; pin the outer rounded cap. Locally attenuate the old skin normal-map
crease in the same chest area through a UV mask, leaving other texels unchanged.
Use that mask to soften the fine drawn crease in the skin colour texture too,
preserving broad colour and lighting rather than flattening the entire skin.
The tee gets 120 surface-relaxation passes and a separate under-bust junction
mask. This blends the sharp Y-shaped junction into the chest and belly surface.
Verify close-ups rather than relying on the full-body contact sheet alone.

The next review focuses on the hem and rear overlap. The reference tee spans
the upper seat rather than tracing the centre cleft. Add mirrored horizontal
envelopes to the lower back of the shirt, with outward-only depth displacement
and a smooth fade into the sides and waist. Fair the lower rear cloth surface;
the leggings and body retain their existing detail. The rear bridge is applied
to each cloth morph before computing its own normals. SARAH_HEM_ONLY=1 captures
front, side and rear at 50/100/200%, then checks walking and sitting. The clothing
regression also checks rear fabric clearance compared with a skin-fit tee.
After fairing, constrain the rear/side shirt panels to remain at least 18 mm
behind the body's rear row envelope, interpolated at the cloth's current x/y.
Using individual original vertices for this constraint leaves ridges when the
cloth moves along the seat; the continuous envelope keeps the overlap smooth.
Fade this constraint into the waist and sides, and smooth the lower rear cloth
normals over welded neighbours to soften shading on the coarser back mesh.

Without that final clearance hold, averaging
the convex seat pulls the cloth inside the leggings and exposes dark patches.

Final review adds a sewn hem: a 14 mm band with a subtle stitch line and 1.5 mm
raised edge, measured along welded cloth neighbours from the hem. Vertex colour
keeps the band attached to the garment across every morph and UV seam. Use a smooth torso-angle curve with the back and sides 15 mm above the hip
reference, leaving the centre 40 mm below it under the bump. The earlier
fixed-depth transition and raised-front-side mask made a sharp notch; this
continuous arc follows the reference around the body and shortens the rear.
A further front-view review replaces the smoothstep profile with a rounded square-root
front-facing arc: the hem sweeps toward the hips without an S-shaped inward hook.
The approved rear height stays unchanged.
The existing navel morphs were baked but never assigned in SarahLabScene. Wire
navelWeights into the live influence update: normal/deeper navel at small sizes,
transition to the 36 mm wide outie at 0.075 mm per slider percent, capped
at its 10.5 mm maximum at 140%. Constrain detection to the reference navel near 0.933 m above the feet;
the previous unrestricted search selected a surface dip 4 cm too high.
Preserve the original WebP texture encoding during chest texture cleanup.

The outie close-up still read as an innie because the source skin textures
painted a dark dimple over its projecting geometry. Attenuate the normal-map
dimple and soften the small colour patch around the detected navel, once only.

Final navel size review doubles circumference (and diameter) from the
18 mm outie while increasing projection by 50%, from 7 to 10.5 mm.
Extend the affected vertex radius with it so the larger dome is not clipped
at the previous influence boundary. Check the bare front and quarter views.

Use the analytic dome slope for outie normals, fading to the authored normals
outside its foot; the general belly-normal relaxation flattened its lighting
and retained an authored seam through the front. Fair the final hem boundary
after clearance constraints so the side fitting does not put small steps back.

The current outie rule is 0.075 mm per slider percent: 3.75 mm at 50%,
5.625 mm at 75%, 7.5 mm at 100%, and 10.5 mm from 140% onward.
Do not add the deeper innie morph underneath it. The 36 mm diameter is retained.

The final lower tee is rebuilt by `scripts/rebuildShirtHem.mjs`, called after
`growClothes` in the Sarah bake. The old skin-derived hip panels are removed;
smoothing them alone kept exposing overlapping panels. Keep the original bust,
neckline and sleeves, clip below hip height + 0.20 m, and sew on 24 continuous
fabric rings sampled from the body and all 14 morph shapes. Match the exact
clipped boundary and skin weights, fade the join smoothly, use ordered heights,
and span concave columns and the rear cleft. The lower hem follows the agreed
front arc and higher hip/back cut. Its raised edge is 1.5 mm with a shaded band.

The original shirt artwork occupies the upper half of a UV atlas. The lower
half is plain red cloth, with a separate UV island at the sewn join. This avoids
stretching old texture seams across the new hip panels. Smooth the new sheet's
normals across rows, columns and the join. The lower band follows the pelvis
rather than separate thigh rotations; a regression check verifies that the
hem stays together when the legs move independently. Render front, side and
back at 50%, 100% and 200%, plus walking and sitting, before publication.

Broader character customization and randomized hair, clothes, face and belly
controls remain future work.

Raised-arm review: Sarah Lab now includes T-POSE, which clears the arms from the
side hem. Fair the complete periodic hem loop and blend its corrections into
the lower rings. Use a smooth front arc with zero slope at the side and front
centre. Match the upper artwork colour at the new fabric join and fade into
plain cloth; flatten the tee normal map so baked body relief cannot draw a
false fabric crease. Review 50%, 100% and 200% with arms raised, then walk/sit.
The upper attachment is faired across both old and new triangles over a 7 cm
belt, with welded geometric normals, to remove the old waist ledge. UV copies
remain separate for artwork but share positions during surface fairing.
Raised-arm 200% review also adds a gradual 12 mm radial / 8 mm downward
clearance toward the hem, preventing leggings from clipping the lower front
edge after the periodic fairing. The torso and accepted navel are unchanged.

Cotton jersey material: `shirtFabric.mjs` adds a second UV set for physical
1.4 mm knit stitches, continuous across the hip patch / torso artwork join.
Embedded tileable yarn normal and roughness maps use that UV set; light colour
grain is baked into the original artwork UVs. No mesh or morph positions change.
The material stays non-metallic and matte (roughness 0.79–0.91). The full clothes
bake reapplies the material after rebuilding the tee.

Sarah Lab image try-on: expandable TEXTURE panel accepts local images for shirt,
leggings, bikini and swimsuit. Auto / wrap-once / tile, repeat scale, mirror X/Y
and 90-degree rotation use a separate continuous wrap UV set. Cotton relief and
roughness remain in place. Uploads are resized to at most 2048 pixels per side,
kept in the current scene only and disposed on replacement/reset/exit. Reset
restores original material maps. Garment selection shows its matching outfit.
The panel scrolls within landscape/portrait height without orbiting the model.

Retain body beneath outfits (2026-10-11): Sarah Lab no longer changes the body
index buffer according to clothing coverage. Full skin remains beneath every
outfit. Tee base offset is 6 mm; leggings retain 4 mm. The final faired cloth
is fitted against the nearest body triangle at each live slider key, with a
local 25 mm search radius and interpolated skin normals. Nearby inward points
are placed 6 mm outside skin for the shirt and 4 mm for leggings; fabric bridges
farther away retain their drape. A radial fit was rejected because it reached
the wrong surfaces at the shoulders. Existing hem shaping, material and upload
controls remain.
The fitter bundles the actual Sarah Lab weight functions to include sag, breast
growth and outie simultaneously. It encodes each correction into the existing
garment belly keys (and base at 100%), subtracting the base correction from each
key. Body geometry and morphs, target count and runtime controls are unchanged.
Nearby cloth also inherits interpolated joint weights from the nearest skin
triangle at the 100% reference. This replaces the lower tube’s pelvis-only
attachment where it touches the hips, so walking thighs do not cut through it.
The seam regression now checks equal effective weights on coincident UV copies
and normalized skinning, rather than requiring all thigh weights to be zero.
Walking review adds graded hip ease: shirt clearance blends from 6 mm at the
upper waist to 12 mm beside the moving hips. Collar/bust remain at 6 mm and
leggings at 4 mm. This gives the thigh motion a small margin without increasing
the whole shirt’s offset.

### Pending review: final shirt surface and lighting (2026-10-12)

Joshua requested a smoother under-bust and abdomen/side transition, reviewed at
0/20/40/60/80/100 before publishing. The final skin-fitting step previously
updated positions without updating normal morphs. Recompute welded geometric
normals at the combined runtime slider keys and encode them alongside the fitted
positions. Fair the final shirt surface locally below the bust and across the
abdomen, pin the hem, and constrain each pass to retain skin clearance. Body,
neckline, textures and customization controls remain as before.
`SARAH_TEE_ONLY=1 SARAH_SMOOTH_SWEEP=1 npm run probe:sarahlab` captures front and
quarter views at all six requested settings. This pass is pending visual approval.

### Pending review: upper-band fit below 60% (2026-10-12)

Joshua accepted 60–200% and requested a lower-reading belly at 0–59%. Keep the
lower band unchanged; blend through the middle into a closer upper band, with
9 mm front-to-skin clearance. Apply the stronger tuck at 0/25 and a reduced tuck
at 50. `refineEarlyShirt.mjs` first inserts a 60% anchor as the old interpolation
of 50/75 on every primitive, then changes only the shirt's 0/25/50 keys. Runtime
interpolation now includes this anchor, preserving the accepted 60–200% range.
The postprocess runs after final fitting/material baking; its marker is the
60% anchor and a fresh rebake recreates it from the unmodified fitted keys.
Review uses straight FRONT and true PROFILE at 0/10/20/30/40/50/60:
`SARAH_TEE_ONLY=1 SARAH_SMOOTH_SWEEP=1 SARAH_SMOOTH_VALUES=0,10,20,30,40,50,60 npm run probe:sarahlab`.
No push until Joshua has reviewed the images.
The tuck fades out across the front abdomen before the side seams (full inside
9 cm from centre, zero at 14 cm), is capped at 22 mm before blending, and
retains original lighting outside the adjusted vertices. This prevents the
underarm skinning and accepted bust shading from being pulled into this edit.

### Pending review: early front contour (2026-10-12)

A plain-colour diagnostic retained the front outline, so baked artwork was not
its main cause. At 0–25% the cross-section still rolled from about 9 cm depth at
the centre to 5 cm at 12 cm off-centre, almost unchanged between these keys.
The early-shirt postprocess now fills that shoulder into a flatter fabric panel,
with a maximum 12/9/3 mm adjustment at 0/25/50%. It holds X/Y, the central profile,
the back and the bust, and moves outward from the fitted cloth to retain skin
clearance. The front depth guide excludes back-panel points and interpolates between
populated front rows so sparse rows cannot leave horizontal bands. A regression
test reproduces the back-only row case. Updated normals follow the surface.
The existing 60% anchor isolates all of this from the accepted 60–200% shapes.
Review uses straight front and 90-degree side views at 0/10/20/30/40/50/60%.

### alpha.88: bust overlap cleanup

The pale outer-bust patches in the side preview were body/cloth overlap with
lowered arms. `clearShirtBust.mjs` adds up to 8 mm of local outward/forward ease
above 1.14 m, tapering around the outer bust and away from the sleeve. It keeps
the complete body and the belly geometry. The displacement is smoothed across shared seam vertices and avoids pushing
fabric down into the under-bust fold. All slider anchors receive matching
normal changes; coincident seam vertices share skin weights after export. This cleanup ships with the reviewed smoothing/early-shape work;
further front belly shaping is deferred until Joshua supplies a reference.

### alpha.89: inward early waist silhouette (2026-10-12)

Joshua clarified that the remaining “love handles” are the left/right outline
from the front, rather than depth or lighting. `refineEarlyWaist.mjs` adjusts X
only, with a broad inward waist curve at zero and an explicit 30% key halfway
toward the accepted 60% width. The waist field fades before the bust and hips;
its maximum inward correction is 18% of the local half-width. Skin and all
four garments receive the same field so the shirt does not cut into the body.
Y/Z and all 60–200% targets are preserved. Surface-normal corrections track the
new width. Joshua approved the straight front and side 0/30/60% previews, then requested
a complete 0/10/20/30/40/50/60% comparison for this push. This work is separate
from the alpha.88 bust cleanup.

The final alpha.89 review also exposed a pinched fold immediately below the bust.
`smoothShirtUnderbust.mjs` bridges those local hollows between the cup and torso, sampling the existing
front surface through triangle interiors, then fairs the transition across the
shirt's shared mesh topology. It does not pull the fabric back into the skin; positions
and normals are encoded at every slider anchor, including 30%. Waist width and
belly geometry are outside this local correction. The complete seven-step front
and side sweep is repeated after this smoothing pass.
