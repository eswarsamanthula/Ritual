-- ============================================================
--  RITUAL — WITNESS MODE SQL FUNCTIONS
--  Run these in your Supabase SQL Editor (dashboard > SQL Editor)
-- ============================================================

-- 1. Look up a user by email
CREATE OR REPLACE FUNCTION get_user_by_email(search_email text)
RETURNS TABLE (id uuid, name text, avatar_url text)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT id,
         COALESCE(raw_user_meta_data->>'name', raw_user_meta_data->>'full_name', email) as name,
         COALESCE(raw_user_meta_data->>'avatar_url', '') as avatar_url
  FROM auth.users
  WHERE email = search_email
  LIMIT 1;
$$;

-- 2. Send a witness request
CREATE OR REPLACE FUNCTION add_witness_request(
  target_email text,
  from_user_id uuid,
  from_name text,
  from_email text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  target_user RECORD;
  existing jsonb;
  new_req jsonb;
  my_settings jsonb;
BEGIN
  SELECT id INTO target_user FROM auth.users WHERE email = target_email;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;
  IF target_user.id = from_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot witness yourself');
  END IF;

  SELECT value INTO existing FROM public.user_data
  WHERE user_id = target_user.id AND key = 'witness_settings';
  IF existing IS NULL THEN
    existing := '{"mode_on":true,"my_witness":{"user_id":null,"name":"","email":"","status":"none"},"witness_requests":[],"i_witness":[],"last_notified_date":"","notifications":[]}'::jsonb;
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(existing->'witness_requests') r(value) WHERE r.value->>'from_user_id' = from_user_id::text) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request already sent');
  END IF;

  new_req := jsonb_build_object(
    'id', gen_random_uuid()::text,
    'from_user_id', from_user_id::text,
    'from_name', from_name,
    'from_email', from_email,
    'timestamp', floor(extract(epoch from now()) * 1000)::bigint
  );
  existing := jsonb_set(existing, '{witness_requests}', (COALESCE(existing->'witness_requests', '[]'::jsonb) || new_req));
  INSERT INTO public.user_data (user_id, key, value) VALUES (target_user.id, 'witness_settings', existing)
  ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value;

  SELECT value INTO my_settings FROM public.user_data WHERE user_id = from_user_id AND key = 'witness_settings';
  IF my_settings IS NULL THEN
    my_settings := '{"mode_on":true,"my_witness":{"user_id":null,"name":"","email":"","status":"none"},"witness_requests":[],"i_witness":[],"last_notified_date":"","notifications":[]}'::jsonb;
  END IF;
  my_settings := jsonb_set(my_settings, '{my_witness}', jsonb_build_object(
    'user_id', target_user.id::text,
    'name', COALESCE(target_user.raw_user_meta_data->>'name', target_user.raw_user_meta_data->>'full_name', target_email),
    'email', target_email,
    'status', 'pending'
  ));
  INSERT INTO public.user_data (user_id, key, value) VALUES (from_user_id, 'witness_settings', my_settings)
  ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value;

  RETURN jsonb_build_object('success', true, 'target_id', target_user.id::text);
END;
$$;

-- 3. Accept a witness request
CREATE OR REPLACE FUNCTION accept_witness_request(request_id text, accepter_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  my_settings jsonb;
  req jsonb;
  from_uid text;
  from_name text;
  from_email text;
  their_settings jsonb;
BEGIN
  SELECT value INTO my_settings FROM public.user_data WHERE user_id = accepter_user_id AND key = 'witness_settings';
  IF my_settings IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Settings not found'); END IF;

  SELECT r.value INTO req FROM jsonb_array_elements(my_settings->'witness_requests') r(value) WHERE r.value->>'id' = request_id;
  IF req IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Request not found'); END IF;

  from_uid := req->>'from_user_id';
  from_name := req->>'from_name';
  from_email := req->>'from_email';

  my_settings := jsonb_set(my_settings, '{witness_requests}',
    (SELECT COALESCE(jsonb_agg(r.value), '[]'::jsonb) FROM jsonb_array_elements(my_settings->'witness_requests') r(value) WHERE r.value->>'id' != request_id));

  my_settings := jsonb_set(my_settings, '{i_witness}',
    (COALESCE(my_settings->'i_witness', '[]'::jsonb) || jsonb_build_object('user_id', from_uid, 'name', from_name, 'email', from_email)));

  INSERT INTO public.user_data (user_id, key, value) VALUES (accepter_user_id, 'witness_settings', my_settings)
  ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value;

  SELECT value INTO their_settings FROM public.user_data WHERE user_id = from_uid::uuid AND key = 'witness_settings';
  IF their_settings IS NOT NULL THEN
    their_settings := jsonb_set(their_settings, '{my_witness,status}', '"accepted"'::jsonb);
    INSERT INTO public.user_data (user_id, key, value) VALUES (from_uid::uuid, 'witness_settings', their_settings)
    ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 4. Decline a witness request
CREATE OR REPLACE FUNCTION decline_witness_request(request_id text, accepter_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  my_settings jsonb;
  req jsonb;
  from_uid text;
  their_settings jsonb;
BEGIN
  SELECT value INTO my_settings FROM public.user_data WHERE user_id = accepter_user_id AND key = 'witness_settings';
  IF my_settings IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Settings not found'); END IF;

  SELECT r.value INTO req FROM jsonb_array_elements(my_settings->'witness_requests') r(value) WHERE r.value->>'id' = request_id;
  IF req IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Request not found'); END IF;

  from_uid := req->>'from_user_id';

  my_settings := jsonb_set(my_settings, '{witness_requests}',
    (SELECT COALESCE(jsonb_agg(r.value), '[]'::jsonb) FROM jsonb_array_elements(my_settings->'witness_requests') r(value) WHERE r.value->>'id' != request_id));

  INSERT INTO public.user_data (user_id, key, value) VALUES (accepter_user_id, 'witness_settings', my_settings)
  ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value;

  SELECT value INTO their_settings FROM public.user_data WHERE user_id = from_uid::uuid AND key = 'witness_settings';
  IF their_settings IS NOT NULL THEN
    their_settings := jsonb_set(their_settings, '{my_witness,status}', '"declined"'::jsonb);
    INSERT INTO public.user_data (user_id, key, value) VALUES (from_uid::uuid, 'witness_settings', their_settings)
    ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 5. Remove/cancel witness relationship
CREATE OR REPLACE FUNCTION remove_witness(user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  my_settings jsonb;
  witness_uid text;
  their_settings jsonb;
BEGIN
  SELECT value INTO my_settings FROM public.user_data WHERE user_id = user_id AND key = 'witness_settings';
  IF my_settings IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Settings not found'); END IF;

  witness_uid := my_settings->'my_witness'->>'user_id';
  my_settings := jsonb_set(my_settings, '{my_witness}', '{"user_id":null,"name":"","email":"","status":"none"}'::jsonb);
  INSERT INTO public.user_data (user_id, key, value) VALUES (user_id, 'witness_settings', my_settings)
  ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value;

  IF witness_uid IS NOT NULL AND witness_uid != '' THEN
    SELECT value INTO their_settings FROM public.user_data WHERE user_id = witness_uid::uuid AND key = 'witness_settings';
    IF their_settings IS NOT NULL THEN
      their_settings := jsonb_set(their_settings, '{i_witness}',
        (SELECT COALESCE(jsonb_agg(r.value), '[]'::jsonb) FROM jsonb_array_elements(their_settings->'i_witness') r(value) WHERE r.value->>'user_id' != user_id::text));
      INSERT INTO public.user_data (user_id, key, value) VALUES (witness_uid::uuid, 'witness_settings', their_settings)
      ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;
