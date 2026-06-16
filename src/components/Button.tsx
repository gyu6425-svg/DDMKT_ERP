import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  variant?: ButtonVariant
}

function Button({ children, className = '', variant = 'primary', ...props }: ButtonProps) {
  const variantClass =
    variant === 'primary' ? 'bg-[#ff5a00] text-white' : 'bg-[#f2f2f2] text-[#222222]'

  return (
    <button
      className={`inline-flex h-[59px] w-[190px] cursor-pointer items-center justify-center whitespace-nowrap rounded-xl border-0 px-[10px] py-5 font-[Montserrat] text-[20px] leading-none font-medium disabled:cursor-not-allowed disabled:opacity-65 ${variantClass} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  )
}

export default Button
