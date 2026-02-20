import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { VariantProps } from "class-variance-authority";

interface SplitButtonProps
  extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  dropdownContent: React.ReactNode;
  dropdownAlign?: "start" | "center" | "end";
}

function SplitButton({
  children,
  className,
  variant = "default",
  size = "default",
  disabled,
  dropdownContent,
  dropdownAlign = "end",
  ...props
}: SplitButtonProps) {
  return (
    <div className="inline-flex items-center">
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        className={cn("rounded-r-none", className)}
        {...props}
      >
        {children}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={variant}
            size={size}
            disabled={disabled}
            className="rounded-l-none border-l border-l-background/20 px-1.5"
          >
            <ChevronDown size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={dropdownAlign}>
          {dropdownContent}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export { SplitButton };
