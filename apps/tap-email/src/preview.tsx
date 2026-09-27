import '@theaiplatform/miniapp-sdk/ui/styles.css';
import { createRoot } from 'react-dom/client';
import { TapEmailApp } from './app';
import './styles.css';

const appTheme = new URLSearchParams(window.location.search).get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.classList.toggle('dark', appTheme === 'dark');
document.documentElement.dataset.appTheme = appTheme;
createRoot(document.getElementById('root')!).render(<TapEmailApp appTheme={appTheme} preview />);
