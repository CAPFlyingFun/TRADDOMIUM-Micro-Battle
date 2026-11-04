/**
 * THE CHARACTER ROOM LIVES ON ITS OWN SITE NOW (Joshua, 2026-11-04: "Let remove the character room from TRADDOMIUM
 * altogether. Instead, the character room will be the separate repo", and "instead of opening directly in the same
 * TRADDOMIUM repo, the character builder page, it's redirecting to the new single character builder Repo designed only
 * for custom character creations").
 *
 * The room -- Sarah, Jack and the newborn, their shapes and skin, clothes, poses, joint ranges and birth -- was split
 * out that day into CAPFlyingFun/custom-character-builder-system, which every one of his games draws on. This build
 * keeps only the way there:
 *
 *  - the Editors card below, whose button is a LINK to that site and says it leaves (OPEN ↗), and
 *  - index.html's first script, which sends an old bookmark into the room (`?open=CharacterRoom`, `?open=sarah`,
 *    `?open=lab.sarah`) straight to the builder before anything here loads, carrying the rest of the address with it
 *    (`?skin=ktx2` still means what it meant). CHARACTER_BUILDER_LINKS is that script's list, pinned by a test.
 *
 * A character made there comes back to a game as a file -- the builder's EXPORT of its character book -- and is baked
 * into the game as a preset. A Sims-style creator INSIDE a game would be a different feature, not this link.
 *
 * Pure: two constants and a record.
 */
import type { DevTool } from '../devtools/DevTool';

/** The builder's site (its own repo's GitHub Pages). */
export const CHARACTER_BUILDER_URL = 'https://capflyingfun.github.io/Custom-Character-Builder-System/';

/** The `?open=` names that used to open the room here, lower case; index.html sends each to the builder. */
export const CHARACTER_BUILDER_LINKS: readonly string[] = Object.freeze(['characterroom', 'sarah', 'lab.sarah']);

export const characterBuilderTool: DevTool = {
  id: 'character-builder',
  title: 'Character Builder',
  description:
    'Makes and saves characters — Sarah, Jack and the newborn: body, belly, skin, clothes and poses. It has its own '
    + 'site now, for every game; this opens it there. Export a character there to bring it into the game.',
  href: CHARACTER_BUILDER_URL,
};
