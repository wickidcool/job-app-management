import * as Dialog from '@radix-ui/react-dialog';
import type { RefObject } from 'react';
import { useDialogFocusRestore } from '../hooks/useDialogFocusRestore';

interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
  /**
   * Where focus should go when the trigger cannot receive it back.
   *
   * A confirm gate is frequently opened by a control that its own confirmed
   * action destroys — `ResumeManager`'s per-row `🗑️ Delete` button is the case
   * this exists for. This component deliberately does not guess where focus
   * belongs when that happens; the caller names a stable element instead, and
   * it must be one that is mounted on *both* arms of whatever the action
   * changes (see `useDialogFocusRestore`).
   *
   * Cancel-shaped exits are unaffected — the trigger survives those and is
   * always preferred. (WIC-1181)
   */
  restoreFocusTo?: RefObject<HTMLElement | null>;
}

export function ConfirmationModal({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  onConfirm,
  onCancel,
  restoreFocusTo,
}: ConfirmationModalProps) {
  // Radix's modal Content restores focus to `Dialog.Trigger` and nothing else. This
  // dialog is controlled via `isOpen` and its trigger lives in the parent, so that
  // ref is always null and focus would land on <body> instead of the button that
  // opened it. The hook captures the trigger itself, and — where the caller has
  // supplied one — watches the restore so a trigger removed by the re-render its
  // own action caused hands off to `restoreFocusTo` rather than to <body>.
  const focusRestore = useDialogFocusRestore({ fallbackRef: restoreFocusTo });

  const variantStyles = {
    danger: 'bg-red-600 hover:bg-red-700',
    warning: 'bg-yellow-600 hover:bg-yellow-700',
    info: 'bg-primary-600 hover:bg-primary-700',
  };

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black bg-opacity-50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 mx-4 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl"
          {...focusRestore}
        >
          <Dialog.Title className="mb-4 text-xl font-bold text-neutral-900">{title}</Dialog.Title>
          <Dialog.Description className="mb-6 text-sm text-neutral-600 whitespace-pre-line">
            {message}
          </Dialog.Description>
          <div className="flex justify-end gap-3">
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              >
                {cancelLabel}
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={onConfirm}
              className={`rounded-md px-4 py-2 text-sm font-medium text-white ${variantStyles[variant]}`}
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
