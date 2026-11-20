CREATE OR REPLACE FUNCTION public.workspace_signup_email_allowed(candidate_email text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public
AS $$ SELECT COALESCE(lower(btrim(candidate_email)) = 'justsamsung99@gmail.com', false); $$;
REVOKE ALL ON FUNCTION public.workspace_signup_email_allowed(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_signup_email_allowed(text) TO service_role;

CREATE OR REPLACE FUNCTION public.restrict_workspace_signup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.workspace_signup_email_allowed(NEW.email) THEN
    RAISE EXCEPTION 'Registration is not available' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.restrict_workspace_signup() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restrict_workspace_signup() TO service_role;
CREATE TRIGGER restrict_workspace_signup_before_insert
BEFORE INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.restrict_workspace_signup();