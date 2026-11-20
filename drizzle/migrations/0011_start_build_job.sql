CREATE OR REPLACE FUNCTION public.start_build_job(_project uuid, _user uuid, _request_key text, _prompt text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'net'
AS $function$
DECLARE rid bigint; tok text;
BEGIN
  SELECT token INTO tok FROM public.job_resume_config WHERE id = 'default';
  IF tok IS NULL THEN RAISE EXCEPTION 'resume token missing'; END IF;
  SELECT net.http_post(
    url := 'https://project--4cd30b31-2a37-4c66-9cee-ab3d574ad805.lovable.app/api/public/chat',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-project-id', _project::text,
      'x-forge-mode', 'build',
      'x-forge-auto', 'on',
      'x-forge-request-key', _request_key,
      'x-forge-resume-user', _user::text,
      'x-forge-resume-token', tok
    ),
    body := jsonb_build_object('messages', jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid()::text, 'role', 'user',
      'parts', jsonb_build_array(jsonb_build_object('type', 'text', 'text', _prompt))
    ))),
    timeout_milliseconds := 600000
  ) INTO rid;
  RETURN rid;
END $function$;

REVOKE ALL ON FUNCTION public.start_build_job(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_build_job(uuid, uuid, text, text) TO service_role;