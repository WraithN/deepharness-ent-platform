import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-base shadow-sm transition-all duration-250 ease-smooth placeholder:text-muted-foreground input-glow focus:bg-white disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-card/80 dark:focus:bg-card/80",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
