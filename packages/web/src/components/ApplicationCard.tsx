import { formatDistanceToNow, differenceInDays, parseISO, startOfDay } from 'date-fns';
import type { Application, ApplicationStatus } from '../types/application';
import { useState, useMemo } from 'react';
import { isStale as isApplicationStale } from '../constants/stale';

const TERMINAL_STATUSES = ['offer', 'rejected', 'withdrawn'];

function getUrgencyIndicators(application: Application): {
  isOverdue: boolean;
  isDueSoon: boolean;
  isStale: boolean;
} {
  const isTerminal = TERMINAL_STATUSES.includes(application.status);
  const today = startOfDay(new Date());
  let isOverdue = false;
  let isDueSoon = false;

  if (!isTerminal && application.nextActionDue) {
    const dueDate = startOfDay(parseISO(application.nextActionDue));
    const daysUntilDue = differenceInDays(dueDate, today);
    isOverdue = daysUntilDue < 0;
    isDueSoon = !isOverdue && daysUntilDue <= 3;
  }

  // WIC-1479: this badge used to fire on any non-terminal row untouched for 14
  // days, so an `interview` row at 20 days was badged "Stale" here and absent
  // from `/reports/stale`. No terminal check is needed now — the shared
  // definition excludes the terminal statuses, and `saved` and `interview` too.
  return { isOverdue, isDueSoon, isStale: isApplicationStale(application) };
}

/**
 * WIC-2078 removed this component's native HTML5 drag — the `draggable` prop, `onDragStart`,
 * `onDragEnd` and the `isDragging` state they drove.
 *
 * It was write-only. `handleDragStart` called
 * `e.dataTransfer.setData('application/json', …)` and NOTHING in the tree ever read it back:
 * `dataTransfer.getData` appears zero times in `packages/web/src`, and the only other
 * `dataTransfer` reads are `.files` in the two resume drop zones, which take OS file drops
 * and have nothing to do with applications. The kanban columns are dnd-kit `useDroppable`
 * targets, not native drop targets, so a native drop had no handler to land in.
 *
 * The real drag is dnd-kit's, one level up on `SortableApplicationCard` — `PointerSensor`
 * for the mouse and `KeyboardSensor` for the keyboard, both wired in `KanbanBoard`. The
 * `opacity-50` styling the removed `isDragging` state applied is also already provided
 * there, by `useSortable`'s own `isDragging` on the wrapper, so nothing visual is lost.
 *
 * Stated as what was measured, not more: this deletes dead code that was also competing
 * with dnd-kit's pointer handling. Whether it repairs any pointer-drag misbehaviour on
 * desktop was NOT measured here and is not claimed.
 */
export interface ApplicationCardProps {
  application: Application;
  variant?: 'kanban' | 'list';
  showQuickActions?: boolean;
  onCardClick?: (id: string) => void;
  onStatusChange?: (id: string, newStatus: ApplicationStatus) => void;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
}

export function ApplicationCard({
  application,
  variant = 'kanban',
  showQuickActions = true,
  onCardClick,
  onEdit,
  onDelete,
}: ApplicationCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  /**
   * WIC-2078: the quick-action bar used to be gated on `isHovered` alone, so its Edit and
   * Delete buttons did not exist in the DOM unless a mouse was over the card — WCAG 2.1.1,
   * and the only path to either action on the kanban board.
   *
   * Revealing on focus as well is what makes them reachable: the card itself is a tab stop
   * (`tabIndex={0}` below), so focusing it renders the bar, and the next Tab lands on Edit.
   * React's `onFocus`/`onBlur` are `focusin`/`focusout` underneath and therefore bubble, so
   * one pair on the wrapper covers focus arriving anywhere inside it.
   *
   * The `relatedTarget` check is what stops the bar collapsing out from under the keyboard
   * user at the moment they Tab INTO it: focus moving card -> Edit fires `blur` on the card,
   * and without the containment test that would unmount the button receiving the focus.
   *
   * Deliberately still conditional rendering rather than a CSS-only `group-focus-within`
   * reveal, for two reasons. It keeps the buttons out of the DOM at rest, which is what
   * keeps `routeAxe.render.test.tsx` clean — a real `<button>` inside this card is nested
   * inside dnd-kit's `div[role="button"]` wrapper on `SortableApplicationCard` and trips
   * axe's `nested-interactive` (the finding that reverted WIC-2077's slice-2 attempt on this
   * file). And it keeps the fix OBSERVABLE: jsdom applies no Tailwind, so a CSS-only reveal
   * would leave the buttons queryable whether or not the fix were present, and the test
   * pinning it would pass just as happily against the unfixed component.
   */
  const [isFocusWithin, setIsFocusWithin] = useState(false);

  const { isOverdue, isDueSoon, isStale } = useMemo(
    () => getUrgencyIndicators(application),
    [application]
  );

  const handleClick = () => {
    onCardClick?.(application.id);
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit?.(application.id);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this application?')) {
      onDelete?.(application.id);
    }
  };

  const handleFocus = () => {
    setIsFocusWithin(true);
  };

  const handleBlur = (e: React.FocusEvent) => {
    // Only collapse when focus has actually left the card, not when it moves between the
    // card and one of its own quick-action buttons. `relatedTarget` is null when focus goes
    // to nothing (e.g. a click on the page background), which correctly collapses.
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsFocusWithin(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Only the CARD's own Enter/Space activates the card. `keydown` bubbles, so without this
    // guard the handler also fires for every control inside the card — and because it calls
    // `preventDefault()`, it CANCELS that control's activation: pressing Enter on the Edit
    // button navigated to the application instead of editing it, and Space did nothing at all.
    //
    // Latent until WIC-2078. The quick actions were mouse-only, so no keyboard event could
    // originate below this element and the bug had nowhere to show itself; making the buttons
    // reachable is what exposed it. Caught by `ApplicationCard.keyboardNav.test.tsx`, which is
    // why that suite asserts the handlers FIRE rather than only that focus arrives.
    if (e.target !== e.currentTarget) return;

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  const relativeTime = formatDistanceToNow(application.createdAt, { addSuffix: true });

  const isActive = isHovered || isFocusWithin;
  const showActionsBar = showQuickActions && isActive;

  const cardClasses = `
    relative rounded-lg border p-4 transition-all cursor-pointer shadow-sm
    ${isActive ? 'border-blue-300 shadow-md' : 'border-gray-200'}
    ${variant === 'list' ? 'flex items-center gap-4' : 'flex flex-col gap-2'}
    ${showActionsBar ? 'pb-16' : ''}
    hover:border-blue-300 hover:shadow-md
    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
  `;

  const ariaLabel = `${application.jobTitle} at ${application.company}, status: ${application.status}`;

  return (
    // WIC-2078, reviewed exception (site 1 of 3). The card is deliberately an `<article>`
    // carrying its own activation rather than a real `<button>`, and that is a decision
    // WIC-2077 reached by measurement and then had to reverse itself on: moving activation
    // onto a `<button>` inside the `<h3>` — the ResumeVariantCard / Reports* precedent,
    // correct at five previous sites — reds `routeAxe.render.test.tsx` with
    // `nested-interactive`, because `SortableApplicationCard` wraps every card in a dnd-kit
    // `div[role="button"][tabindex="0"]`. Adding `role="button"` here instead trips the same
    // axe rule (WIC-1942). Both spellings the lint rule would accept are a WORSE defect than
    // the one it is reporting, so the element keeps `tabIndex={0}` + `onKeyDown` (Enter and
    // Space, handled below) + `aria-label`, which is the accessible-enough state.
    //
    // The rule fires on the presence of ANY of these handlers, one finding per element —
    // measured, not assumed: on a bare `<article>`, `onClick` alone and `onKeyDown` alone
    // each trip it independently. So this site could not have reached zero by deleting the
    // drag and hover handlers below; only the directive retires it.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <article
      className={cardClasses}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      aria-label={ariaLabel}
    >
      {/* Company Icon Placeholder */}
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0">
          <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center text-xl">
            💼
          </div>
        </div>

        <div className="flex-1 min-w-0">
          {/* Job Title */}
          <h3 className="text-lg font-semibold truncate text-gray-900">{application.jobTitle}</h3>

          {/* Company Name */}
          <p className="text-sm text-gray-600 truncate">{application.company}</p>

          {/* Location and Salary */}
          {(application.location || application.salaryRange) && (
            <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
              {application.location && <span>{application.location}</span>}
              {application.location && application.salaryRange && <span>|</span>}
              {application.salaryRange && <span>{application.salaryRange}</span>}
            </div>
          )}

          {/* Document Count */}
          {application.hasDocuments && (
            <div className="mt-2 text-xs text-gray-500">
              <span>📎 Has documents</span>
            </div>
          )}

          {/* Urgency Indicators */}
          {(isOverdue || isDueSoon || isStale) && (
            <div className="mt-2 flex flex-wrap gap-1">
              {isOverdue && (
                <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                  Overdue
                </span>
              )}
              {isDueSoon && (
                <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
                  Due soon
                </span>
              )}
              {isStale && (
                <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
                  Stale
                </span>
              )}
            </div>
          )}

          {/* Next Action */}
          {application.nextAction && (
            <p className="mt-1 text-xs text-gray-600 truncate">
              <span className="font-medium">Next:</span> {application.nextAction}
            </p>
          )}

          {/* Relative Time */}
          <div className="mt-2 text-xs text-gray-400 text-right">{relativeTime}</div>
        </div>
      </div>

      {/* Quick Actions (shown on hover OR keyboard focus, WIC-2078) - Touch-optimized */}
      {showActionsBar && (
        <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-200 rounded-b-lg p-2 flex items-center justify-between gap-2">
          <button
            onClick={handleEdit}
            onPointerDown={(e) => e.stopPropagation()}
            className="px-4 py-3 text-sm text-blue-600 hover:bg-blue-50 rounded transition-colors"
            style={{ minHeight: '44px', minWidth: '44px' }}
            aria-label={`Edit ${application.jobTitle}`}
          >
            Edit
          </button>
          <button
            onClick={handleDelete}
            onPointerDown={(e) => e.stopPropagation()}
            className="px-4 py-3 text-sm text-red-600 hover:bg-red-50 rounded transition-colors"
            style={{ minHeight: '44px', minWidth: '44px' }}
            aria-label={`Delete ${application.jobTitle}`}
          >
            Delete
          </button>
        </div>
      )}
    </article>
  );
}
