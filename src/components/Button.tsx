import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'option';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    children?: ReactNode;
    selected?: boolean;
    size?: ButtonSize;
    variant?: ButtonVariant;
};

const variantClasses: Record<ButtonVariant, string> = {
    primary: '!border-transparent !bg-[#ff5a00] !text-white hover:!bg-[#e65100]',
    secondary: '!border-transparent !bg-[#f2f2f2] !text-[#222222] hover:!bg-[#e8e8e8]',
    danger: '!border-transparent !bg-[#dc2626] !text-white hover:!bg-[#b91c1c]',
    ghost: '!border-[#d1d5db] !bg-white !text-[#555555] hover:!bg-[#f6f7f9]',
    option: '!border-[#d1d5db] !bg-white !text-[#555555] hover:!bg-[#f6f7f9]',
};

const selectedClasses: Record<ButtonVariant, string> = {
    primary: '',
    secondary: '',
    danger: '',
    ghost: '',
    option: '!border-transparent !bg-[#ff5a00] !text-white hover:!bg-[#e65100]',
};

const sizeClasses: Record<ButtonSize, string> = {
    sm: 'min-h-8 px-3 py-1.5 text-xs',
    md: 'min-h-10 px-4 py-2 text-sm',
    lg: 'min-h-[59px] px-5 py-4 text-[20px]',
    icon: 'h-9 w-9 px-0 py-0 text-sm',
};

function inferVariant(className: string): ButtonVariant {
    if (className.includes('#dc2626') || className.includes('#b91c1c') || className.includes('#fca5a5')) {
        return 'danger';
    }

    if (className.includes('h-6') || className.includes('w-6') || className.includes('text-2xl') || className.trim() === 'text-sm') {
        return 'ghost';
    }

    if (className.includes('#1e40af') || className.includes('#1457ff')) {
        return 'primary';
    }

    if (className.includes('border') || className.includes('bg-white') || className.includes('text-[#64748b]')) {
        return 'ghost';
    }

    return 'primary';
}

function inferSize(className: string): ButtonSize {
    if (className.includes('h-6') || className.includes('w-6') || className.includes('text-2xl')) {
        return 'icon';
    }

    if (className.includes('h-8') || className.includes('text-xs') || className.includes('text-[11px]')) {
        return 'sm';
    }

    if (className.includes('h-[59px]') || className.includes('text-[20px]')) {
        return 'lg';
    }

    return 'md';
}

function Button({
    children,
    className = '',
    selected = false,
    size,
    variant,
    ...props
}: ButtonProps) {
    const resolvedVariant = variant ?? inferVariant(className);
    const resolvedSize = size ?? inferSize(className);
    const hasInlineBackground =
        props.style && 'background' in props.style && typeof props.style.background === 'string';
    const activeVariantClass = hasInlineBackground
        ? ''
        : selected
          ? selectedClasses[resolvedVariant] || variantClasses[resolvedVariant]
          : variantClasses[resolvedVariant];
    const radiusClass =
        className.includes('rounded-full') || hasInlineBackground
            ? ''
            : resolvedSize === 'sm' || resolvedSize === 'icon'
              ? '!rounded-[4px]'
              : '!rounded-[8px]';

    return (
        <button
            className={`inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] border leading-none font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${sizeClasses[resolvedSize]} ${hasInlineBackground ? '' : variantClasses[resolvedVariant]} ${activeVariantClass} ${className} ${radiusClass}`.trim()}
            {...props}
        >
            {children}
        </button>
    );
}

export default Button;
