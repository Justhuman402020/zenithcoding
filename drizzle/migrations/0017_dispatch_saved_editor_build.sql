CREATE OR REPLACE FUNCTION public.dispatch_saved_build(_job uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, net
AS $$
DECLARE j public.chat_jobs%ROWTYPE; tok text; rid bigint;
BEGIN
  SELECT * INTO j FROM public.chat_jobs WHERE id = _job FOR UPDATE;
  IF NOT FOUND OR j.status <> 'queued' OR j.resume_payload IS NULL THEN RAISE EXCEPTION 'Build is not queued'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = j.user_id AND lower(email) = 'justsamsung99@gmail.com' AND email_confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'Not available'; END IF;
  SELECT token INTO tok FROM public.job_resume_config WHERE id = 'default';
  IF tok IS NULL THEN RAISE EXCEPTION 'Resume token missing'; END IF;
  UPDATE public.chat_jobs SET status = 'running', updated_at = now(), progress = 'Build started on the server' WHERE id = _job;
  SELECT net.http_post(
    url := 'https://project--4cd30b31-2a37-4c66-9cee-ab3d574ad805.lovable.app/api/public/chat',
    headers := COALESCE(j.resume_payload->'headers', '{}'::jsonb) || jsonb_build_object('Content-Type','application/json','x-project-id',j.project_id::text,'x-forge-request-key',j.request_key,'x-forge-resume-user',j.user_id::text,'x-forge-resume-token',tok),
    body := jsonb_build_object('messages', j.resume_payload->'messages'),
    timeout_milliseconds := 600000
  ) INTO rid;
  RETURN rid;
END;
$$;
REVOKE ALL ON FUNCTION public.dispatch_saved_build(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_saved_build(uuid) TO service_role;