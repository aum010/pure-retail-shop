/**
 * Client-side providers for the whole app.
 *
 * Kept out of the root layout because the root layout is a Server Component:
 * importing Radix or the toast system there would make it a Client Component
 * along with everything above it. Wrapping here lets the rest of the tree stay
 * server-rendered while the pieces that need the browser still work.
 */
"use client";

import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      {children}
      <Toaster />
      <Sonner />
    </TooltipProvider>
  );
}
