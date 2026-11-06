-- Add the Basmagi-owned C++ notebook runtime and protect compiler quota state.
alter table public.notebooks drop constraint if exists notebooks_runtime_check;
alter table public.notebooks add constraint notebooks_runtime_check check (runtime in ('matlab', 'cpp'));
comment on column public.notebooks.runtime is 'Notebook execution runtime: matlab (browser educational interpreter) or cpp (remote C++17 compiler).';

create table if not exists public.cpp_run_quota (
  ip_hash text not null,
  window_start timestamptz not null,
  n integer not null default 0,
  primary key (ip_hash, window_start)
);
alter table public.cpp_run_quota enable row level security;
revoke all on public.cpp_run_quota from anon, authenticated;
grant all on public.cpp_run_quota to service_role;

create or replace function public.cpp_run_hit(p_key text, p_limit int, p_window_s int)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_s) * p_window_s);
  v_n int;
begin
  insert into public.cpp_run_quota(ip_hash, window_start, n) values (p_key, v_start, 1)
  on conflict (ip_hash, window_start) do update set n = cpp_run_quota.n + 1
  returning n into v_n;
  delete from public.cpp_run_quota where window_start < now() - interval '2 days';
  return v_n <= p_limit;
end; $$;
revoke all on function public.cpp_run_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.cpp_run_hit(text, int, int) to service_role;
