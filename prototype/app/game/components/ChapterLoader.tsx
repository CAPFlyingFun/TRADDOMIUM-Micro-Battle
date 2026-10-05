import {useEffect, useState} from 'react';
import assets from '../data/startup-assets.json';
import {formatLoadingProgress, loadAssetBatch} from '../../../lib/load-assets';
import './chapter-loader.css';

export default function ChapterLoader({onReady, onBack}: {onReady: () => void; onBack: () => void}) {
  const [progress, setProgress] = useState({loaded: 0, total: assets.reduce((sum, asset) => sum + asset.bytes, 0)});
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void loadAssetBatch(assets, value => {
      if (!controller.signal.aborted) setProgress(value);
    }, controller.signal).then(() => {
      if (!controller.signal.aborted) onReady();
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Chapter download failed.');
    });
    return () => controller.abort();
  }, [attempt, onReady]);
  return <main className="chapter-loader">
    <span className="eyebrow">CHAPTER ONE</span>
    <h1>{error ? 'The download stopped.' : 'Loading the story.'}</h1>
    <p>Island, clouds, laboratory, characters and recorded audio.</p>
    <progress max={progress.total} value={Math.min(progress.loaded, progress.total)} aria-label="Chapter One asset download"/>
    <output aria-live="polite" aria-atomic="true">{formatLoadingProgress(progress)}</output>
    <small>{error || 'Downloaded assets are kept in this tab for playback.'}</small>
    {error && <button className="primary-button" onClick={() => setAttempt(value => value + 1)}>Retry download</button>}
    <button className="secondary-button" onClick={onBack}>Return to title</button>
  </main>;
}