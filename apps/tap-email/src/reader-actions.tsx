import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@theaiplatform/miniapp-sdk/ui';
import {
  Check,
  Clock3,
  ListTodo,
  MessageSquareShare,
  Reply as ReplyIcon,
  Sparkles,
  Star,
  type LucideIcon,
} from 'lucide-react';
import React, {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
} from 'react';
import {
  CHLOE_EMAIL_ACTIONS,
  type ChloeEmailIntent,
} from './chloe-email';

export type ReaderAction =
  | 'done'
  | 'remind'
  | 'reply'
  | 'bring-to-conversation'
  | 'toggle-star';

export interface ReaderActionsProps {
  readonly conversationBusy: boolean;
  readonly conversationFinished: boolean;
  readonly conversationStatusId?: string;
  readonly onAskChloe: (intent: ChloeEmailIntent) => void;
  readonly onAction: (action: ReaderAction) => void;
  readonly onCreateTask: () => void;
  readonly starred: boolean;
  readonly taskBusy: boolean;
  readonly taskFinished: boolean;
  readonly taskStatusId?: string;
}

interface IconTooltipButtonProps extends Omit<
  ComponentProps<'button'>,
  'aria-keyshortcuts' | 'aria-label' | 'children'
> {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly shortcut?: string;
}

export function IconTooltipButton({
  className,
  icon: Icon,
  label,
  shortcut,
  type = 'button',
  ...buttonProps
}: IconTooltipButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          {...buttonProps}
          aria-keyshortcuts={shortcut}
          aria-label={label}
          className={`tooltip-icon-button${className ? ` ${className}` : ''}`}
          type={type}
        >
          <Icon aria-hidden="true" focusable="false" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        className="reader-action-tooltip"
        side="bottom"
        sideOffset={7}
      >
        <span>{label}</span>
        {shortcut ? <kbd aria-hidden="true">{shortcut}</kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
}

function ChloeActions({
  onAskChloe,
}: {
  readonly onAskChloe: (intent: ChloeEmailIntent) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  const focusMenuItem = (index: number) => {
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    if (!items?.length) return;
    items[(index + items.length) % items.length]?.focus();
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    setOpen(true);
    window.setTimeout(() => focusMenuItem(0), 0);
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []];
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusMenuItem(currentIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusMenuItem(currentIndex - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusMenuItem(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusMenuItem(items.length - 1);
    }
  };

  return (
    <div className="chloe-actions" ref={rootRef}>
      <IconTooltipButton
        aria-expanded={open}
        aria-haspopup="menu"
        icon={Sparkles}
        label="Ask Chloe"
        onClick={() => setOpen(value => !value)}
        onKeyDown={handleTriggerKeyDown}
        ref={triggerRef}
        shortcut="⌘Enter"
      />
      {open ? (
        <div
          aria-label="Ask Chloe about this email"
          className="chloe-action-menu"
          onKeyDown={handleMenuKeyDown}
          ref={menuRef}
          role="menu"
        >
          <div className="chloe-action-menu-heading">
            <Sparkles aria-hidden="true" />
            <span><strong>Ask Chloe</strong><small>Stages an editable prompt in Chat</small></span>
          </div>
          {CHLOE_EMAIL_ACTIONS.map(action => (
            <button
              key={action.intent}
              onClick={() => {
                setOpen(false);
                onAskChloe(action.intent);
              }}
              role="menuitem"
              type="button"
            >
              <span>{action.label}</span>
              <small>{action.description}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ReaderActions({
  conversationBusy,
  conversationFinished,
  conversationStatusId,
  onAskChloe,
  onAction,
  starred,
  taskBusy,
  taskFinished,
  taskStatusId,
  onCreateTask,
}: ReaderActionsProps) {
  const conversationLabel = conversationBusy
    ? 'Preparing TAP handoff…'
    : conversationFinished
      ? 'Discussed in TAP'
      : 'Discuss in TAP';
  const taskLabel = taskBusy
    ? 'Creating task…'
    : taskFinished
      ? 'Task created'
      : 'Create task';

  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={75}>
      <div className="message-actions" aria-label="Email actions" role="toolbar">
        <IconTooltipButton
          icon={Check}
          label="Done"
          onClick={() => onAction('done')}
          shortcut="E"
        />
        <IconTooltipButton
          icon={Clock3}
          label="Remind me"
          onClick={() => onAction('remind')}
          shortcut="H"
        />
        <IconTooltipButton
          icon={ReplyIcon}
          label="Reply"
          onClick={() => onAction('reply')}
          shortcut="R"
        />
        <ChloeActions onAskChloe={onAskChloe} />
        <IconTooltipButton
          aria-busy={taskBusy}
          aria-describedby={taskStatusId}
          disabled={taskBusy || taskFinished}
          icon={ListTodo}
          label={taskLabel}
          onClick={onCreateTask}
        />
        <IconTooltipButton
          aria-busy={conversationBusy}
          aria-describedby={conversationStatusId}
          disabled={conversationBusy}
          icon={MessageSquareShare}
          label={conversationLabel}
          onClick={() => onAction('bring-to-conversation')}
          shortcut="B"
        />
        <IconTooltipButton
          aria-pressed={starred}
          className={starred ? 'is-starred' : undefined}
          icon={Star}
          label={starred ? 'Unstar thread' : 'Star thread'}
          onClick={() => onAction('toggle-star')}
          shortcut="S"
        />
      </div>
    </TooltipProvider>
  );
}
