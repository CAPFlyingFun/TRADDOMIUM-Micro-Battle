import { assetUrl } from '../../../lib/asset-url';
import models from './models.json';
export const characters = {
  jack: { name: 'Jack Bennett', role: 'TOMBS · Project administrator', portrait: assetUrl('/assets/jack-reference.png'), color: '#92c8d3', model: models.jack },
  sarah: { name: 'Sarah Bennett', role: 'TOMBS · Research scientist', portrait: assetUrl('/assets/sarah-reference.png'), color: '#e3b7c4', model: models.sarah },
  lena: { name: 'Lena Ortiz', role: 'Island utility control · Voice link', portrait: null, color: '#e5c997', model: null },
  system: { name: 'TOMBS', role: 'Temporal Object Manipulation and Boundary System', portrait: null, color: '#83ddd5', model: null },
  narrator: { name: '', role: '', portrait: null, color: '#c7d4d4', model: null },
} as const;
export type Speaker = keyof typeof characters;
