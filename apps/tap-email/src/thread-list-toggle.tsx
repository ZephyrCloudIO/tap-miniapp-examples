import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import React from 'react';
import { IconTooltipButton } from './reader-actions';

export const THREAD_LIST_PANE_ID = 'tap-email-thread-list-pane';

interface ThreadListToggleProps {
  readonly collapsed: boolean;
  readonly onToggle: () => void;
}

export function ThreadListToggle({
  collapsed,
  onToggle,
}: ThreadListToggleProps) {
  return (
    <IconTooltipButton
      aria-controls={THREAD_LIST_PANE_ID}
      aria-expanded={!collapsed}
      className="thread-list-toggle"
      icon={collapsed ? PanelLeftOpen : PanelLeftClose}
      label={collapsed ? 'Expand email list' : 'Collapse email list'}
      onClick={onToggle}
    />
  );
}
