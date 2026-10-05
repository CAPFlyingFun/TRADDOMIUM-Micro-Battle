import { story } from '../data/story';
import { dialogue } from '../data/dialogue';
import chapterOne from '../data/chapter1-audio.json';
export interface Settings { sound: boolean; volume: number; voices: boolean; autoAdvance: boolean; effectsVolume: number; reducedMotion: boolean; softEffects: boolean; largeText: boolean; }
export interface SaveState { version: 1; sceneId: string; queue: string; line: number; done: string[]; camera: string; completed: boolean; updatedAt: string; chapterOneRevision?:string; }
export const defaults: Settings = { sound: true, volume: 0.45, voices: true, autoAdvance: true, effectsVolume: 1, reducedMotion: false, softEffects: false, largeText: false };
const SAVE_KEY = 'tmb.chapter-prototype.save.v1';
const SETTINGS_KEY = 'tmb.chapter-prototype.settings.v1';
export function freshSave(sceneId = story[0].id): SaveState {
  const scene = story.find(s => s.id === sceneId) || story[0];
  return {version:1,sceneId:scene.id,queue:scene.dialogue,line:0,done:[],camera:'north',completed:false,updatedAt:new Date().toISOString(),chapterOneRevision:chapterOne.source.revision};
}
export function readSave(): SaveState | null {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    const scene = story.find(x => x.id === s?.sceneId);
    if (!scene || s?.version !== 1 || !Array.isArray(s.done) || !Number.isInteger(s.line)) return null;
    if(scene.chapter===1&&s.chapterOneRevision!==chapterOne.source.revision)return freshSave(scene.id);
    const allowed = [scene.dialogue, ...scene.actions.map(a => a.dialogue)];
    if (!allowed.includes(s.queue) || s.line < 0 || s.line > dialogue[s.queue].length) return null;
    return { ...freshSave(scene.id), ...s, done:s.done.filter((id: unknown)=>typeof id==='string' && scene.actions.some(a=>a.id===id)), camera:['north','west','tree','zoom','water'].includes(s.camera)?s.camera:'north', completed: s.completed === true };
  } catch { return null; }
}
export function readSettings(): Settings {
  const fallback = { ...defaults, reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches };
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return {sound:typeof s.sound==='boolean'?s.sound:fallback.sound,volume:typeof s.volume==='number'&&Number.isFinite(s.volume)?Math.max(0,Math.min(1,s.volume)):fallback.volume,voices:typeof s.voices==='boolean'?s.voices:fallback.voices,autoAdvance:typeof s.autoAdvance==='boolean'?s.autoAdvance:fallback.autoAdvance,effectsVolume:typeof s.effectsVolume==='number'&&Number.isFinite(s.effectsVolume)?Math.max(0,Math.min(1,s.effectsVolume)):fallback.effectsVolume,reducedMotion:typeof s.reducedMotion==='boolean'?s.reducedMotion:fallback.reducedMotion,softEffects:typeof s.softEffects==='boolean'?s.softEffects:fallback.softEffects,largeText:typeof s.largeText==='boolean'?s.largeText:fallback.largeText};
  } catch { return fallback; }
}
export function persistSave(s: SaveState) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); return true; } catch { return false; } }
export function persistSettings(s: Settings) { try { localStorage.setItem(SETTINGS_KEY,JSON.stringify(s)); return true; } catch { return false; } }
