create or replace function public.refund_credits(
  p_user_id uuid,
  p_amount integer,
  p_action text,
  p_reference text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_balance integer;
begin
  if p_amount <= 0 or p_amount > 10000 then
    raise exception 'invalid refund amount';
  end if;

  if exists (
    select 1 from public.credit_transactions where reference = p_reference
  ) then
    select balance_after into new_balance
    from public.credit_transactions
    where reference = p_reference;
    return new_balance;
  end if;

  update public.profiles
  set credits = credits + p_amount, updated_at = now()
  where id = p_user_id
  returning credits into new_balance;

  insert into public.credit_transactions
    (user_id, amount, balance_after, type, reference)
  values (p_user_id, p_amount, new_balance, p_action, p_reference);

  return new_balance;
end;
$$;

revoke execute on function public.refund_credits(uuid, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.refund_credits(uuid, integer, text, text)
  to service_role;
