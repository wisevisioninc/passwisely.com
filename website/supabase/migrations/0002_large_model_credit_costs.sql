create or replace function public.consume_credits(
  p_user_id uuid,
  p_cost integer,
  p_action text,
  p_reference text
)
returns table(success boolean, balance integer, duplicate boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_balance integer;
  existing_balance integer;
begin
  if p_cost <= 0 or p_cost > 10000 then
    raise exception 'invalid credit cost';
  end if;

  select p.credits into current_balance
  from public.profiles p
  where p.id = p_user_id
  for update;

  if current_balance is null then
    raise exception 'profile not found';
  end if;

  select t.balance_after into existing_balance
  from public.credit_transactions t
  where t.reference = p_reference;

  if existing_balance is not null then
    return query select true, existing_balance, true;
    return;
  end if;

  if current_balance < p_cost then
    return query select false, current_balance, false;
    return;
  end if;

  current_balance := current_balance - p_cost;
  update public.profiles
  set credits = current_balance, updated_at = now()
  where id = p_user_id;

  insert into public.credit_transactions
    (user_id, amount, balance_after, type, reference)
  values (p_user_id, -p_cost, current_balance, p_action, p_reference);

  return query select true, current_balance, false;
end;
$$;

revoke execute on function public.consume_credits(uuid, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.consume_credits(uuid, integer, text, text)
  to service_role;
