import '@theaiplatform/miniapp-sdk/ui/styles.css';
import { createRoot } from 'react-dom/client';
import { TapEmailApp } from './app';
import './styles.css';

createRoot(document.getElementById('root')!).render(<TapEmailApp preview />);
