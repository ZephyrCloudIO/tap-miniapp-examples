import '@theaiplatform/miniapp-sdk/ui/styles.css';
import { createDiagnosticRoot } from './diagnostic-root';
import { createEmailDiagnostics } from './diagnostics';
import { TapEmailApp } from './app';
import './styles.css';

const diagnostics = createEmailDiagnostics();
createDiagnosticRoot(document.getElementById('root')!, diagnostics)
  .render(<TapEmailApp preview diagnostics={diagnostics} />);
