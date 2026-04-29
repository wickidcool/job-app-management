import { useState, useEffect } from 'react';

export interface FloatingActionButtonProps {
  onClick: () => void;
  icon?: string;
  label?: string;
  ariaLabel: string;
}

export function FloatingActionButton({
  onClick,
  icon = '+',
  label = 'New Application',
  ariaLabel,
}: FloatingActionButtonProps) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [isExtended, setIsExtended] = useState(true);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;

      if (currentScrollY > 50) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }

      if (currentScrollY < lastScrollY) {
        setIsExtended(true);
      } else if (currentScrollY > lastScrollY && currentScrollY > 100) {
        setIsExtended(false);
      }

      setLastScrollY(currentScrollY);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY]);

  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      className={`
        fixed bottom-20 right-4 z-40
        flex items-center gap-2 rounded-full
        bg-primary-600 text-white shadow-lg
        transition-all duration-300 ease-in-out
        hover:bg-primary-700 hover:shadow-xl
        active:scale-95
        focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2
        md:hidden
        ${isExtended ? 'px-6 py-4' : 'px-4 py-4'}
        ${isScrolled ? 'shadow-2xl' : 'shadow-lg'}
      `}
      style={{
        minWidth: '56px',
        minHeight: '56px',
      }}
    >
      <span className="text-2xl font-light leading-none">{icon}</span>
      <span
        className={`
          overflow-hidden whitespace-nowrap font-medium
          transition-all duration-300 ease-in-out
          ${isExtended ? 'max-w-[200px] opacity-100' : 'max-w-0 opacity-0'}
        `}
      >
        {label}
      </span>
    </button>
  );
}
