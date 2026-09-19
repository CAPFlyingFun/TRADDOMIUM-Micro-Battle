/**
 * GENERATED FILE — DO NOT HAND-EDIT.
 *
 *     node scripts/bakeAudio.mjs
 *
 * Every edit made here is lost on the next bake. What a reader wants to
 * change is almost always in the story repository (the words, the clip,
 * the authored gain) or in `scripts/bakeAudio.mjs` (which chapter, which
 * bus); this file is only their sum, written down so the build needs
 * neither of them present.
 *
 * Chapter 1, copied out of `capflyingfun/tmb-story` and into
 * `public/audio/`: 88 voice lines and 20 sound assets, 3.86 MB of mp3.
 *
 *   TOMBS / settlement systems   7 lines   0.16 MB
 *   Jack Bennett                47 lines   1.03 MB
 *   Sarah Bennett               34 lines   0.64 MB
 *
 * Buses: voice 88, sfx 16, ambience 4, music 0.
 *
 * MUSIC IS EMPTY, and that is not an oversight: no score exists in either
 * repository yet. `busCarries()` is how a settings panel asks before it
 * draws a fader, so that an unavailable action never looks functional.
 *
 * The bus of a sound is decided by the bake from the asset's own `loop`
 * flag, not from the story repository's category: a bed a player would
 * turn down to hear dialogue is AMBIENCE whether the manuscript files it
 * under `alarm`, `system` or `ambience`. The bake's header carries the
 * two assets where those rules disagree.
 *
 * `src/data` is where the numbers live (ARCHITECTURE §7) and this is a
 * registry of them. The import is TYPE-ONLY and is erased at build, so
 * nothing in `data/` carries a runtime dependency on `src/audio/` — only
 * the compiler links the shape.
 */
import type { AudioManifest } from '../audio/manifest';

export const AUDIO_MANIFEST: AudioManifest = {
  chapter: 1,
  voice: [
    { lineId: "system-2e8d8d3e2911", character: "system", characterName: "TOMBS / settlement systems", text: "Warning. unauthorized system access.", url: "audio/voice/system-2e8d8d3e2911.mp3", chapters: [1] },
    { lineId: "jack-bennett-2b8704441765", character: "jack-bennett", characterName: "Jack Bennett", text: "What? Okay, I'm awake.", url: "audio/voice/jack-bennett-2b8704441765.mp3", chapters: [1] },
    { lineId: "jack-bennett-85dfddc7134b", character: "jack-bennett", characterName: "Jack Bennett", text: "That's not good.", url: "audio/voice/jack-bennett-85dfddc7134b.mp3", chapters: [1] },
    { lineId: "jack-bennett-492f4059781a", character: "jack-bennett", characterName: "Jack Bennett", text: "Come on. What are you doing?", url: "audio/voice/jack-bennett-492f4059781a.mp3", chapters: [1] },
    { lineId: "jack-bennett-b9c31e4c82cf", character: "jack-bennett", characterName: "Jack Bennett", text: "No. Where'd you go?", url: "audio/voice/jack-bennett-b9c31e4c82cf.mp3", chapters: [1] },
    { lineId: "system-610b0d021f1b", character: "system", characterName: "TOMBS / settlement systems", text: "Security protocol violation.", url: "audio/voice/system-610b0d021f1b.mp3", chapters: [1] },
    { lineId: "jack-bennett-549daf1f1de8", character: "jack-bennett", characterName: "Jack Bennett", text: "Okay. Definitely awake now.", url: "audio/voice/jack-bennett-549daf1f1de8.mp3", chapters: [1] },
    { lineId: "jack-bennett-27b114bdd284", character: "jack-bennett", characterName: "Jack Bennett", text: "That's impossible.", url: "audio/voice/jack-bennett-27b114bdd284.mp3", chapters: [1] },
    { lineId: "system-a6ce88995aab", character: "system", characterName: "TOMBS / settlement systems", text: "Tombs project.", url: "audio/voice/system-a6ce88995aab.mp3", chapters: [1] },
    { lineId: "jack-bennett-ecf78584ec95", character: "jack-bennett", characterName: "Jack Bennett", text: "Oh, no you don't.", url: "audio/voice/jack-bennett-ecf78584ec95.mp3", chapters: [1] },
    { lineId: "jack-bennett-2ffc77da7b3f", character: "jack-bennett", characterName: "Jack Bennett", text: "Well, that's new.", url: "audio/voice/jack-bennett-2ffc77da7b3f.mp3", chapters: [1] },
    { lineId: "jack-bennett-a8a6aa7ae3b3", character: "jack-bennett", characterName: "Jack Bennett", text: "Sarah?", url: "audio/voice/jack-bennett-a8a6aa7ae3b3.mp3", chapters: [1, 3] },
    { lineId: "jack-bennett-45ac1e9fe1de", character: "jack-bennett", characterName: "Jack Bennett", text: "Sarah, you there?", url: "audio/voice/jack-bennett-45ac1e9fe1de.mp3", chapters: [1] },
    { lineId: "sarah-bennett-3f51406be04d", character: "sarah-bennett", characterName: "Sarah Bennett", text: "I'm here,", url: "audio/voice/sarah-bennett-3f51406be04d.mp3", chapters: [1] },
    { lineId: "sarah-bennett-0df3f0a6bee0", character: "sarah-bennett", characterName: "Sarah Bennett", text: "What's wrong?", url: "audio/voice/sarah-bennett-0df3f0a6bee0.mp3", chapters: [1] },
    { lineId: "jack-bennett-3141593a1c9d", character: "jack-bennett", characterName: "Jack Bennett", text: "I've got something weird on my computer. It tripped a security alarm.", url: "audio/voice/jack-bennett-3141593a1c9d.mp3", chapters: [1] },
    { lineId: "sarah-bennett-c0ca574b594a", character: "sarah-bennett", characterName: "Sarah Bennett", text: "Define weird.", url: "audio/voice/sarah-bennett-c0ca574b594a.mp3", chapters: [1] },
    { lineId: "jack-bennett-a376700976d7", character: "jack-bennett", characterName: "Jack Bennett", text: "I think somebody's in the system.", url: "audio/voice/jack-bennett-a376700976d7.mp3", chapters: [1] },
    { lineId: "sarah-bennett-81ff0dc894cf", character: "sarah-bennett", characterName: "Sarah Bennett", text: "Are you sure?", url: "audio/voice/sarah-bennett-81ff0dc894cf.mp3", chapters: [1] },
    { lineId: "jack-bennett-3d94cfec7c01", character: "jack-bennett", characterName: "Jack Bennett", text: "No. That's why I'm calling the smarter scientist.", url: "audio/voice/jack-bennett-3d94cfec7c01.mp3", chapters: [1] },
    { lineId: "sarah-bennett-5a071d01be77", character: "sarah-bennett", characterName: "Sarah Bennett", text: "Good answer.", url: "audio/voice/sarah-bennett-5a071d01be77.mp3", chapters: [1] },
    { lineId: "jack-bennett-632f5041e805", character: "jack-bennett", characterName: "Jack Bennett", text: "Can you come take a look?", url: "audio/voice/jack-bennett-632f5041e805.mp3", chapters: [1] },
    { lineId: "sarah-bennett-2a350447dd17", character: "sarah-bennett", characterName: "Sarah Bennett", text: "I'm on my way,", url: "audio/voice/sarah-bennett-2a350447dd17.mp3", chapters: [1] },
    { lineId: "jack-bennett-31ac40401ca8", character: "jack-bennett", characterName: "Jack Bennett", text: "Who are you?", url: "audio/voice/jack-bennett-31ac40401ca8.mp3", chapters: [1] },
    { lineId: "system-49a4bf38c005", character: "system", characterName: "TOMBS / settlement systems", text: "Boundary control.", url: "audio/voice/system-49a4bf38c005.mp3", chapters: [1] },
    { lineId: "jack-bennett-9b850bb838a8", character: "jack-bennett", characterName: "Jack Bennett", text: "No, no, no.", url: "audio/voice/jack-bennett-9b850bb838a8.mp3", chapters: [1] },
    { lineId: "sarah-bennett-41421ed41839", character: "sarah-bennett", characterName: "Sarah Bennett", text: "Please tell me you didn't break something.", url: "audio/voice/sarah-bennett-41421ed41839.mp3", chapters: [1] },
    { lineId: "jack-bennett-6aa0f73ed972", character: "jack-bennett", characterName: "Jack Bennett", text: "I was asleep,", url: "audio/voice/jack-bennett-6aa0f73ed972.mp3", chapters: [1] },
    { lineId: "sarah-bennett-e240820580d9", character: "sarah-bennett", characterName: "Sarah Bennett", text: "You called me in here to admit that?", url: "audio/voice/sarah-bennett-e240820580d9.mp3", chapters: [1] },
    { lineId: "jack-bennett-1ecaa1e81e25", character: "jack-bennett", characterName: "Jack Bennett", text: "No. That was my defense.", url: "audio/voice/jack-bennett-1ecaa1e81e25.mp3", chapters: [1] },
    { lineId: "sarah-bennett-da6d3f2466a2", character: "sarah-bennett", characterName: "Sarah Bennett", text: "Against what?", url: "audio/voice/sarah-bennett-da6d3f2466a2.mp3", chapters: [1] },
    { lineId: "jack-bennett-ab5acb662fb5", character: "jack-bennett", characterName: "Jack Bennett", text: "Whatever this is.", url: "audio/voice/jack-bennett-ab5acb662fb5.mp3", chapters: [1] },
    { lineId: "jack-bennett-68873cb0ae3a", character: "jack-bennett", characterName: "Jack Bennett", text: "I was reviewing yesterday's test results.", url: "audio/voice/jack-bennett-68873cb0ae3a.mp3", chapters: [1] },
    { lineId: "sarah-bennett-ecb1ce66f7bc", character: "sarah-bennett", characterName: "Sarah Bennett", text: "You were sleeping,", url: "audio/voice/sarah-bennett-ecb1ce66f7bc.mp3", chapters: [1] },
    { lineId: "jack-bennett-fa0505b74e44", character: "jack-bennett", characterName: "Jack Bennett", text: "I was reviewing them internally.", url: "audio/voice/jack-bennett-fa0505b74e44.mp3", chapters: [1] },
    { lineId: "sarah-bennett-d26997d1aa80", character: "sarah-bennett", characterName: "Sarah Bennett", text: "With your eyes closed?", url: "audio/voice/sarah-bennett-d26997d1aa80.mp3", chapters: [1] },
    { lineId: "jack-bennett-050e0785c171", character: "jack-bennett", characterName: "Jack Bennett", text: "It's an advanced technique.", url: "audio/voice/jack-bennett-050e0785c171.mp3", chapters: [1] },
    { lineId: "sarah-bennett-ea3f24b4acf1", character: "sarah-bennett", characterName: "Sarah Bennett", text: "Jack.", url: "audio/voice/sarah-bennett-ea3f24b4acf1.mp3", chapters: [1, 2, 3] },
    { lineId: "jack-bennett-06415c9f30d8", character: "jack-bennett", characterName: "Jack Bennett", text: "Right. Problem.", url: "audio/voice/jack-bennett-06415c9f30d8.mp3", chapters: [1] },
    { lineId: "jack-bennett-eb7b0cfc9b60", character: "jack-bennett", characterName: "Jack Bennett", text: "I got an unauthorized access warning. I checked the network monitor and saw a connection I didn't recognize, but it disappeared before I could trace it.", url: "audio/voice/jack-bennett-eb7b0cfc9b60.mp3", chapters: [1] },
    { lineId: "sarah-bennett-d446f7575941", character: "sarah-bennett", characterName: "Sarah Bennett", text: "And then?", url: "audio/voice/sarah-bennett-d446f7575941.mp3", chapters: [1] },
    { lineId: "jack-bennett-4b4b13be3859", character: "jack-bennett", characterName: "Jack Bennett", text: "It opened the TOMBS directory.", url: "audio/voice/jack-bennett-4b4b13be3859.mp3", chapters: [1] },
    { lineId: "sarah-bennett-65056aba0745", character: "sarah-bennett", characterName: "Sarah Bennett", text: "By itself?", url: "audio/voice/sarah-bennett-65056aba0745.mp3", chapters: [1] },
    { lineId: "jack-bennett-d97b90a6d54e", character: "jack-bennett", characterName: "Jack Bennett", text: "Yep.", url: "audio/voice/jack-bennett-d97b90a6d54e.mp3", chapters: [1] },
    { lineId: "sarah-bennett-a1dc5fafa6a9", character: "sarah-bennett", characterName: "Sarah Bennett", text: "You locked the terminal?", url: "audio/voice/sarah-bennett-a1dc5fafa6a9.mp3", chapters: [1] },
    { lineId: "sarah-bennett-1ebe0c684d41", character: "sarah-bennett", characterName: "Sarah Bennett", text: "And?", url: "audio/voice/sarah-bennett-1ebe0c684d41.mp3", chapters: [1] },
    { lineId: "jack-bennett-92ce22fee124", character: "jack-bennett", characterName: "Jack Bennett", text: "It unlocked itself.", url: "audio/voice/jack-bennett-92ce22fee124.mp3", chapters: [1] },
    { lineId: "jack-bennett-9cc3304964a3", character: "jack-bennett", characterName: "Jack Bennett", text: "I know.", url: "audio/voice/jack-bennett-9cc3304964a3.mp3", chapters: [1, 2] },
    { lineId: "sarah-bennett-dc74b2a7f99a", character: "sarah-bennett", characterName: "Sarah Bennett", text: "Move.", url: "audio/voice/sarah-bennett-dc74b2a7f99a.mp3", chapters: [1] },
    { lineId: "jack-bennett-01f2a89496de", character: "jack-bennett", characterName: "Jack Bennett", text: "I'm sitting here.", url: "audio/voice/jack-bennett-01f2a89496de.mp3", chapters: [1] },
    { lineId: "sarah-bennett-a7934bd42c67", character: "sarah-bennett", characterName: "Sarah Bennett", text: "Then move your chair.", url: "audio/voice/sarah-bennett-a7934bd42c67.mp3", chapters: [1] },
    { lineId: "jack-bennett-6d611e695fd8", character: "jack-bennett", characterName: "Jack Bennett", text: "Oh.", url: "audio/voice/jack-bennett-6d611e695fd8.mp3", chapters: [1] },
    { lineId: "sarah-bennett-ad67f921e02e", character: "sarah-bennett", characterName: "Sarah Bennett", text: "You said the connection disappeared?", url: "audio/voice/sarah-bennett-ad67f921e02e.mp3", chapters: [1] },
    { lineId: "jack-bennett-f3736d27f9d7", character: "jack-bennett", characterName: "Jack Bennett", text: "Almost immediately.", url: "audio/voice/jack-bennett-f3736d27f9d7.mp3", chapters: [1] },
    { lineId: "sarah-bennett-563ad9289e68", character: "sarah-bennett", characterName: "Sarah Bennett", text: "External?", url: "audio/voice/sarah-bennett-563ad9289e68.mp3", chapters: [1] },
    { lineId: "jack-bennett-211b122503c9", character: "jack-bennett", characterName: "Jack Bennett", text: "I couldn't tell.", url: "audio/voice/jack-bennett-211b122503c9.mp3", chapters: [1] },
    { lineId: "sarah-bennett-6fe63af821c3", character: "sarah-bennett", characterName: "Sarah Bennett", text: "That's reassuring.", url: "audio/voice/sarah-bennett-6fe63af821c3.mp3", chapters: [1] },
    { lineId: "jack-bennett-2a98eedf112f", character: "jack-bennett", characterName: "Jack Bennett", text: "I thought so.", url: "audio/voice/jack-bennett-2a98eedf112f.mp3", chapters: [1] },
    { lineId: "sarah-bennett-5965a9732934", character: "sarah-bennett", characterName: "Sarah Bennett", text: "These are clean,", url: "audio/voice/sarah-bennett-5965a9732934.mp3", chapters: [1] },
    { lineId: "jack-bennett-e42d2e1230ff", character: "jack-bennett", characterName: "Jack Bennett", text: "Exactly.", url: "audio/voice/jack-bennett-e42d2e1230ff.mp3", chapters: [1] },
    { lineId: "sarah-bennett-7cb92747650b", character: "sarah-bennett", characterName: "Sarah Bennett", text: "Too clean.", url: "audio/voice/sarah-bennett-7cb92747650b.mp3", chapters: [1] },
    { lineId: "jack-bennett-6de493fd3169", character: "jack-bennett", characterName: "Jack Bennett", text: "That's what I was thinking.", url: "audio/voice/jack-bennett-6de493fd3169.mp3", chapters: [1] },
    { lineId: "sarah-bennett-deff6b10a48b", character: "sarah-bennett", characterName: "Sarah Bennett", text: "No, you were sleeping.", url: "audio/voice/sarah-bennett-deff6b10a48b.mp3", chapters: [1] },
    { lineId: "jack-bennett-29c879a5b799", character: "jack-bennett", characterName: "Jack Bennett", text: "I was thinking eventually.", url: "audio/voice/jack-bennett-29c879a5b799.mp3", chapters: [1] },
    { lineId: "jack-bennett-e61a5b7e36cd", character: "jack-bennett", characterName: "Jack Bennett", text: "You know, you're supposed to be resting.", url: "audio/voice/jack-bennett-e61a5b7e36cd.mp3", chapters: [1] },
    { lineId: "sarah-bennett-e9ec137bc087", character: "sarah-bennett", characterName: "Sarah Bennett", text: "So are you.", url: "audio/voice/sarah-bennett-e9ec137bc087.mp3", chapters: [1] },
    { lineId: "jack-bennett-c1ff018af109", character: "jack-bennett", characterName: "Jack Bennett", text: "I'm not the pregnant one.", url: "audio/voice/jack-bennett-c1ff018af109.mp3", chapters: [1] },
    { lineId: "sarah-bennett-4db8c4b299cf", character: "sarah-bennett", characterName: "Sarah Bennett", text: "No. You're the one I found asleep at a laboratory terminal.", url: "audio/voice/sarah-bennett-4db8c4b299cf.mp3", chapters: [1] },
    { lineId: "jack-bennett-48aebe4e6970", character: "jack-bennett", characterName: "Jack Bennett", text: "That's different.", url: "audio/voice/jack-bennett-48aebe4e6970.mp3", chapters: [1] },
    { lineId: "sarah-bennett-0e24152e8551", character: "sarah-bennett", characterName: "Sarah Bennett", text: "How?", url: "audio/voice/sarah-bennett-0e24152e8551.mp3", chapters: [1] },
    { lineId: "jack-bennett-753cad07ca15", character: "jack-bennett", characterName: "Jack Bennett", text: "I wasn't uncomfortable?", url: "audio/voice/jack-bennett-753cad07ca15.mp3", chapters: [1] },
    { lineId: "jack-bennett-941e93bf213e", character: "jack-bennett", characterName: "Jack Bennett", text: "Fair.", url: "audio/voice/jack-bennett-941e93bf213e.mp3", chapters: [1] },
    { lineId: "sarah-bennett-dc90fc8720b4", character: "sarah-bennett", characterName: "Sarah Bennett", text: "Lately the baby seems to think eleven at night is morning.", url: "audio/voice/sarah-bennett-dc90fc8720b4.mp3", chapters: [1] },
    { lineId: "jack-bennett-a8fc65386727", character: "jack-bennett", characterName: "Jack Bennett", text: "Already takes after me.", url: "audio/voice/jack-bennett-a8fc65386727.mp3", chapters: [1] },
    { lineId: "sarah-bennett-b4465ab7292c", character: "sarah-bennett", characterName: "Sarah Bennett", text: "That's what I'm afraid of.", url: "audio/voice/sarah-bennett-b4465ab7292c.mp3", chapters: [1] },
    { lineId: "system-f6a28699a3b1", character: "system", characterName: "TOMBS / settlement systems", text: "Tombs array remote initialization request.", url: "audio/voice/system-f6a28699a3b1.mp3", chapters: [1] },
    { lineId: "sarah-bennett-415320486988", character: "sarah-bennett", characterName: "Sarah Bennett", text: "Did you do that?", url: "audio/voice/sarah-bennett-415320486988.mp3", chapters: [1] },
    { lineId: "jack-bennett-a40ffc6ce592", character: "jack-bennett", characterName: "Jack Bennett", text: "No.", url: "audio/voice/jack-bennett-a40ffc6ce592.mp3", chapters: [1, 2, 3] },
    { lineId: "sarah-bennett-13bbe7381eb1", character: "sarah-bennett", characterName: "Sarah Bennett", text: "Cancel it.", url: "audio/voice/sarah-bennett-13bbe7381eb1.mp3", chapters: [1] },
    { lineId: "system-0fe0cf2a5742", character: "system", characterName: "TOMBS / settlement systems", text: "Request denied.", url: "audio/voice/system-0fe0cf2a5742.mp3", chapters: [1] },
    { lineId: "jack-bennett-5d311a6c90d7", character: "jack-bennett", characterName: "Jack Bennett", text: "That's not supposed to happen.", url: "audio/voice/jack-bennett-5d311a6c90d7.mp3", chapters: [1] },
    { lineId: "system-28a18477a67e", character: "system", characterName: "TOMBS / settlement systems", text: "Access revoked.", url: "audio/voice/system-28a18477a67e.mp3", chapters: [1] },
    { lineId: "sarah-bennett-85c20ef1167a", character: "sarah-bennett", characterName: "Sarah Bennett", text: "Your credentials?", url: "audio/voice/sarah-bennett-85c20ef1167a.mp3", chapters: [1] },
    { lineId: "jack-bennett-308767fde297", character: "jack-bennett", characterName: "Jack Bennett", text: "Revoked.", url: "audio/voice/jack-bennett-308767fde297.mp3", chapters: [1] },
    { lineId: "sarah-bennett-d5bc7656345e", character: "sarah-bennett", characterName: "Sarah Bennett", text: "You're the project administrator.", url: "audio/voice/sarah-bennett-d5bc7656345e.mp3", chapters: [1] },
    { lineId: "sarah-bennett-ed9388bef578", character: "sarah-bennett", characterName: "Sarah Bennett", text: "Who can revoke you?", url: "audio/voice/sarah-bennett-ed9388bef578.mp3", chapters: [1] },
    { lineId: "jack-bennett-77753d8b9f45", character: "jack-bennett", characterName: "Jack Bennett", text: "Me.", url: "audio/voice/jack-bennett-77753d8b9f45.mp3", chapters: [1] },
    { lineId: "jack-bennett-13662115397f", character: "jack-bennett", characterName: "Jack Bennett", text: "I didn't.", url: "audio/voice/jack-bennett-13662115397f.mp3", chapters: [1] },
  ],
  sounds: [
    { assetId: "amb_computer_lab", bus: "ambience", category: "ambience", loop: true, seconds: 45.1, gain: 0.1, url: "audio/sfx/amb_computer_lab.mp3", chapters: [1, 2, 3] },
    { assetId: "amb_console_alarm_bed", bus: "ambience", category: "alarm", loop: true, seconds: 12, gain: 0.5, url: "audio/sfx/amb_console_alarm_bed.mp3", chapters: [1, 2, 3] },
    { assetId: "amb_intercom_channel_open", bus: "ambience", category: "ambience", loop: true, seconds: 10, gain: 0.1, url: "audio/sfx/amb_intercom_channel_open.mp3", chapters: [1, 2, 3] },
    { assetId: "amb_tombs_array_power_rise", bus: "ambience", category: "system", loop: true, seconds: 20, gain: 0.45, url: "audio/sfx/amb_tombs_array_power_rise.mp3", chapters: [1] },
    { assetId: "sfx_access_denied_tone", bus: "sfx", category: "system", loop: false, seconds: 1.5, gain: 0.45, url: "audio/sfx/sfx_access_denied_tone.mp3", chapters: [1] },
    { assetId: "sfx_access_revoked_tone", bus: "sfx", category: "system", loop: false, seconds: 2, gain: 0.45, url: "audio/sfx/sfx_access_revoked_tone.mp3", chapters: [1] },
    { assetId: "sfx_alert_warning_hit", bus: "sfx", category: "alarm", loop: false, seconds: 1.5, gain: 0.5, url: "audio/sfx/sfx_alert_warning_hit.mp3", chapters: [1, 2, 3] },
    { assetId: "sfx_chair_roll_fast", bus: "sfx", category: "foley", loop: false, seconds: 2, gain: 0.45, url: "audio/sfx/sfx_chair_roll_fast.mp3", chapters: [1, 2] },
    { assetId: "sfx_chair_roll_slow", bus: "sfx", category: "foley", loop: false, seconds: 2.5, gain: 0.45, url: "audio/sfx/sfx_chair_roll_slow.mp3", chapters: [1] },
    { assetId: "sfx_console_alarm_erupt", bus: "sfx", category: "alarm", loop: false, seconds: 3, gain: 0.5, url: "audio/sfx/sfx_console_alarm_erupt.mp3", chapters: [1] },
    { assetId: "sfx_console_tone_soft", bus: "sfx", category: "interface", loop: false, seconds: 1.5, gain: 0.4, url: "audio/sfx/sfx_console_tone_soft.mp3", chapters: [1] },
    { assetId: "sfx_equipment_power_up_soft", bus: "sfx", category: "system", loop: false, seconds: 2.5, gain: 0.45, url: "audio/sfx/sfx_equipment_power_up_soft.mp3", chapters: [1, 2] },
    { assetId: "sfx_footsteps_sarah_sneakers", bus: "sfx", category: "foley", loop: false, seconds: 3, gain: 0.45, url: "audio/sfx/sfx_footsteps_sarah_sneakers.mp3", chapters: [1, 2] },
    { assetId: "sfx_intercom_close", bus: "sfx", category: "interface", loop: false, seconds: 1, gain: 0.4, url: "audio/sfx/sfx_intercom_close.mp3", chapters: [1] },
    { assetId: "sfx_intercom_open", bus: "sfx", category: "interface", loop: false, seconds: 1.5, gain: 0.4, url: "audio/sfx/sfx_intercom_open.mp3", chapters: [1, 2] },
    { assetId: "sfx_intercom_static", bus: "sfx", category: "interface", loop: false, seconds: 2.5, gain: 0.4, url: "audio/sfx/sfx_intercom_static.mp3", chapters: [1] },
    { assetId: "sfx_keyboard_typing_short", bus: "sfx", category: "foley", loop: false, seconds: 3, gain: 0.45, url: "audio/sfx/sfx_keyboard_typing_short.mp3", chapters: [1, 2, 3] },
    { assetId: "sfx_lab_door_slide", bus: "sfx", category: "foley", loop: false, seconds: 2.5, gain: 0.45, url: "audio/sfx/sfx_lab_door_slide.mp3", chapters: [1, 2] },
    { assetId: "sfx_system_notify_soft", bus: "sfx", category: "interface", loop: false, seconds: 1.5, gain: 0.4, url: "audio/sfx/sfx_system_notify_soft.mp3", chapters: [1, 2, 3] },
    { assetId: "sfx_terminal_lock_engage", bus: "sfx", category: "interface", loop: false, seconds: 2, gain: 0.4, url: "audio/sfx/sfx_terminal_lock_engage.mp3", chapters: [1] },
  ],
  busCounts: { voice: 88, sfx: 16, ambience: 4, music: 0 },
  bytes: 4050891,
};
