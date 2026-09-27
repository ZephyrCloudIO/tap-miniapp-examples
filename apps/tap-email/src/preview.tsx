import '@theaiplatform/miniapp-sdk/ui/styles.css';
import { createDiagnosticRoot } from './diagnostic-root';
import { createEmailDiagnostics } from './diagnostics';
import { TapEmailApp } from './app';
import './styles.css';

const appTheme = new URLSearchParams(window.location.search).get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.classList.toggle('dark', appTheme === 'dark');
document.documentElement.dataset.appTheme = appTheme;
const diagnostics = createEmailDiagnostics();
createDiagnosticRoot(document.getElementById('root')!, diagnostics)
  .render(<TapEmailApp appTheme={appTheme} preview diagnostics={diagnostics} />);
