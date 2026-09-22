"use client"

import type { ButtonHTMLAttributes, ReactNode } from "react"

type ConfirmSubmitButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  message: string
  children: ReactNode
}

export function ConfirmSubmitButton({
  message,
  children,
  onClick,
  ...props
}: ConfirmSubmitButtonProps) {
  return (
    <button
      {...props}
      type="submit"
      onClick={(event) => {
        onClick?.(event)

        if (event.defaultPrevented) {
          return
        }

        if (!window.confirm(message)) {
          event.preventDefault()
        }
      }}
    >
      {children}
    </button>
  )
}