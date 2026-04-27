import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ApplicationStatus } from '../types/application';

const statusOptions: Array<{
  value: ApplicationStatus;
  label: string;
  icon: string;
  color: string;
}> = [
  { value: 'saved', label: 'Saved', icon: '📥', color: 'text-blue-600' },
  { value: 'applied', label: 'Applied', icon: '📤', color: 'text-yellow-600' },
  { value: 'phone_screen', label: 'Phone Screen', icon: '📞', color: 'text-orange-600' },
  { value: 'interview', label: 'Interview', icon: '🤝', color: 'text-purple-600' },
  { value: 'offer', label: 'Offer', icon: '🎉', color: 'text-green-600' },
  { value: 'rejected', label: 'Rejected', icon: '❌', color: 'text-red-600' },
  { value: 'withdrawn', label: 'Withdrawn', icon: '↩️', color: 'text-gray-600' },
];

export interface StatusDropdownProps {
  currentStatus: ApplicationStatus;
  onStatusChange: (newStatus: ApplicationStatus) => void;
  disabled?: boolean;
}

export function StatusDropdown({
  currentStatus,
  onStatusChange,
  disabled = false,
}: StatusDropdownProps) {
  const currentOption = statusOptions.find((opt) => opt.value === currentStatus);

  const handleSelect = (value: string) => {
    onStatusChange(value as ApplicationStatus);
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className={`
            inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium
            border rounded-md transition-colors
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'}
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
          `}
          disabled={disabled}
          aria-label={`Change status from ${currentOption?.label || currentStatus}`}
        >
          <span>{currentOption?.icon}</span>
          <span className={currentOption?.color}>{currentOption?.label}</span>
          <span className="text-gray-400">▼</span>
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[200px] bg-white rounded-md shadow-lg border border-gray-200 p-1 z-50"
          sideOffset={5}
          align="start"
        >
          {statusOptions.map((option) => (
            <DropdownMenu.Item
              key={option.value}
              className={`
                flex items-center gap-3 px-3 py-2 text-sm rounded cursor-pointer
                outline-none select-none
                ${option.value === currentStatus ? 'bg-blue-50' : ''}
                hover:bg-gray-50
                focus:bg-gray-100
                data-[highlighted]:bg-gray-100
              `}
              onSelect={() => handleSelect(option.value)}
            >
              <span>{option.icon}</span>
              <span className={option.color}>{option.label}</span>
              {option.value === currentStatus && <span className="ml-auto text-blue-600">✓</span>}
            </DropdownMenu.Item>
          ))}

          <DropdownMenu.Arrow className="fill-white" />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
