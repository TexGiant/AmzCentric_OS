import "server-only";
import { getAccess } from "@/lib/access";
import { isDemoMode } from "@/lib/env";
import { demoSource } from "@/lib/data/demo";
import { scopedSource } from "@/lib/data/scoped";
import { supabaseSource } from "@/lib/data/supabase";
import type { DataSource } from "@/lib/data/types";

/** The signed-in person's view of the data: only their brands (RLS + app checks). */
export function data(): DataSource {
  return scopedSource(isDemoMode() ? demoSource : supabaseSource, getAccess);
}

export * from "@/lib/data/types";
