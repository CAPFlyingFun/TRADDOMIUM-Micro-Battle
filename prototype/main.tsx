import { createRoot } from 'react-dom/client';
import GameApp from './app/game/GameApp';
import './app/globals.css';

createRoot(document.getElementById('root')!).render(<GameApp />);