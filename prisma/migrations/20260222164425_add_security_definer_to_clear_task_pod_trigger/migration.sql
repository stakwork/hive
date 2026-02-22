-- Re-create the function with SECURITY DEFINER so it runs with the
-- privileges of the function owner, ensuring it can update the tasks
-- table regardless of the caller's permissions.

CREATE OR REPLACE FUNCTION clear_task_pod_on_release()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.usage_status = 'UNUSED' AND OLD.usage_status != 'UNUSED' THEN
    UPDATE tasks SET pod_id = NULL, agent_password = NULL
    WHERE pod_id = NEW.pod_id AND id = OLD.usage_status_marked_by;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
