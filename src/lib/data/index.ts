import "server-only";
import { isDemoMode } from "@/lib/env";
import { demoSource } from "@/lib/data/demo";
import { supabaseSource } from "@/lib/data/supabase";
import type { DataSource } from "@/lib/data/types";

export function data(): DataSource {
  return isDemoMode() ? demoSource : supabaseSource;
}

export * from "@/lib/data/types";
