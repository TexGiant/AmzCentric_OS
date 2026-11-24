-- AmzCentric OS — per-brand settings for the case study feed.
--   category            e.g. "Supplements", used to describe the brand anonymously ("a Supplements brand")
--   case_study_consent  none (default: never used) | anonymized | named (only with the client's written OK)
-- Read by /api/insights/case-studies; edited by admins in Settings → Brands.
-- Run once in the Supabase SQL editor, after 0001–0007. Safe to re-run.

alter table public.brands add column if not exists category text;
alter table public.brands add column if not exists case_study_consent text not null default 'none';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'brands_case_study_consent_check') then
    alter table public.brands
      add constraint brands_case_study_consent_check check (case_study_consent in ('none', 'anonymized', 'named'));
  end if;
end $$;
