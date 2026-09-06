begin;

-- Preserve the existing shared Kimi credential while allowing each provider
-- (including Qwen) to keep an independent encrypted API key.
insert into public.admin_settings (key, value)
select 'ai_api_key_kimi', value
from public.admin_settings
where key = 'ai_default_api_key'
  and exists (
    select 1 from public.admin_settings
    where key = 'ai_default_provider' and value = 'kimi'
  )
on conflict (key) do nothing;

commit;
