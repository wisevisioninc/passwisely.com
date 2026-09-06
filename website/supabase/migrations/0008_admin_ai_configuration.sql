begin;

-- The API key is intentionally not present in source control. It is written
-- through the authenticated admin API and stored as AES-GCM ciphertext.
insert into public.admin_settings (key, value) values
  ('ai_default_provider', 'kimi'),
  ('ai_default_model', 'kimi-k3')
on conflict (key) do nothing;

commit;
