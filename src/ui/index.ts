/**
 * The ui module's public surface: what `app/registry.ts` registers and what
 * a world scene needs for its pause menu.
 *
 * Registration (integration writes this, in one place; ids from SCREEN_ID):
 *
 *   registerScene('menu',     createMainMenuScene(offers, play));
 *   registerScene('session',  createSessionPickerScene(offers, play));
 *   registerScene('settings', createSettingsScene);
 *   registerScene('about',    createAboutScene);
 *   registerScene('loading',  createLoadingScene(loadingHooks));
 *   registerScene('profile',  createProfileScene(profileSource));
 *
 * where `offers`, `play`, `loadingHooks` and `profileSource` are `Wire<T>`
 * functions that construct the session / slot / world / profile objects the
 * ui may not import itself (see screen.ts for the convention).
 */
export { AboutScene, createAboutScene, ABOUT_PARAGRAPH, type AboutHooks } from './AboutScene';
export { BUILD_INFO, buildStamp, type BuildInfo } from './buildInfo';
export {
  LoadingScene, createLoadingScene, formatEta, CONTINUE_ACTION, type LoadingHooks, type ProgressReader,
} from './LoadingScene';
export {
  MainMenuScene, createMainMenuScene, GAME_TITLE, MENU_RESUME_ACTION, type MainMenuHooks, type SoloPlay,
} from './MainMenuScene';
export { PlayFlow, type PlayFlowHooks } from './PlayFlow';
export {
  SlotPicker, slotAction, SLOT_KEEP_ACTION, SLOT_OVERWRITE_ACTION,
  type SlotPickerHooks, type SlotPurpose, type SlotView,
} from './SlotPicker';
export { timeAgo } from './timeAgo';
export {
  SCREEN_ID, destination, goToScreen, quitToMenu, startSession, type Destination, type ScreenId,
} from './navigation';
export { PauseOverlay, pauseWords, type PauseHooks } from './PauseOverlay';
export {
  ProfileScene, createProfileScene, shortDeviceId, PROFILE_NAME_ACTION, PROFILE_SAVE_ACTION,
  type ProfileHooks, type ProfileSource, type ProfileView,
} from './ProfileScene';
export { Screen, type Wire, type ScreenTone } from './screen';
// The document-painted boot splash: main.ts reports measured boot facts into it and takes it down.
export { BOOT_ID, dismissBootSplash, reportBoot } from './splash/BootSplash';
export { SessionPicker, type SavedGame, type SessionOffers, type SessionPickerHooks } from './SessionPicker';
export { SessionPickerScene, createSessionPickerScene } from './SessionPickerScene';
export { SettingsPanel, settingAction, SETTING_RESET_ACTION, type SettingsPanelHooks } from './SettingsPanel';
export { SettingsScene, createSettingsScene, type SettingsHooks } from './SettingsScene';
export {
  SETTINGS_DEFAULTS, SETTINGS_KEY, SETTINGS_LIMITS, SETTINGS_SPEC, SETTINGS_VERSION, QUALITY_LEVELS,
  isQuality, openSettings, sanitizeSettings, type Quality, type Settings,
} from './settingsStore';
