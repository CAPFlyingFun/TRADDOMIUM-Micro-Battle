# Sarah's face: eyes that look, a mouth that talks (waiting for his approval)

Joshua, 2026-10-24: "would like to somehow add bones 🦴 in or something around the mouth to open and close like
talking, and maybe the illusion of the eyes being able to look around in sync."

Her approved v2 body is a closed sculpt. The mouth is fused shut, the eyes are blank, there is no jaw bone and no face
morph, and the file may not change. So her face is a **shader layer on her own body material** (`faceRig.ts`). A small
seeded animator moves it (`faceMotion.ts`). Nothing new is downloaded and no new vertex data is added.

- **The jaw** turns about her jaw hinge in the vertex stage.
  - Every point below her lips is weighted by where it is at rest: sharp across the lips, soft across the cheeks, fading
    under the chin.
  - The lower lip opens less toward the corners, so the mouth opens as a lens that closes at the corners.
  - Where the lips part, the stretched skin is painted as the mouth's inside, measured against the lips' edges so it
    never follows a triangle. It has the inner-lip red, a dark throat, and upper and lower teeth that show only once
    the gap is wide enough.
- **The eyes** are a virtual eyeball under each pair of lids, drawn per pixel: the white, a hazel-green iris with
  fibres and a dark rim, the pupil, the pink inner corner, lid shadow, upper and lower lashes, and a small flick at the
  corner. Turning the gaze moves the iris on the sphere, and the lids clip it.
  - **BLINK**: the upper lid comes down every 2 to 6 s, sometimes just after a look.
  - **EYES · LOOK AROUND**: quick saccades between held looks, back to the middle every few. Both eyes move together.
  - **EYES · AT THE CAMERA**: each eye aims at the viewer, so they converge up close. They hold at about 30° when the
    viewer goes behind her.
  - **EYES · AHEAD**: straight ahead.
- **Brows** in auburn brown with drawn hairs, a **lip colour**, and wet eyes.
- **FACE section**:
  - FACE ON/OFF shows the bare sculpt.
  - Buttons: EYES, BLINK and TALK (syllables in phrases with pauses).
  - Sliders: MOUTH (held open), BROWS and LIP COLOUR.
  - EYE COLOUR swatches: hazel, green, brown, blue and grey.
- It is laid only on her approved v2 body (every number is measured on that file). With FACE off she draws exactly as
  before (pixel-identical in the check).

Sheet: `01-face-rig.jpg`, at 72%, in the room's own light.
